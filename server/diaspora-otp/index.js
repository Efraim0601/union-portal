import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { createProxyMiddleware } from 'http-proxy-middleware';
import {
  createOtpSession, getOtpSession, incrementOtpAttempts, markOtpVerified,
  saveDocument, latestSessionDocument, createApplication, getApplicationById, getApplicationByReference,
  getApplicationByEmail, getApplicationByContact, createEnterpriseApplication,
  listAgencies, replaceAgencies, seedAgenciesIfEmpty,
  listLookup, replaceLookup, seedLookupIfEmpty,
  listSubsectors, replaceSubsectors, seedSubsectorsIfEmpty,
  listPackages, replacePackages, seedPackagesIfEmpty,
  UPLOADS_DIR,
} from './db.js';

const app = express();
app.use((_req, res, next) => {
  // Le dev-server Angular (proxy /api) parle en same-origin ; ce header ne sert
  // qu'à couvrir un appel direct (ex. test manuel via curl/Postman).
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// OCR (RapidOCR + MRZ / texte libre) : service Python séparé (server/diaspora-ocr) — on relaie
// tel quel, avant express.json(), pour ne jamais toucher au corps multipart (upload d'images).
// La route « extract-address » est déclarée AVANT la route « extract » générique : app.use()
// matche par préfixe, donc '/api/pre-onboarding/extract-address' correspondrait sinon aussi à
// '/api/pre-onboarding/extract' et serait proxyée par erreur vers le mauvais endpoint OCR.
const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL || 'http://localhost:10003';
app.use(
  '/api/pre-onboarding/extract-address',
  createProxyMiddleware({
    target: OCR_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: () => '/extract-address',
  }),
);
app.use(
  '/api/pre-onboarding/extract',
  createProxyMiddleware({
    target: OCR_SERVICE_URL,
    changeOrigin: true,
    // Express a déjà retiré le préfixe de montage de req.url ici (il ne reste que '/') —
    // on réécrit donc inconditionnellement vers l'unique route exposée par le service OCR.
    pathRewrite: () => '/extract',
  }),
);

app.use(express.json());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const PORT = process.env.PORT || 10002;
const CALLBELL_API_KEY = process.env.CALLBELL_API_KEY;
const CALLBELL_CHANNEL_UUID = process.env.CALLBELL_CHANNEL_UUID;
const CALLBELL_FROM = process.env.CALLBELL_FROM || 'whatsapp';
const CALLBELL_SEND_URL = 'https://api.callbell.eu/v1/messages/send';

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

// Microservice de vérification faciale (InsightFace) — comparaison CNI ↔ vidéo/selfie.
const FACE_VERIFY_URL = process.env.FACE_VERIFY_URL || 'http://localhost:8000';

if (!CALLBELL_API_KEY || !CALLBELL_CHANNEL_UUID) {
  console.warn(
    '[diaspora-otp] CALLBELL_API_KEY / CALLBELL_CHANNEL_UUID manquant(s) — ' +
    'copiez .env.example en .env et renseignez vos identifiants Callbell. ' +
    'Sans ça, /whatsapp-otp/send renverra une erreur 502.',
  );
}

function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

// ---- Référentiels ----
// Champs alignés sur le vrai backend FastAPI (iso_code/name_fr/calling_code, code/label) —
// diaspora-api.service.ts projette ce format vers le modèle interne du front (cf. commit
// 3854a20 "brancher l'étape OTP et les référentiels sur la VRAIE API").
const COUNTRIES = [
  { iso_code: 'CM', name_fr: 'Cameroun', calling_code: '+237' },
  { iso_code: 'GA', name_fr: 'Gabon', calling_code: '+241' },
  { iso_code: 'CG', name_fr: 'Congo', calling_code: '+242' },
  { iso_code: 'TD', name_fr: 'Tchad', calling_code: '+235' },
  { iso_code: 'CF', name_fr: 'République centrafricaine', calling_code: '+236' },
  { iso_code: 'GQ', name_fr: 'Guinée équatoriale', calling_code: '+240' },
  { iso_code: 'FR', name_fr: 'France', calling_code: '+33' },
  { iso_code: 'BE', name_fr: 'Belgique', calling_code: '+32' },
  { iso_code: 'DE', name_fr: 'Allemagne', calling_code: '+49' },
  { iso_code: 'CH', name_fr: 'Suisse', calling_code: '+41' },
  { iso_code: 'US', name_fr: 'États-Unis', calling_code: '+1' },
  { iso_code: 'CA', name_fr: 'Canada', calling_code: '+1' },
  { iso_code: 'GB', name_fr: 'Royaume-Uni', calling_code: '+44' },
  { iso_code: 'IT', name_fr: 'Italie', calling_code: '+39' },
  { iso_code: 'ES', name_fr: 'Espagne', calling_code: '+34' },
  { iso_code: 'NL', name_fr: 'Pays-Bas', calling_code: '+31' },
  { iso_code: 'CI', name_fr: "Côte d'Ivoire", calling_code: '+225' },
  { iso_code: 'SN', name_fr: 'Sénégal', calling_code: '+221' },
  { iso_code: 'NG', name_fr: 'Nigéria', calling_code: '+234' },
  { iso_code: 'ZA', name_fr: 'Afrique du Sud', calling_code: '+27' },
];
// Liste (quasi) complète des nationalités (ISO 3166-1 alpha-2 + libellé FR), triée par libellé.
// Amorce par défaut ; modifiable ultérieurement côté backend réel si besoin.
const NATIONALITIES = [
  { code: 'AF', label: 'Afghane' }, { code: 'ZA', label: 'Sud-africaine' }, { code: 'AL', label: 'Albanaise' },
  { code: 'DZ', label: 'Algérienne' }, { code: 'DE', label: 'Allemande' }, { code: 'AD', label: 'Andorrane' },
  { code: 'AO', label: 'Angolaise' }, { code: 'AG', label: 'Antiguaise-et-barbudienne' }, { code: 'SA', label: 'Saoudienne' },
  { code: 'AR', label: 'Argentine' }, { code: 'AM', label: 'Arménienne' }, { code: 'AU', label: 'Australienne' },
  { code: 'AT', label: 'Autrichienne' }, { code: 'AZ', label: 'Azerbaïdjanaise' }, { code: 'BS', label: 'Bahamienne' },
  { code: 'BH', label: 'Bahreïnienne' }, { code: 'BD', label: 'Bangladaise' }, { code: 'BB', label: 'Barbadienne' },
  { code: 'BE', label: 'Belge' }, { code: 'BZ', label: 'Bélizienne' }, { code: 'BJ', label: 'Béninoise' },
  { code: 'BT', label: 'Bhoutanaise' }, { code: 'BY', label: 'Biélorusse' }, { code: 'MM', label: 'Birmane' },
  { code: 'BO', label: 'Bolivienne' }, { code: 'BA', label: 'Bosnienne' }, { code: 'BW', label: 'Botswanaise' },
  { code: 'BR', label: 'Brésilienne' }, { code: 'BN', label: 'Brunéienne' }, { code: 'BG', label: 'Bulgare' },
  { code: 'BF', label: 'Burkinabée' }, { code: 'BI', label: 'Burundaise' }, { code: 'KH', label: 'Cambodgienne' },
  { code: 'CM', label: 'Camerounaise' }, { code: 'CA', label: 'Canadienne' }, { code: 'CV', label: 'Cap-verdienne' },
  { code: 'CF', label: 'Centrafricaine' }, { code: 'CL', label: 'Chilienne' }, { code: 'CN', label: 'Chinoise' },
  { code: 'CY', label: 'Chypriote' }, { code: 'CO', label: 'Colombienne' }, { code: 'KM', label: 'Comorienne' },
  { code: 'CG', label: 'Congolaise (Congo)' }, { code: 'CD', label: 'Congolaise (RDC)' }, { code: 'KR', label: 'Sud-coréenne' },
  { code: 'KP', label: 'Nord-coréenne' }, { code: 'CR', label: 'Costaricaine' }, { code: 'CI', label: 'Ivoirienne' },
  { code: 'HR', label: 'Croate' }, { code: 'CU', label: 'Cubaine' }, { code: 'DK', label: 'Danoise' },
  { code: 'DJ', label: 'Djiboutienne' }, { code: 'DM', label: 'Dominiquaise' }, { code: 'DO', label: 'Dominicaine' },
  { code: 'EG', label: 'Égyptienne' }, { code: 'AE', label: 'Émirienne' }, { code: 'EC', label: 'Équatorienne' },
  { code: 'ER', label: 'Érythréenne' }, { code: 'ES', label: 'Espagnole' }, { code: 'EE', label: 'Estonienne' },
  { code: 'US', label: 'Américaine' }, { code: 'ET', label: 'Éthiopienne' }, { code: 'FJ', label: 'Fidjienne' },
  { code: 'FI', label: 'Finlandaise' }, { code: 'FR', label: 'Française' }, { code: 'GA', label: 'Gabonaise' },
  { code: 'GM', label: 'Gambienne' }, { code: 'GE', label: 'Géorgienne' }, { code: 'GH', label: 'Ghanéenne' },
  { code: 'GR', label: 'Grecque' }, { code: 'GD', label: 'Grenadienne' }, { code: 'GT', label: 'Guatémaltèque' },
  { code: 'GN', label: 'Guinéenne' }, { code: 'GQ', label: 'Équato-guinéenne' }, { code: 'GW', label: 'Bissau-guinéenne' },
  { code: 'GY', label: 'Guyanienne' }, { code: 'HT', label: 'Haïtienne' }, { code: 'HN', label: 'Hondurienne' },
  { code: 'HU', label: 'Hongroise' }, { code: 'IN', label: 'Indienne' }, { code: 'ID', label: 'Indonésienne' },
  { code: 'IQ', label: 'Irakienne' }, { code: 'IR', label: 'Iranienne' }, { code: 'IE', label: 'Irlandaise' },
  { code: 'IS', label: 'Islandaise' }, { code: 'IL', label: 'Israélienne' }, { code: 'IT', label: 'Italienne' },
  { code: 'JM', label: 'Jamaïcaine' }, { code: 'JP', label: 'Japonaise' }, { code: 'JO', label: 'Jordanienne' },
  { code: 'KZ', label: 'Kazakhe' }, { code: 'KE', label: 'Kényane' }, { code: 'KG', label: 'Kirghize' },
  { code: 'KI', label: 'Kiribatienne' }, { code: 'KW', label: 'Koweïtienne' }, { code: 'LA', label: 'Laotienne' },
  { code: 'LS', label: 'Lesothane' }, { code: 'LV', label: 'Lettone' }, { code: 'LB', label: 'Libanaise' },
  { code: 'LR', label: 'Libérienne' }, { code: 'LY', label: 'Libyenne' }, { code: 'LI', label: 'Liechtensteinoise' },
  { code: 'LT', label: 'Lituanienne' }, { code: 'LU', label: 'Luxembourgeoise' }, { code: 'MK', label: 'Macédonienne' },
  { code: 'MG', label: 'Malgache' }, { code: 'MY', label: 'Malaisienne' }, { code: 'MW', label: 'Malawienne' },
  { code: 'MV', label: 'Maldivienne' }, { code: 'ML', label: 'Malienne' }, { code: 'MT', label: 'Maltaise' },
  { code: 'MA', label: 'Marocaine' }, { code: 'MH', label: 'Marshallaise' }, { code: 'MU', label: 'Mauricienne' },
  { code: 'MR', label: 'Mauritanienne' }, { code: 'MX', label: 'Mexicaine' }, { code: 'FM', label: 'Micronésienne' },
  { code: 'MD', label: 'Moldave' }, { code: 'MC', label: 'Monégasque' }, { code: 'MN', label: 'Mongole' },
  { code: 'ME', label: 'Monténégrine' }, { code: 'MZ', label: 'Mozambicaine' }, { code: 'NA', label: 'Namibienne' },
  { code: 'NR', label: 'Nauruane' }, { code: 'NP', label: 'Népalaise' }, { code: 'NI', label: 'Nicaraguayenne' },
  { code: 'NE', label: 'Nigérienne' }, { code: 'NG', label: 'Nigériane' }, { code: 'NO', label: 'Norvégienne' },
  { code: 'NZ', label: 'Néo-zélandaise' }, { code: 'OM', label: 'Omanaise' }, { code: 'UG', label: 'Ougandaise' },
  { code: 'UZ', label: 'Ouzbèke' }, { code: 'PK', label: 'Pakistanaise' }, { code: 'PW', label: 'Palaosienne' },
  { code: 'PS', label: 'Palestinienne' }, { code: 'PA', label: 'Panaméenne' }, { code: 'PG', label: 'Papouane-néo-guinéenne' },
  { code: 'PY', label: 'Paraguayenne' }, { code: 'NL', label: 'Néerlandaise' }, { code: 'PE', label: 'Péruvienne' },
  { code: 'PH', label: 'Philippine' }, { code: 'PL', label: 'Polonaise' }, { code: 'PT', label: 'Portugaise' },
  { code: 'QA', label: 'Qatarienne' }, { code: 'RO', label: 'Roumaine' }, { code: 'GB', label: 'Britannique' },
  { code: 'RU', label: 'Russe' }, { code: 'RW', label: 'Rwandaise' }, { code: 'KN', label: 'Kittitienne-et-névicienne' },
  { code: 'SM', label: 'Saint-marinaise' }, { code: 'VC', label: 'Saint-vincentaise-et-grenadine' }, { code: 'LC', label: 'Saint-lucienne' },
  { code: 'SB', label: 'Salomonaise' }, { code: 'SV', label: 'Salvadorienne' }, { code: 'WS', label: 'Samoane' },
  { code: 'ST', label: 'Santoméenne' }, { code: 'SN', label: 'Sénégalaise' }, { code: 'RS', label: 'Serbe' },
  { code: 'SC', label: 'Seychelloise' }, { code: 'SL', label: 'Sierra-léonaise' }, { code: 'SG', label: 'Singapourienne' },
  { code: 'SK', label: 'Slovaque' }, { code: 'SI', label: 'Slovène' }, { code: 'SO', label: 'Somalienne' },
  { code: 'SD', label: 'Soudanaise' }, { code: 'SS', label: 'Sud-soudanaise' }, { code: 'LK', label: 'Srilankaise' },
  { code: 'SE', label: 'Suédoise' }, { code: 'CH', label: 'Suisse' }, { code: 'SR', label: 'Surinamaise' },
  { code: 'SZ', label: 'Swazie' }, { code: 'SY', label: 'Syrienne' }, { code: 'TJ', label: 'Tadjike' },
  { code: 'TZ', label: 'Tanzanienne' }, { code: 'TD', label: 'Tchadienne' }, { code: 'CZ', label: 'Tchèque' },
  { code: 'TH', label: 'Thaïlandaise' }, { code: 'TL', label: 'Est-timoraise' }, { code: 'TG', label: 'Togolaise' },
  { code: 'TO', label: 'Tongienne' }, { code: 'TT', label: 'Trinidadienne' }, { code: 'TN', label: 'Tunisienne' },
  { code: 'TM', label: 'Turkmène' }, { code: 'TR', label: 'Turque' }, { code: 'TV', label: 'Tuvaluane' },
  { code: 'UA', label: 'Ukrainienne' }, { code: 'UY', label: 'Uruguayenne' }, { code: 'VU', label: 'Vanuatuane' },
  { code: 'VE', label: 'Vénézuélienne' }, { code: 'VN', label: 'Vietnamienne' }, { code: 'YE', label: 'Yéménite' },
  { code: 'ZM', label: 'Zambienne' }, { code: 'ZW', label: 'Zimbabwéenne' },
];
// Amorce de la table `agencies` (SQLite) au premier démarrage seulement — modifiable ensuite
// via /admin/parametrage (PUT ci-dessous), qui écrase ce jeu de départ. Réseau/région à
// renseigner en admin (non fournis avec cette liste de noms d'agences).
seedAgenciesIfEmpty([
  { code: 'AGENCE_MOBILE', name: 'FIRST BANK Agence Mobile' },
  { code: 'AHALA', name: 'FIRST BANK Ahala' },
  { code: 'AKWA', name: 'FIRST BANK Akwa' },
  { code: 'AKWA_MILLENIUM', name: 'FIRST BANK Akwa Millenium' },
  { code: 'AWAE', name: 'FIRST BANK Awae' },
  { code: 'BAFANG', name: 'FIRST BANK Bafang' },
  { code: 'BAFIA', name: 'FIRST BANK Bafia' },
  { code: 'BAMENDA', name: 'FIRST BANK Bamenda' },
  { code: 'BAMENDA_NKWEN', name: 'FIRST BANK Bamenda-Nkwen' },
  { code: 'BAMENDZI', name: 'FIRST BANK Bamendzi' },
  { code: 'BASTOS', name: 'FIRST BANK Bastos' },
  { code: 'BATOURI', name: 'FIRST BANK Batouri' },
  { code: 'BEKOKO', name: 'FIRST BANK Bekoko' },
  { code: 'BERTOUA', name: 'FIRST BANK Bertoua' },
  { code: 'BESSENGUE', name: 'FIRST BANK Bessengue' },
  { code: 'BIYEM_ASSI', name: 'FIRST BANK Biyem-Assi' },
  { code: 'BIYEM_ASSI_CARREFOUR', name: 'FIRST BANK Biyem-Assi Carrefour' },
  { code: 'BONABERI', name: 'FIRST BANK Bonaberi' },
  { code: 'BONABERI_II', name: 'FIRST BANK Bonaberi II' },
  { code: 'BONAMOUSSADI', name: 'FIRST BANK Bonamoussadi' },
  { code: 'BONANDJO', name: 'FIRST BANK Bonandjo' },
  { code: 'BONAPRIOSO', name: 'FIRST BANK Bonaprioso' },
  { code: 'BONASSAMA', name: 'FIRST BANK Bonassama' },
  { code: 'BUEA', name: 'FIRST BANK Buea' },
  { code: 'CAMAIR', name: 'FIRST BANK Camair' },
  { code: 'CITES_DES_PALMIERS', name: 'FIRST BANK Cités des Palmiers' },
  { code: 'COTE_D_IVOIRE', name: "FIRST BANK Côte d'Ivoire" },
  { code: 'CTX_CENTRE_SUD_NORD', name: 'FIRST BANK CTX Centre-Sud-Nord' },
  { code: 'CTX_LITTORAL_OUEST', name: 'FIRST BANK CTX Littoral-Ouest' },
  { code: 'DAKAR', name: 'FIRST BANK Dakar' },
  { code: 'DAMAS', name: 'FIRST BANK Damas' },
  { code: 'DOUCHE_MUNICIPALE', name: 'FIRST BANK Douche Municipale' },
  { code: 'DSCHANG', name: 'FIRST BANK Dschang' },
  { code: 'EBOLOWA', name: 'FIRST BANK Ebolowa' },
  { code: 'EDEA', name: 'FIRST BANK Edea' },
  { code: 'ESSOS', name: 'FIRST BANK Essos' },
  { code: 'ETOUDI', name: 'FIRST BANK Etoudi' },
  { code: 'FENETRE_ISLAMIC', name: 'FIRST BANK Fenêtre Islamic' },
  { code: 'FOUNBOT', name: 'FIRST BANK Founbot' },
  { code: 'GAROUA', name: 'FIRST BANK Garoua' },
  { code: 'GAROUA_BOULAI', name: 'FIRST BANK Garoua-Boulai' },
  { code: 'HIPPODROME', name: 'FIRST BANK Hippodrome' },
  { code: 'KOTTO_BANGUE', name: 'FIRST BANK Kotto-Bangue' },
  { code: 'KOUMASSI', name: 'FIRST BANK Koumassi' },
  { code: 'KOUSSIRI', name: 'FIRST BANK Koussiri' },
  { code: 'KRIBI', name: 'FIRST BANK Kribi' },
  { code: 'KUMBA', name: 'FIRST BANK Kumba' },
  { code: 'LIMBE', name: 'FIRST BANK Limbe' },
  { code: 'LOGBABA', name: 'FIRST BANK Logbaba' },
  { code: 'LOGBOM', name: 'FIRST BANK Logbom' },
  { code: 'LOUM', name: 'FIRST BANK Loum' },
  { code: 'MABANDA', name: 'FIRST BANK Mabanda' },
  { code: 'MAKEPE', name: 'FIRST BANK Makepe' },
  { code: 'MARCHE_CENTRAL', name: 'FIRST BANK Marché Central' },
  { code: 'MAROUA', name: 'FIRST BANK Maroua' },
  { code: 'MAROUA_II', name: 'FIRST BANK Maroua II' },
  { code: 'MBALGONG', name: 'FIRST BANK Mbalgong' },
  { code: 'MBALLA_II', name: 'FIRST BANK Mballa II' },
  { code: 'MBALMAYO', name: 'FIRST BANK Mbalmayo' },
  { code: 'MBOPPI', name: 'FIRST BANK Mboppi' },
  { code: 'MBOUDA', name: 'FIRST BANK Mbouda' },
  { code: 'MEIGANGA', name: 'FIRST BANK Meiganga' },
  { code: 'MELEN', name: 'FIRST BANK Melen' },
  { code: 'MENDONG', name: 'FIRST BANK Mendong' },
  { code: 'MESSA', name: 'FIRST BANK Messa' },
  { code: 'MESSAMENDONGO', name: 'FIRST BANK Messamendongo' },
  { code: 'MFOU', name: 'FIRST BANK Mfou' },
  { code: 'MFOUNDI', name: 'FIRST BANK Mfoundi' },
  { code: 'MINBOMAN', name: 'FIRST BANK Minboman' },
  { code: 'MOKOLO', name: 'FIRST BANK Mokolo' },
  { code: 'MVAN', name: 'FIRST BANK Mvan' },
  { code: 'MVOG_MBI', name: 'FIRST BANK Mvog-Mbi' },
  { code: 'NDOG_PASSI', name: 'FIRST BANK Ndog-Passi' },
  { code: 'NDOKOTTI', name: 'FIRST BANK Ndokotti' },
  { code: 'NEWBELL', name: 'FIRST BANK Newbell' },
  { code: 'NGAOUNDERE', name: 'FIRST BANK Ngaoundere' },
  { code: 'NKOLBISSON', name: 'FIRST BANK Nkolbisson' },
  { code: 'NKOLBONG', name: 'FIRST BANK Nkolbong' },
  { code: 'NKONGSAMBA', name: 'FIRST BANK Nkongsamba' },
  { code: 'NKOUABANG', name: 'FIRST BANK Nkouabang' },
  { code: 'NKOULULOUN', name: 'FIRST BANK Nkoululoun' },
  { code: 'OBALA', name: 'FIRST BANK Obala' },
  { code: 'OLEMBE', name: 'FIRST BANK Olembe' },
  { code: 'OMNISPORT', name: 'FIRST BANK Omnisport' },
  { code: 'PK_14', name: 'FIRST BANK PK 14' },
  { code: 'PORT_AUTONOME_DOUALA', name: 'FIRST BANK Port Autonome Douala' },
  { code: 'PORT_DE_KRIBI', name: 'FIRST BANK Port de Kribi' },
  { code: 'PROMOTE', name: 'FIRST BANK Promote' },
  { code: 'RDC', name: 'FIRST BANK RDC' },
  { code: 'RETRAITE', name: 'FIRST BANK Retraite' },
  { code: 'ROUMBE_ADJIA', name: 'FIRST BANK Roumbe Adjia' },
  { code: 'SAINT_MICHEL', name: 'FIRST BANK Saint Michel' },
  { code: 'SANGMELIMA', name: 'FIRST BANK Sangmelima' },
  { code: 'SAO_TOME', name: 'FIRST BANK Sao Tome' },
  { code: 'SHELL_NEWBELL', name: 'FIRST BANK Shell Newbell' },
  { code: 'TAMDJA', name: 'FIRST BANK Tamdja' },
  { code: 'YADEME', name: 'FIRST BANK Yademe' },
  { code: 'YASSA', name: 'FIRST BANK Yassa' },
]);

// Amorce des listes KYC paramétrables — mêmes valeurs par défaut que mock-api.interceptor.ts
// (LOOKUP_DEFAULTS), pour un rendu identique que le front tape sur le mock local ou ce vrai
// backend. Modifiable ensuite via /admin/parametrage (PUT ci-dessous), qui écrase ce jeu de départ.
seedLookupIfEmpty('sectors', [
  { code: 'COMMERCE', name: 'Commerce' }, { code: 'AGRICULTURE', name: 'Agriculture' },
  { code: 'INDUSTRIE', name: 'Industrie' }, { code: 'SERVICES', name: 'Services' },
  { code: 'FONCTION_PUBLIQUE', name: 'Fonction publique' }, { code: 'SANTE', name: 'Santé' },
  { code: 'EDUCATION', name: 'Éducation' }, { code: 'TRANSPORT', name: 'Transport' },
  { code: 'BTP', name: 'BTP / Construction' }, { code: 'AUTRE', name: 'Autre' },
]);
seedLookupIfEmpty('professions', [
  { code: 'SALARIE_PRIVE', name: 'Salarié du secteur privé' }, { code: 'FONCTIONNAIRE', name: 'Fonctionnaire' },
  { code: 'COMMERCANT', name: 'Commerçant(e)' }, { code: 'ENTREPRENEUR', name: 'Entrepreneur / Chef d’entreprise' },
  { code: 'PROFESSION_LIBERALE', name: 'Profession libérale' }, { code: 'AGRICULTEUR', name: 'Agriculteur / Éleveur' },
  { code: 'ETUDIANT', name: 'Étudiant(e)' }, { code: 'RETRAITE', name: 'Retraité(e)' },
  { code: 'SANS_EMPLOI', name: 'Sans emploi' }, { code: 'AUTRE', name: 'Autre' },
]);
seedLookupIfEmpty('income-ranges', [
  { code: 'MOINS_500K', name: 'Moins de 500 000' }, { code: '500K_1M', name: '500 000 – 1 000 000' },
  { code: '1M_3M', name: '1 000 000 – 3 000 000' }, { code: 'PLUS_3M', name: 'Plus de 3 000 000' },
]);
seedLookupIfEmpty('income-types', [
  { code: 'SALAIRE', name: 'Salaire' }, { code: 'ACTIVITE_INDEPENDANTE', name: 'Activité indépendante / commerciale' },
  { code: 'PENSION', name: 'Pension / Retraite' }, { code: 'REVENUS_LOCATIFS', name: 'Revenus locatifs' },
  { code: 'AUTRE', name: 'Autre' },
]);
seedLookupIfEmpty('funds-origins', [
  { code: 'SALAIRE', name: 'Salaire' }, { code: 'EPARGNE', name: 'Épargne personnelle' },
  { code: 'HERITAGE', name: 'Héritage' }, { code: 'VENTE_BIEN', name: 'Vente de bien' },
  { code: 'ACTIVITE_COMMERCIALE', name: 'Activité commerciale' }, { code: 'AUTRE', name: 'Autre' },
]);
seedLookupIfEmpty('account-objects', [
  { code: 'EPARGNE', name: 'Épargne' }, { code: 'TRANSACTIONS_COURANTES', name: 'Transactions courantes' },
  { code: 'TRANSFERTS_INTERNATIONAUX', name: 'Transferts internationaux' }, { code: 'INVESTISSEMENT', name: 'Investissement' },
  { code: 'AUTRE', name: 'Autre' },
]);
seedSubsectorsIfEmpty([
  { code: 'COMMERCE_DETAIL', name: 'Commerce de détail', sector_code: 'COMMERCE' },
  { code: 'COMMERCE_GROS', name: 'Commerce de gros', sector_code: 'COMMERCE' },
  { code: 'IMPORT_EXPORT', name: 'Import-export', sector_code: 'COMMERCE' },
  { code: 'AGRI_VIVRIERE', name: 'Agriculture vivrière', sector_code: 'AGRICULTURE' },
  { code: 'AGRI_ELEVAGE', name: 'Élevage', sector_code: 'AGRICULTURE' },
  { code: 'INDUSTRIE_AGRO', name: 'Agro-industrie', sector_code: 'INDUSTRIE' },
  { code: 'SERVICES_FINANCIERS', name: 'Services financiers', sector_code: 'SERVICES' },
  { code: 'SERVICES_INFORMATIQUE', name: 'Informatique / Numérique', sector_code: 'SERVICES' },
]);
seedPackagesIfEmpty([
  {
    code: 'BUDGET', name: 'Package Budget', tagline: 'Destiné aux petites bourses',
    currency: 'XAF', opening_fee: 0, subscription_fee: 0, monthly_fee: 0, payment_required: false,
    features: ['SMS', 'First Carte Fellow', 'SARA Banking'],
  },
  {
    code: 'BUSINESS', name: 'Package Business', tagline: 'Pour les professionnels',
    currency: 'XAF', opening_fee: 0, subscription_fee: 0, monthly_fee: 0, payment_required: false,
    features: ['SMS', 'First Assurance', 'Découvert permanent', 'Carte Visa Classique'],
  },
  {
    code: 'ECO', name: 'Package Eco', tagline: 'L’essentiel au meilleur prix',
    currency: 'XAF', opening_fee: 0, subscription_fee: 0, monthly_fee: 0, payment_required: false,
    features: ['SMS', 'First Assurance', 'SARA Banking'],
  },
]);

const LOOKUP_KINDS = new Set(['sectors', 'professions', 'income-ranges', 'income-types', 'funds-origins', 'account-objects']);
function requireAdmin(req, res, next) {
  // Même niveau de protection que /api/agencies/active (PUT) ci-dessous : présence d'un
  // Authorization Bearer, pas de vérification cryptographique — à durcir avec une vraie
  // session admin backend. Cohérent avec mock-api.interceptor.ts côté front.
  if (!req.headers.authorization) return res.status(401).json({ error: 'Authentification requise.' });
  next();
}

app.get('/api/countries/active', (_req, res) => res.json(COUNTRIES));
app.get('/api/nationalities/active', (_req, res) => res.json(NATIONALITIES));
app.get('/api/agencies/active', (_req, res) => res.json(listAgencies()));
app.put('/api/agencies/active', (req, res) => {
  // Même niveau de protection que les autres listes admin (cf. mock-api.interceptor.ts côté
  // front) : présence d'un Authorization Bearer, pas de vérification cryptographique du token —
  // à durcir quand une vraie session admin backend existera.
  if (!req.headers.authorization) return res.status(401).json({ error: 'Authentification requise.' });
  const list = Array.isArray(req.body) ? req.body : [];
  res.json(replaceAgencies(list));
});
app.get('/api/subsectors/by-sector/:code', (_req, res) => res.json([]));
app.get('/api/subsectors/grouped', (_req, res) => res.json({}));

// ---- Listes KYC paramétrables (/admin/parametrage) ----
app.get('/api/lookups/subsectors', (_req, res) => res.json(listSubsectors()));
app.put('/api/lookups/subsectors', requireAdmin, (req, res) => {
  res.json(replaceSubsectors(Array.isArray(req.body) ? req.body : []));
});
app.get('/api/lookups/packages', (_req, res) => res.json(listPackages()));
app.put('/api/lookups/packages', requireAdmin, (req, res) => {
  res.json(replacePackages(Array.isArray(req.body) ? req.body : []));
});
app.get('/api/lookups/:kind', (req, res) => {
  if (!LOOKUP_KINDS.has(req.params.kind)) return res.status(404).json({ error: 'Liste inconnue.' });
  res.json(listLookup(req.params.kind));
});
app.put('/api/lookups/:kind', requireAdmin, (req, res) => {
  if (!LOOKUP_KINDS.has(req.params.kind)) return res.status(404).json({ error: 'Liste inconnue.' });
  res.json(replaceLookup(req.params.kind, Array.isArray(req.body) ? req.body : []));
});

// ---- Session admin (/admin/parametrage) ----
// Identifiants de dev — mêmes que mock-api.interceptor.ts, à remplacer par un vrai flux
// d'auth backend avant toute mise en production. Surchargeables via .env (ADMIN_EMAIL/ADMIN_PASSWORD).
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@diaspora.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Diaspora-Admin-2026!';
const ADMIN_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body ?? {};
  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Identifiants invalides.' });
  }
  res.json({ token: crypto.randomUUID(), expires_at: new Date(Date.now() + ADMIN_TOKEN_TTL_MS).toISOString() });
});

