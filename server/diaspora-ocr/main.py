"""
Service OCR local pour le parcours diaspora : lit une pièce d'identité (CNI, carte de séjour,
carte consulaire ou passeport) et préremplit l'état civil du client.

Objectif : RÉCUPÉRATION maximale (extraire tout ce qui est lisible) plutôt que précision stricte.
Deux sources d'extraction combinées, sans qu'aucune ne bloque l'autre :

 1. MRZ (bande lisible en machine, ICAO 9303) — TD1 (CNI/carte, 3×30) ou TD3 (passeport, 2×44).
    Les clés de contrôle (somme pondérée 7-3-1 mod 10) sont calculées comme SIGNAL de confiance,
    mais un champ n'est PAS abandonné si sa clé échoue : sur une photo réelle l'OCR est rarement
    parfait, et tout rejeter donnait « aucune donnée extraite ». On garde donc la lecture MRZ et,
    à confiance égale, on préfère la valeur dont la clé est valide.

 2. Extraction par libellé sur le texte OCR brut (« NOM », « DATE DE NAISSANCE », « LIEU DE
    DÉLIVRANCE »...), en français comme en anglais, avec filtrage des mentions imprimées de la
    pièce. Couvre les champs absents de la MRZ (lieu de naissance, date/lieu de délivrance) et
    complète ceux que la MRZ n'a pas fournis.

Champs renvoyés (clés alignées sur documents-step.ts / ApplicationCreate) :
  last_name, first_name, birth_date, birth_place, nationality (code ISO-2 pour la liste
  déroulante), identity_document_number, identity_document_issue_date, identity_document_issue_place.

Prototype dev — dans le vrai backend (diaspora-onboarding, FastAPI), cette logique est portée
depuis document_auth_service.py / pre_onboarding.py.
"""
import io
import re
from datetime import date
from typing import Optional

import numpy as np
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from rapidocr_onnxruntime import RapidOCR

app = FastAPI(title="diaspora-ocr")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_ocr = RapidOCR()


def log(msg: str) -> None:
    print(msg, flush=True)  # flush=True : stdout bufferisé par bloc une fois redirigé/piped


# ---------------------------------------------------------------------------
# OCR — lignes triées de haut en bas (rôle fixe en MRZ, lecture des libellés + valeurs).
# ---------------------------------------------------------------------------
def _ocr_rows(image_bytes: bytes) -> list:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    result, _ = _ocr(np.array(img))
    if not result:
        return []
    # tri par Y du centre de la boîte englobante
    return sorted(result, key=lambda r: sum(p[1] for p in r[0]) / len(r[0]))


def ocr_texts(image_bytes: bytes) -> tuple[list[str], list[str]]:
    """Retourne (text_lines, mrz_lines) :
    - text_lines : casse/espaces d'origine, pour l'extraction par libellé ;
    - mrz_lines  : majuscules sans espace, pour le décodage MRZ."""
    rows = _ocr_rows(image_bytes)
    text_lines = [str(r[1]).strip() for r in rows if str(r[1]).strip()]
    mrz_lines = [str(r[1]).upper().replace(" ", "") for r in rows if str(r[1]).strip()]
    return text_lines, mrz_lines


# ---------------------------------------------------------------------------
# Normalisation (comparaison de libellés) — accents retirés, majuscules.
# ---------------------------------------------------------------------------
_ACCENTS = str.maketrans("ÉÈÊËÀÂÄÙÛÜÔÖÎÏÇ", "EEEEAAAUUUOOIIC")


