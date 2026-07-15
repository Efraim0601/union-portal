import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { createProxyMiddleware } from 'http-proxy-middleware';
import {
  createOtpSession, getOtpSession, incrementOtpAttempts, markOtpVerified,
  saveDocument, createApplication, getApplicationById, getApplicationByReference,
  getApplicationByEmail, getApplicationByContact, createEnterpriseApplication,
  listAgencies, replaceAgencies, seedAgenciesIfEmpty,
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
const NATIONALITIES = [
  { code: 'CM', label: 'Camerounaise' }, { code: 'FR', label: 'Française' }, { code: 'GA', label: 'Gabonaise' },
  { code: 'US', label: 'Américaine' }, { code: 'BE', label: 'Belge' }, { code: 'CI', label: 'Ivoirienne' },
];
// Amorce de la table `agencies` (SQLite) au premier démarrage seulement — modifiable ensuite
// via /admin/parametrage (PUT ci-dessous), qui écrase ce jeu de départ.
seedAgenciesIfEmpty([
  { code: 'YDE01', name: 'Agence Yaoundé Centre', city: 'Yaoundé' },
  { code: 'DLA01', name: 'Agence Douala Akwa', city: 'Douala' },
  { code: 'PAR01', name: 'Agence Paris', city: 'Paris' },
]);

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

// ---- Pré-onboarding : documents (recto/verso, selfie, vidéo, justificatifs) ----
app.post('/api/pre-onboarding/:sessionId/documents', upload.single('file'), (req, res) => {
  const { sessionId } = req.params;
  const documentType = req.body?.document_type || 'DOCUMENT';
  if (!req.file) return res.status(400).json({ error: 'file requis' });

  const ext = path.extname(req.file.originalname || '') || '.bin';
  const fileName = `${sessionId}_${documentType}_${Date.now()}${ext}`;
  const filePath = path.join(UPLOADS_DIR, fileName);
  fs.writeFileSync(filePath, req.file.buffer);

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