// ---- Pré-onboarding : OTP WhatsApp (Callbell) — persisté en SQLite ----
// Contrat aligné sur le vrai backend FastAPI (routes /otp/{send,verify}, session_id fourni
// par le CLIENT, réponse WhatsappOtpSendResult/VerifyResult) — cf. diaspora-api.service.ts
// et otp-step.ts (commit 3854a20). Repli `fallback_otp` quand WhatsApp n'a pas livré le
// message : le code est renvoyé tel quel pour que l'étape ne bloque pas le parcours.
app.post('/api/pre-onboarding/otp/send', async (req, res) => {
  const { session_id: sessionId, phone } = req.body ?? {};
  if (!sessionId || !phone) return res.status(400).json({ ok: false, message: 'session_id et phone requis' });

  const code = generateCode();

  const fallback = (message, whatsapp_delivery_status) => {
    createOtpSession(sessionId, phone, code, OTP_TTL_MS);
    res.json({
      ok: true, whatsapp_accepted: false, whatsapp_delivered: false,
      whatsapp_delivery_status, fallback_otp: code, fallback_display: true, message,
    });
  };

  if (!CALLBELL_API_KEY || !CALLBELL_CHANNEL_UUID) {
    return fallback('Callbell non configuré côté serveur (voir .env) — code affiché en repli.');
  }

  try {
    const callbellRes = await fetch(CALLBELL_SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CALLBELL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: phone,
        from: CALLBELL_FROM,
        type: 'text',
        channel_uuid: CALLBELL_CHANNEL_UUID,
        content: { text: `Votre code de vérification Afriland First Bank est : ${code}\nIl expire dans 5 minutes.` },
      }),
    });
    if (!callbellRes.ok) {
      const detail = await callbellRes.text().catch(() => '');
      console.error('[diaspora-otp] Callbell a refusé l’envoi', callbellRes.status, detail);
      return fallback('Envoi WhatsApp refusé par Callbell — code affiché en repli.', String(callbellRes.status));
    }
  } catch (err) {
    console.error('[diaspora-otp] Erreur réseau vers Callbell', err);
    return fallback('Envoi WhatsApp impossible (réseau) — code affiché en repli.');
  }

  createOtpSession(sessionId, phone, code, OTP_TTL_MS);
  res.json({ ok: true, whatsapp_accepted: true, whatsapp_delivered: true });
});