def norm(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip().upper().translate(_ACCENTS)


# ---------------------------------------------------------------------------
# MRZ — ICAO 9303, TD1 (3×30) / TD3 (2×44). Clé de contrôle = signal de confiance.
# ---------------------------------------------------------------------------
_MRZ_CHARSET = re.compile(r"^[A-Z0-9<]+$")
_MRZ_WEIGHTS = (7, 3, 1)


def _mrz_char_value(ch: str) -> int:
    if ch == "<":
        return 0
    if ch.isdigit():
        return int(ch)
    if "A" <= ch <= "Z":
        return ord(ch) - ord("A") + 10
    return -1


def _mrz_check(data: str, check_char: str) -> bool:
    check_char = "0" if check_char == "<" else check_char
    if not check_char.isdigit():
        return False
    total = 0
    for i, ch in enumerate(data):
        v = _mrz_char_value(ch)
        if v < 0:
            return False
        total += v * _MRZ_WEIGHTS[i % 3]
    return total % 10 == int(check_char)


def _mrz_date(raw: str) -> Optional[str]:
    """AAMMJJ -> ISO. Pivot standard MRZ : > (année courante + 10) => XXe siècle."""
    if len(raw) != 6 or not raw.isdigit():
        return None
    yy, mm, dd = int(raw[0:2]), int(raw[2:4]), int(raw[4:6])
    if not (1 <= mm <= 12 and 1 <= dd <= 31):
        return None
    pivot = (date.today().year + 10) % 100
    century = 2000 if yy <= pivot else 1900
    try:
        return date(century + yy, mm, dd).isoformat()
    except ValueError:
        return None


def _mrz_names(field: str) -> tuple[str, str]:
    field = field.rstrip("<")
    parts = field.split("<<", 1)
    surname = " ".join(w for w in parts[0].split("<") if w)
    given = " ".join(w for w in parts[1].split("<") if w) if len(parts) > 1 else ""
    return surname.title(), given.title()


def _mrz_candidates(mrz_lines: list[str]) -> list[str]:
    return [l for l in mrz_lines if len(l) >= 28 and l.count("<") >= 2 and _MRZ_CHARSET.match(l)]


def _pad(line: str, n: int, tol: int = 4) -> Optional[str]:
    return line.ljust(n, "<")[:n] if abs(len(line) - n) <= tol else None


def _decode_td1(l1: str, l2: str, l3: str) -> Optional[dict]:
    l1, l2, l3 = _pad(l1, 30), _pad(l2, 30), _pad(l3, 30)
    if not (l1 and l2 and l3):
        return None
    doc = l1[5:14]
    surname, given = _mrz_names(l3)
    return {
        "last_name": surname or None, "first_name": given or None,
        "nationality": l2[15:18].replace("<", "") or None,
        "identity_document_number": doc.replace("<", "") or None,
        "birth_date": _mrz_date(l2[0:6]),
        "_valid": sum((_mrz_check(doc, l1[14]), _mrz_check(l2[0:6], l2[6]), _mrz_check(l2[8:14], l2[14]))),
    }


def _decode_td3(l1: str, l2: str) -> Optional[dict]:
    l1, l2 = _pad(l1, 44), _pad(l2, 44)
    if not (l1 and l2):
        return None
    doc = l2[0:9]
    rest = l1[5:] if l1.startswith("P") and len(l1) > 5 else l1
    surname, given = _mrz_names(rest)
    return {
        "last_name": surname or None, "first_name": given or None,
        "nationality": l2[10:13].replace("<", "") or None,
        "identity_document_number": doc.replace("<", "") or None,
        "birth_date": _mrz_date(l2[13:19]),
        "_valid": sum((_mrz_check(doc, l2[9]), _mrz_check(l2[13:19], l2[19]), _mrz_check(l2[21:27], l2[27]))),
    }


def extract_mrz(mrz_lines: list[str]) -> dict:
    cands = _mrz_candidates(mrz_lines)
    if not cands:
        return {}
    attempts = []
    for i in range(len(cands) - 1):
        d = _decode_td3(cands[i], cands[i + 1])
        if d:
            attempts.append(d)
    for i in range(len(cands) - 2):
        d = _decode_td1(cands[i], cands[i + 1], cands[i + 2])
        if d:
            attempts.append(d)
    if not attempts:
        return {}
    best = max(attempts, key=lambda a: a["_valid"])
    log(f"[diaspora-ocr] MRZ (clés valides {best['_valid']}/3) : {best}")
    out = {k: v for k, v in best.items() if k != "_valid" and v}
    return out


# ---------------------------------------------------------------------------
# Extraction par libellé — français / anglais. Filtrage des mentions imprimées.
# ---------------------------------------------------------------------------
_FORBIDDEN = {
    "REPUBLIQUE", "REPUBLIC", "CAMEROUN", "CAMEROON", "CARTE", "IDENTITE", "IDENTITY",
    "CARD", "NATIONALE", "NATIONAL", "PASSEPORT", "PASSPORT", "NATIONALITE", "NATIONALITY",
    "DATE", "NAISSANCE", "BIRTH", "SEXE", "SEX", "TAILLE", "HEIGHT", "SIGNATURE", "AUTORITE",
    "AUTHORITY", "DELIVRE", "DELIVREE", "DELIVRANCE", "ISSUE", "ISSUING", "EXPIRE",
    "EXPIRATION", "EXPIRY", "VALIDITE", "NUMERO", "NUMBER", "OCCUPATION", "PROFESSION",
    "PERE", "MERE", "FATHER", "MOTHER", "ADRESSE", "ADDRESS", "LIEU", "PLACE", "GIVEN",
    "NAMES", "NAME", "SURNAME", "NOM", "NOMS", "PRENOM", "PRENOMS", "FIRST", "LAST", "OF", "DE",
}


def _clean_name(value: str, max_words: int = 6) -> Optional[str]:
    v = norm(value)
    v = re.sub(r"[^A-Z\s'\-]", " ", v)
    v = re.sub(r"\s+", " ", v).strip()
    if not v:
        return None
    words = []
    for w in v.split():
        if w in _FORBIDDEN or len(w) < 2:
            continue
        # rejette les suites sans voyelle de 5+ lettres (bruit OCR)
        if len(w) >= 5 and not any(c in "AEIOUY" for c in w):
            continue
        words.append(w)
    if not words or len(words) > max_words:
        return None
    return " ".join(words).title()


def _value_near_label(lines: list[str], labels: list[str], forbidden_labels: list[str] = ()) -> Optional[str]:
    """Cherche une ligne contenant un libellé (et aucun libellé interdit), puis extrait la valeur
    après ':' sur la même ligne, ou sur l'une des lignes suivantes."""
    for i, line in enumerate(lines):
        nline = norm(line)
        if not any(lb in nline for lb in labels):
            continue
        if any(fb in nline for fb in forbidden_labels):
            continue
        # valeur après séparateur sur la même ligne
        parts = re.split(r"[:：]", line, maxsplit=1)
        if len(parts) == 2:
            c = _clean_name(parts[1])
            if c:
                return c
        # résidu de la même ligne, libellés retirés
        residue = nline
        for lb in labels:
            residue = residue.replace(lb, " ")
        c = _clean_name(residue)
        if c:
            return c
        # lignes suivantes
        for j in range(i + 1, min(i + 4, len(lines))):
            if any(x in norm(lines[j]) for x in ("NOM", "PRENOM", "SURNAME", "GIVEN", "DATE", "SEXE", "SEX", "NATIONAL", "LIEU", "PLACE")):
                continue
            c = _clean_name(lines[j])
            if c:
                return c
    return None


_MONTHS = {
    "JAN": 1, "JANV": 1, "JANVIER": 1, "JANUARY": 1, "FEV": 2, "FEVR": 2, "FEVRIER": 2, "FEB": 2, "FEBRUARY": 2,
    "MAR": 3, "MARS": 3, "MARCH": 3, "AVR": 4, "AVRIL": 4, "APR": 4, "APRIL": 4, "MAI": 5, "MAY": 5,
    "JUIN": 6, "JUN": 6, "JUNE": 6, "JUIL": 7, "JUL": 7, "JULY": 7, "AOU": 8, "AOUT": 8, "AUG": 8, "AUGUST": 8,
    "SEP": 9, "SEPT": 9, "SEPTEMBRE": 9, "SEPTEMBER": 9, "OCT": 10, "OCTOBRE": 10, "OCTOBER": 10,
    "NOV": 11, "NOVEMBRE": 11, "NOVEMBER": 11, "DEC": 12, "DECEMBRE": 12, "DECEMBER": 12,
}
_NUM_DATE = re.compile(r"\b(\d{1,2})[\s./\-]+(\d{1,2})[\s./\-]+(\d{4})\b")
_TXT_DATE = re.compile(r"\b(\d{1,2})[\s./\-]+([A-Z]{3,9})[\s./\-]+(\d{4})\b")


def _find_dates(text: str) -> list[str]:
    """Toutes les dates ISO trouvées dans `text` (numériques JJ MM AAAA + mois en toutes lettres)."""
    out = []
    n = norm(text)
    for dd, mm, yyyy in _NUM_DATE.findall(n):
        try:
            out.append(date(int(yyyy), int(mm), int(dd)).isoformat())
        except ValueError:
            pass
    for dd, mon, yyyy in _TXT_DATE.findall(n):
        m = _MONTHS.get(mon) or _MONTHS.get(mon[:4]) or _MONTHS.get(mon[:3])
        if m:
            try:
                out.append(date(int(yyyy), m, int(dd)).isoformat())
            except ValueError:
                pass
    return list(dict.fromkeys(out))


def _date_near_label(lines: list[str], labels: list[str]) -> Optional[str]:
    for i, line in enumerate(lines):
        if any(lb in norm(line) for lb in labels):
            dates = _find_dates(" ".join(lines[i:i + 3]))
            if dates:
                return dates[0]
    return None


def _doc_number(lines: list[str]) -> Optional[str]:
    joined = norm(" ".join(lines))
    for pat in (
        r"\bNUMERO\s+CNI\s*/?\s*NIC\s+NUMBER\s*[:\-]?\s*([A-Z0-9]{6,20})",
        r"\bNIC\s+NUMBER\s*[:\-]?\s*([A-Z0-9]{6,20})",
        r"\bIDENTIFIANT\s+UNIQUE\s*[:\-]?\s*([A-Z0-9]{6,20})",
        r"\bUNIQUE\s+IDENTIFIER\s*[:\-]?\s*([A-Z0-9]{6,20})",
        r"\bN[°O]?\s*CNI\s*[:\-]?\s*([A-Z0-9]{6,20})",
        r"\bCNI\s*[:\-]?\s*([A-Z0-9]{6,20})",
        r"\bPASSEPORT\s*(?:NO|N°|NUMBER)?\s*[:\-]?\s*([A-Z0-9]{5,15})",
        r"\bPASSPORT\s*(?:NO|N°|NUMBER)?\s*[:\-]?\s*([A-Z0-9]{5,15})",
    ):
        m = re.search(pat, joined)
        if m:
            return m.group(1)
    # repli : long identifiant CNI camerounais (souvent ~15-20 chiffres commençant par 20…)
    m = re.search(r"\b(20\d{13,17})\b", joined)
    if m:
        return m.group(1)
    return None


# Nationalité (libellé FR ou code ISO-3 MRZ) -> code ISO-2 de la liste déroulante du formulaire.
_NAT_TO_ISO2 = {
    "CMR": "CM", "CAMEROUNAISE": "CM", "CAMEROUNAIS": "CM",
    "FRA": "FR", "FRANCAISE": "FR", "FRANCAIS": "FR",
    "GAB": "GA", "GABONAISE": "GA", "GABONAIS": "GA",
    "TCD": "TD", "TCHADIENNE": "TD", "TCHADIEN": "TD",
    "CAF": "CF", "CENTRAFRICAINE": "CF",
    "GNQ": "GQ", "GUINEENNE": "GN", "GIN": "GN",
    "COG": "CG", "CONGOLAISE": "CG", "COD": "CD",
    "CIV": "CI", "IVOIRIENNE": "CI", "IVOIRIEN": "CI",
    "SEN": "SN", "SENEGALAISE": "SN", "SENEGALAIS": "SN",
    "MLI": "ML", "MALIENNE": "ML", "BEN": "BJ", "BENINOISE": "BJ",
    "TGO": "TG", "TOGOLAISE": "TG", "NGA": "NG", "NIGERIANE": "NG",
    "BEL": "BE", "BELGE": "BE", "DEU": "DE", "ALLEMANDE": "DE",
    "USA": "US", "AMERICAINE": "US", "CAN": "CA", "CANADIENNE": "CA",
    "GBR": "GB", "BRITANNIQUE": "GB", "ITA": "IT", "ITALIENNE": "IT",
    "ESP": "ES", "ESPAGNOLE": "ES", "CHE": "CH", "SUISSE": "CH",
    "NLD": "NL", "NEERLANDAISE": "NL",
}


def _nationality_code(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    key = norm(raw).replace(" ", "")
    if key in _NAT_TO_ISO2:
        return _NAT_TO_ISO2[key]
    # code ISO-2 déjà valide (2 lettres) : on le garde tel quel
    if len(key) == 2 and key.isalpha():
        return key
    return None


def extract_by_label(text_lines: list[str]) -> dict:
    out: dict = {}
    ln = _value_near_label(text_lines, ["NOM", "SURNAME"], forbidden_labels=["PRENOM", "GIVEN", "FIRST"])
    if ln:
        out["last_name"] = ln
    fn = _value_near_label(text_lines, ["PRENOM", "GIVEN NAME", "GIVEN NAMES", "FIRST NAME"], forbidden_labels=["SURNAME", "LAST NAME"])
    if fn:
        out["first_name"] = fn
    bd = _date_near_label(text_lines, ["DATE DE NAISSANCE", "DATE OF BIRTH", "NE LE", "NEE LE", "BIRTH"])
    if bd:
        out["birth_date"] = bd
    bp = _value_near_label(text_lines, ["LIEU DE NAISSANCE", "PLACE OF BIRTH"])
    if bp:
        out["birth_place"] = bp
    idate = _date_near_label(text_lines, ["DATE DE DELIVRANCE", "DATE OF ISSUE", "DELIVRANCE", "ISSUE"])
    if idate:
        out["identity_document_issue_date"] = idate
    iplace = _value_near_label(text_lines, ["LIEU DE DELIVRANCE", "DELIVRE A", "DELIVREE A", "PLACE OF ISSUE", "ISSUED AT"])
    if iplace:
        out["identity_document_issue_place"] = iplace
    nat = _value_near_label(text_lines, ["NATIONALITE", "NATIONALITY"])
    if nat:
        out["nationality"] = nat
    dn = _doc_number(text_lines)
    if dn:
        out["identity_document_number"] = dn
    return out


# Clés finales attendues par le frontend (documents-step.ts).
_FRONTEND_KEYS = (
    "last_name", "first_name", "birth_date", "birth_place", "nationality",
    "identity_document_number", "identity_document_issue_date", "identity_document_issue_place",
)


def extract_from_image(content: bytes, *, label: str) -> dict:
    text_lines, mrz_lines = ocr_texts(content)
    log(f"[diaspora-ocr] {label}: {len(text_lines)} ligne(s) OCR : {text_lines}")

    fields: dict = {}
    # MRZ d'abord (structuré) — prioritaire pour noms / n° / date de naissance / nationalité.
    fields.update(extract_mrz(mrz_lines))
    # Libellés — complètent, sans écraser une valeur MRZ déjà présente.
    for k, v in extract_by_label(text_lines).items():
        fields.setdefault(k, v)

    # Nationalité -> code ISO-2 pour la liste déroulante (sinon le champ reste vide côté form).
    if "nationality" in fields:
        code = _nationality_code(fields["nationality"])
        if code:
            fields["nationality"] = code
        else:
            fields.pop("nationality")  # texte non mappable : inutile pour un <select>

    result = {k: fields[k] for k in _FRONTEND_KEYS if fields.get(k)}
    log(f"[diaspora-ocr] {label}: champs extraits : {result}")
    return result


# ---------------------------------------------------------------------------
# Qualité image — luminosité, reflets, netteté (variance du Laplacien).
# ---------------------------------------------------------------------------
def assess_quality(image_bytes: bytes) -> dict:
    try:
        gray = np.asarray(Image.open(io.BytesIO(image_bytes)).convert("L"), dtype=np.float64)
        brightness = float(gray.mean())
        glare = float((gray >= 248).mean())
        lap = (4 * gray[1:-1, 1:-1] - gray[:-2, 1:-1] - gray[2:, 1:-1] - gray[1:-1, :-2] - gray[1:-1, 2:])
        sharp = float(lap.var()) if lap.size else 0.0

        issues, score = [], 100
        if brightness < 55:
            score -= 35; issues.append("Image trop sombre")
        elif brightness > 210:
            score -= 25; issues.append("Image trop claire")
        if glare > 0.10:
            score -= 25; issues.append("Reflet ou surexposition détecté")
        if sharp < 70:
            score -= 40; issues.append("Image floue")
        elif sharp < 120:
            score -= 15; issues.append("Netteté moyenne")

        score = max(0, min(100, score))
        return {
            "score": score, "verdict": "OK" if score >= 65 else "LOW_QUALITY",
            "issues": issues or ["Qualité image acceptable"],
            "brightness": round(brightness, 2), "laplacian_variance": round(sharp, 2),
            "glare_fraction": round(glare, 4),
        }
    except Exception as e:
        return {"score": 50, "verdict": "NOT_ANALYZED", "issues": [f"Contrôle qualité indisponible : {e}"]}


# ---------------------------------------------------------------------------
# Endpoints.
# ---------------------------------------------------------------------------
@app.post("/extract")
async def extract(
    recto: UploadFile = File(...),
    verso: Optional[UploadFile] = File(None),
    document_type: str = Form("CNI"),
):
    fields: dict = {}
    quality: dict = {}
    # Verso d'abord : la MRZ vit au dos d'une carte (CNI / séjour / consulaire).
    for side, label in filter(lambda t: t[0], [(verso, "verso"), (recto, "recto")]):
        content = await side.read()
        try:
            parsed = extract_from_image(content, label=label)
        except Exception as e:
            log(f"[diaspora-ocr] {label}: échec OCR — {e}")
            parsed = {}
        for k, v in parsed.items():
            fields.setdefault(k, v)
        quality[label] = assess_quality(content)
    log(f"[diaspora-ocr] résultat final fusionné : {fields}")
    return {**fields, "quality": quality}


@app.post("/quality")
async def quality(file: UploadFile = File(...)):
    return assess_quality(await file.read())


BP_PATTERN = re.compile(r"B[\s.]*P[\s.]*[:\-]?\s*(\d{2,6})", re.IGNORECASE)


@app.post("/extract-address")
async def extract_address(file: UploadFile = File(...)):
    """OCR best-effort d'un plan de localisation (souvent manuscrit) — renvoie le texte détecté
    comme suggestion d'adresse + une boîte postale si un motif « BP <numéro> » est repéré."""
    content = await file.read()
    try:
        text_lines, _ = ocr_texts(content)
    except Exception as e:
        log(f"[diaspora-ocr] extract-address: échec OCR — {e}")
        return {}
    log(f"[diaspora-ocr] extract-address: {len(text_lines)} ligne(s) : {text_lines}")

    postal_box: Optional[str] = None
    address_lines: list[str] = []
    for line in text_lines:
        m = BP_PATTERN.search(line)
        if m and not postal_box:
            postal_box = f"BP {m.group(1)}"
            continue
        address_lines.append(line)

    result: dict = {}
    if address_lines:
        result["address_location"] = " ".join(address_lines)[:300]
    if postal_box:
        result["postal_box"] = postal_box
    log(f"[diaspora-ocr] extract-address: résultat {result}")
    return result


@app.get("/health")
def health():
    return {"status": "ok"}