app.post('/api/pre-onboarding/otp/verify', (req, res) => {
  const { session_id: sessionId, phone, otp } = req.body ?? {};
  if (!sessionId || !phone || !otp) return res.status(400).json({ ok: false, verified: false, message: 'session_id, phone et otp requis' });

  const entry = getOtpSession(sessionId);
  if (!entry || entry.phone !== phone) return res.status(400).json({ ok: false, verified: false, message: 'Session OTP introuvable.' });
  if (Date.now() > entry.otp_expires_at) return res.status(400).json({ ok: false, verified: false, message: 'Code expiré, renvoyez-en un nouveau.' });
  if (entry.otp_attempts >= OTP_MAX_ATTEMPTS) return res.status(429).json({ ok: false, verified: false, message: 'Trop de tentatives, renvoyez un nouveau code.' });

  incrementOtpAttempts(entry.id);
  if (entry.otp_code !== otp) return res.status(400).json({ ok: false, verified: false, message: 'Code invalide.' });

  markOtpVerified(entry.id);
  res.json({
    ok: true, verified: true, session_id: sessionId,
    whatsapp_otp_verified: true, whatsapp_otp_verified_at: new Date().toISOString(),
  });
});

// ---- Pré-onboarding : OCR (une face par appel) ----
// Aligné sur le VRAI backend FastAPI : le front (diaspora-api.service.ts) poste UNE image par appel
// sur /pre-onboarding/ocr et lit `extracted_fields`. On relaie l'image au service RapidOCR local
// (/extract, qui la lit comme `recto`) et on ré-emballe sa sortie « à plat » au format attendu.
app.post('/api/pre-onboarding/ocr', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file requis' });
  try {
    const fd = new FormData();
    fd.append('document_type', req.body?.document_type || 'CNI');
    fd.append('recto', new Blob([req.file.buffer], { type: req.file.mimetype || 'image/jpeg' }), req.file.originalname || 'image.jpg');
    const r = await fetch(`${OCR_SERVICE_URL}/extract`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(`OCR ${r.status}`);
    const { quality, ...fields } = await r.json();
    res.json({ extracted_fields: fields, document_type_validation: { status: 'OK' }, document_side: null });
  } catch (err) {
    console.error('[diaspora-otp] OCR indisponible', err);
    res.json({ extracted_fields: {}, document_type_validation: { status: 'OK' }, document_side: null });
  }
});

/** Traduit la réponse du microservice face-verify en `face_match` attendu par le front
 *  (biometrics-step.applyFaceVerdict : identity.match => « Identité vérifiée »). */
function toFaceMatch(fv) {
  const sim = fv.similarity;
  const th = fv.thresholds?.match ?? 0.4;
  const matched = fv.decision === 'MATCH';
  const reasons = matched ? [] : [
    fv.decision === 'REVIEW'
      ? 'Similarité en zone de revue manuelle — vérification par un conseiller.'
      : "Le visage filmé ne correspond pas de façon fiable à la photo de la pièce.",
  ];
  return {
    status: 'OK',
    recognizer: 'insightface-buffalo_l',
    references: { CNI_RECTO: { status: 'OK', cosine_similarity: sim, threshold: th, quality: fv.video?.frames_with_face } },
    identity: {
      status: fv.decision,
      match: matched,
      confidence: sim,
      recognizer: 'insightface',
      reasons,
      pairs: { 'CLIENT_VIDEO:CNI_RECTO': { cosine_similarity: sim, threshold: th, match: matched } },
    },
  };
}

/** Compare la vidéo de vivacité à l'image de référence CNI_RECTO de la session via face-verify.
 *  Best-effort : toute erreur (service down, modèle absent, pas de référence) => verdict « indisponible »
 *  (status MODELS_MISSING), que le front traite déjà en soft-gate non bloquant. */
async function runSessionFaceMatch(sessionId, videoBuffer, videoName, videoMime) {
  const ref = latestSessionDocument(sessionId, 'CNI_RECTO');
  if (!ref) return { status: 'MODELS_MISSING', recognizer: 'insightface', identity: null };
  const idBuffer = await fs.promises.readFile(ref.file_path);
  const fd = new FormData();
  fd.append('id_card', new Blob([idBuffer], { type: ref.mime_type || 'image/jpeg' }), 'cni.jpg');
  fd.append('video', new Blob([videoBuffer], { type: videoMime || 'video/webm' }), videoName || 'video.webm');
  const r = await fetch(`${FACE_VERIFY_URL}/api/verify-video`, { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`face-verify ${r.status}`);
  return toFaceMatch(await r.json());
}

// ---- Pré-onboarding : enregistrement d'un fichier (aligné sur POST /pre-onboarding/save-file) ----
// Le front poste ici recto/verso CNI, selfie (CLIENT_PHOTO), vidéo (CLIENT_VIDEO) et justificatifs.
// L'enregistrement d'un CLIENT_VIDEO déclenche la comparaison faciale (face-verify) contre CNI_RECTO.
app.post('/api/pre-onboarding/save-file', upload.single('file'), async (req, res) => {
  const sessionId = req.body?.session_id;
  const documentType = req.body?.document_type || 'DOCUMENT';
  if (!req.file) return res.status(400).json({ error: 'file requis' });
  if (!sessionId) return res.status(400).json({ error: 'session_id requis' });

  const ext = path.extname(req.file.originalname || '') || '.bin';
  const fileName = `${sessionId}_${documentType}_${Date.now()}${ext}`;
  const filePath = path.join(UPLOADS_DIR, fileName);
  try {
    await fs.promises.writeFile(filePath, req.file.buffer);
  } catch (err) {
    console.error('[diaspora-otp] échec écriture document', err);
    return res.status(500).json({ error: 'Échec de l’enregistrement du document.' });
  }
  saveDocument({
    sessionId, documentType, filePath,
    originalName: req.file.originalname, mimeType: req.file.mimetype, sizeBytes: req.file.size,
  });

  const payload = { pre_document_id: fileName, session_id: sessionId, document_type: documentType, stored_name: fileName };

  // La vidéo de vivacité déclenche la vérification faciale (best-effort, jamais bloquant).
  if (documentType === 'CLIENT_VIDEO') {
    try {
      payload.face_match = await runSessionFaceMatch(sessionId, req.file.buffer, req.file.originalname, req.file.mimetype);
      console.log('[diaspora-otp] face_match', JSON.stringify(payload.face_match?.identity ?? payload.face_match?.status));
    } catch (err) {
      console.error('[diaspora-otp] vérification faciale indisponible', err.message);
      payload.face_match = { status: 'MODELS_MISSING', recognizer: 'insightface', identity: null };
    }
  }
  res.json(payload);
});

// ---- Pré-onboarding : documents (recto/verso, selfie, vidéo, justificatifs) — route legacy ----
app.post('/api/pre-onboarding/:sessionId/documents', upload.single('file'), async (req, res) => {
  const { sessionId } = req.params;
  const documentType = req.body?.document_type || 'DOCUMENT';
  if (!req.file) return res.status(400).json({ error: 'file requis' });

  const ext = path.extname(req.file.originalname || '') || '.bin';
  const fileName = `${sessionId}_${documentType}_${Date.now()}${ext}`;
  const filePath = path.join(UPLOADS_DIR, fileName);
  // Écriture asynchrone : un writeFileSync bloquait l'event loop le temps d'écrire l'image
  // (~150KB+) sur disque, sérialisant TOUTES les requêtes en cours. fs.promises.writeFile rend
  // la main à l'event loop pendant l'I/O disque (gros gain de débit sous charge).
  try {
    await fs.promises.writeFile(filePath, req.file.buffer);
  } catch (err) {
    console.error('[diaspora-otp] échec écriture document', err);
    return res.status(500).json({ error: 'Échec de l’enregistrement du document.' });
  }

  saveDocument({
    sessionId,
    documentType,
    filePath,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
  });
  res.json({ received: true });
});

// ---- Dossiers particulier ----
app.post('/api/applications', (req, res) => {
  const created = createApplication(req.body ?? {});
  res.status(201).json(created);
});
// Routes spécifiques d'abord — sinon '/:id' (générique, un seul segment) les intercepte
// avant qu'elles soient atteintes (Express matche dans l'ordre de déclaration).
app.get('/api/applications/status-by-email', (req, res) => {
  const found = getApplicationByEmail(String(req.query.email ?? ''));
  if (!found) return res.status(404).json({ error: 'Dossier introuvable.' });
  res.json(statusView(found));
});
app.get('/api/applications/status-by-contact', (req, res) => {
  const found = getApplicationByContact(String(req.query.identifier ?? ''));
  if (!found) return res.status(404).json({ error: 'Dossier introuvable.' });
  res.json(statusView(found));
});
app.get('/api/applications/status/:reference', (req, res) => {
  const found = getApplicationByReference(req.params.reference);
  if (!found) return res.status(404).json({ error: 'Dossier introuvable.' });
  res.json(statusView(found));
});
app.get('/api/applications/:id', (req, res) => {
  const found = getApplicationById(Number(req.params.id));
  if (!found) return res.status(404).json({ error: 'Dossier introuvable.' });
  res.json(found);
});

function statusView(application) {
  return {
    reference: application.reference,
    status: application.status,
    message: 'Dossier en cours de revue par nos équipes conformité.',
  };
}

// ---- Entreprise (squelette) ----
app.post('/api/enterprise-applications', (req, res) => {
  const created = createEnterpriseApplication(req.body ?? {});
  res.status(201).json(created);
});

app.listen(PORT, () => {
  console.log(`[diaspora-otp] écoute sur http://localhost:${PORT}`);
});
