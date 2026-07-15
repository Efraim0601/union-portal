"""
Service OCR local pour le parcours diaspora : lit une pièce d'identité (CNI, carte de séjour,
carte consulaire ou passeport) pour préremplir l'état civil du client.

Deux stratégies d'extraction, dans cet ordre :
 1. MRZ (bande lisible en machine, norme ICAO 9303) — TD1 (CNI/carte, 3 lignes de 30) ou
    TD3 (passeport, 2 lignes de 44). Chaque champ n'est retenu QUE si sa clé de contrôle
    (somme pondérée 7-3-1 mod 10) est valide : mieux vaut ne rien préremplir qu'un champ
    mal lu par l'OCR mais syntaxiquement plausible.
 2. À défaut de MRZ exploitable (verso illisible, CNI sans bande MRZ, mauvais cadrage...),
    repli par libellé dans le texte OCR brut (« NOM », « DATE DE NAISSANCE »...). Moins
    fiable (pas de clé de contrôle) : n'est utilisé que pour compléter les champs que la
    MRZ n'a pas fournis, jamais pour écraser une valeur déjà validée.

Un score de qualité image (luminosité, reflets, netteté) accompagne la réponse d'extraction,
et un endpoint dédié /quality permet de le demander seul — utile côté client pour les imports
depuis la galerie, qui échappent au contrôle qualité en direct (cf. photo-capture.ts :
onFileSelected() n'appelle pas assessDocument()).

Prototype dev — dans le vrai backend (diaspora-onboarding, FastAPI, dépôt séparé), cette
logique devrait être portée telle quelle ou remplacée par un moteur KYC dédié.
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

MRZ_CHARSET = re.compile(r"^[A-Z0-9<]+$")


def log(msg: str) -> None:
    print(msg, flush=True)  # flush=True : stdout bufferisé par bloc une fois redirigé/piped


def _ocr_rows(image_bytes: bytes) -> list:
    """Résultats OCR bruts, triés de haut en bas (position Y de la boîte englobante)."""
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    result, _ = _ocr(np.array(img))
    if not result:
        return []
    return sorted(result, key=lambda r: sum(p[1] for p in r[0]) / len(r[0]))


def ocr_lines(image_bytes: bytes) -> list[str]:
    """Lignes MRZ : majuscules, sans espace (la MRZ n'en contient jamais)."""
    return [str(r[1]).upper().replace(" ", "") for r in _ocr_rows(image_bytes)]


def ocr_lines_freetext(image_bytes: bytes) -> list[str]:
    """Lignes de texte libre (plan de localisation, repli par libellé...) : casse et espaces
    d'origine conservés, contrairement à `ocr_lines` (spécifique MRZ) — la mise en page n'est
    pas normée et les espaces sont nécessaires pour repérer un libellé puis lire sa valeur."""
    return [str(r[1]).strip() for r in _ocr_rows(image_bytes) if str(r[1]).strip()]


# ---------------------------------------------------------------------------
# MRZ — norme ICAO 9303. TD1 (carte, 3x30) / TD3 (passeport, 2x44), clés de contrôle.
# ---------------------------------------------------------------------------
_MRZ_WEIGHTS = (7, 3, 1)


def _mrz_char_value(ch: str) -> int:
    if ch == "<":
        return 0
    if ch.isdigit():
        return int(ch)
    if "A" <= ch <= "Z":
        return ord(ch) - ord("A") + 10
    return -1


def _mrz_check_digit(data: str) -> Optional[int]:
    total = 0
    for i, ch in enumerate(data):
        value = _mrz_char_value(ch)
        if value < 0:
            return None
        total += value * _MRZ_WEIGHTS[i % 3]
    return total % 10


def _mrz_verify(data: str, check_char: str) -> bool:
    """Une clé de contrôle MRZ mal imprimée/lue peut être '<' (traité comme 0)."""
    check_char = "0" if check_char == "<" else check_char
    if not check_char.isdigit():
        return False
    computed = _mrz_check_digit(data)
    return computed is not None and computed == int(check_char)


def mrz_date(raw: str) -> Optional[str]:
    """AAMMJJ (année sur 2 chiffres) -> ISO 8601. Pivot standard MRZ : au-delà de
    (année courante + 10), on interprète comme XIXe/XXe siècle plutôt que XXIe."""
    if len(raw) != 6 or not raw.isdigit():
        return None
    yy, mm, dd = int(raw[0:2]), int(raw[2:4]), int(raw[4:6])
    if not (1 <= mm <= 12) or not (1 <= dd <= 31):
        return None
    pivot = (date.today().year + 10) % 100
    century = 2000 if yy <= pivot else 1900
    try:
        return date(century + yy, mm, dd).isoformat()
    except ValueError:
        return None


def parse_names(field: str) -> tuple[str, str]:
    """'SURNAME<<GIVEN<NAMES<<<<' -> ('Surname', 'Given Names')."""
    field = field.rstrip("<")
    parts = field.split("<<", 1)
    surname = " ".join(w for w in parts[0].split("<") if w)
    given = " ".join(w for w in parts[1].split("<") if w) if len(parts) > 1 else ""
    return surname.title(), given.title()


def _mrz_candidate_lines(lines: list[str]) -> list[str]:
    """Lignes qui ressemblent à de la MRZ : charset restreint, longueur d'un format standard,
    et suffisamment de '<' — quasi inexistant dans du texte imprimé normal (nom, mentions...),
    c'est ce qui distingue le plus fiablement une vraie ligne MRZ du reste du texte de la pièce."""
    out = []
    for line in lines:
        if len(line) >= 28 and line.count("<") >= 2 and MRZ_CHARSET.match(line):
            out.append(line)
    return out


def _pad_or_trim(line: str, target_len: int, tolerance: int = 4) -> Optional[str]:
    if abs(len(line) - target_len) > tolerance:
        return None
    return line.ljust(target_len, "<")[:target_len]


def _decode_td1(line1: str, line2: str, line3: str) -> Optional[dict]:
    """CNI / carte de séjour / carte consulaire — 3 lignes de 30 : 1=document, 2=biodata, 3=noms."""
    line1, line2, line3 = _pad_or_trim(line1, 30), _pad_or_trim(line2, 30), _pad_or_trim(line3, 30)
    if not (line1 and line2 and line3):
        return None

    doc_number_field = line1[5:14]
    birth_raw, expiry_raw = line2[0:6], line2[8:14]
    surname, given = parse_names(line3)

    return {
        "last_name": surname or None,
        "first_name": given or None,
        "nationality": line2[15:18].replace("<", "") or None,
        "identity_document_number": doc_number_field.replace("<", "") or None,
        "identity_document_number_valid": _mrz_verify(doc_number_field, line1[14]),
        "birth_date": mrz_date(birth_raw),
        "birth_date_valid": _mrz_verify(birth_raw, line2[6]),
        "expiry_date_valid": _mrz_verify(expiry_raw, line2[14]),
    }


def _decode_td3(line1: str, line2: str) -> Optional[dict]:
    """Passeport — 2 lignes de 44 : 1=noms, 2=biodata."""
    line1, line2 = _pad_or_trim(line1, 44), _pad_or_trim(line2, 44)
    if not (line1 and line2):
        return None

    doc_number_field = line2[0:9]
    birth_raw, expiry_raw = line2[13:19], line2[21:27]
    rest = line1[5:] if line1.startswith("P") and len(line1) > 5 else line1
    surname, given = parse_names(rest)

    return {
        "last_name": surname or None,
        "first_name": given or None,
        "nationality": line2[10:13].replace("<", "") or None,
        "identity_document_number": doc_number_field.replace("<", "") or None,
        "identity_document_number_valid": _mrz_verify(doc_number_field, line2[9]),
        "birth_date": mrz_date(birth_raw),
        "birth_date_valid": _mrz_verify(birth_raw, line2[19]),
        "expiry_date_valid": _mrz_verify(expiry_raw, line2[27]),
    }


def parse_mrz(lines: list[str]) -> dict:
    """Essaie tous les regroupements de lignes candidates en TD3 puis TD1, retient le
    décodage avec le plus de clés de contrôle valides, et NE GARDE que les champs dont la
    clé de contrôle est valide (nom/prénom/nationalité n'ont pas de clé dédiée en MRZ et
    sont donc toujours repris tels quels — c'est le n° de pièce et la date de naissance
    qui bénéficient de la vérification)."""
    candidates = _mrz_candidate_lines(lines)
    if not candidates:
        return {}

    attempts = []
    for i in range(len(candidates) - 1):
        decoded = _decode_td3(candidates[i], candidates[i + 1])
        if decoded:
            attempts.append(decoded)
    for i in range(len(candidates) - 2):
        decoded = _decode_td1(candidates[i], candidates[i + 1], candidates[i + 2])
        if decoded:
            attempts.append(decoded)

    if not attempts:
        return {}

    def score(a: dict) -> int:
        return sum(1 for k in ("identity_document_number_valid", "birth_date_valid", "expiry_date_valid") if a.get(k))

    best = max(attempts, key=score)
    log(f"[diaspora-ocr] MRZ décodée (score {score(best)}/3) : {best}")

    out: dict = {}
    if best.get("last_name"):
        out["last_name"] = best["last_name"]
    if best.get("first_name"):
        out["first_name"] = best["first_name"]
    if best.get("nationality"):
        out["nationality"] = best["nationality"]
    if best.get("identity_document_number_valid") and best.get("identity_document_number"):
        out["identity_document_number"] = best["identity_document_number"]
    if best.get("birth_date_valid") and best.get("birth_date"):
        out["birth_date"] = best["birth_date"]
    return out


# ---------------------------------------------------------------------------
# Repli par libellé — utilisé seulement pour COMPLÉTER les champs que la MRZ n'a pas
# fournis (verso illisible, CNI sans bande MRZ...). Sans clé de contrôle : nécessairement
# moins fiable, d'où l'exigence d'une correspondance sur le libellé avant de retenir une
# valeur, et le filtrage des mots interdits (mentions imprimées de la pièce).
# ---------------------------------------------------------------------------
_ACCENTS = str.maketrans("ÉÈÊÀÂÙÛÔÇ", "EEEAAUUOC")


def normalize_text(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip().upper().translate(_ACCENTS)


_NAME_FORBIDDEN = {
    "REPUBLIQUE", "REPUBLIC", "CAMEROUN", "CAMEROON", "CARTE", "IDENTITE", "IDENTITY",
    "CARD", "PASSEPORT", "PASSPORT", "NATIONALITE", "NATIONALITY", "DATE", "NAISSANCE",
    "BIRTH", "SEXE", "SEX", "TAILLE", "HEIGHT", "SIGNATURE", "AUTORITE", "AUTHORITY",
    "DELIVRE", "DELIVREE", "ISSUE", "EXPIRE", "EXPIRATION", "VALIDITE", "NUMERO",
    "NUMBER", "OCCUPATION", "PROFESSION", "PERE", "MERE", "FATHER", "MOTHER",
    "ADRESSE", "ADDRESS", "LIEU", "PLACE",
}


def _clean_text_candidate(value: str, *, max_words: int = 6) -> Optional[str]:
    value = normalize_text(value)
    value = re.sub(r"[^A-Z\s'\-]", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    if not value:
        return None
    words = [w for w in value.split() if w not in _NAME_FORBIDDEN and len(w) >= 2]
    if not words or len(words) > max_words:
        return None
    return " ".join(words).title()


def _value_near_label(lines: list[str], label_patterns: list[str]) -> Optional[str]:
    """Cherche un libellé (ex. 'NOM', 'LIEU DE NAISSANCE') puis extrait la valeur juste
    après ':' sur la même ligne, ou sur l'une des 3 lignes suivantes à défaut."""
    for i, line in enumerate(lines):
        nline = normalize_text(line)
        if not any(re.search(p, nline) for p in label_patterns):
            continue

        parts = re.split(r"[:\-]", line, maxsplit=1)
        if len(parts) == 2:
            candidate = _clean_text_candidate(parts[1])
            if candidate:
                return candidate

        residue = nline
        for p in label_patterns:
            residue = re.sub(p, " ", residue)
        candidate = _clean_text_candidate(residue)
        if candidate:
            return candidate

        for j in range(i + 1, min(i + 4, len(lines))):
            candidate = _clean_text_candidate(lines[j])
            if candidate:
                return candidate
    return None


_DATE_PATTERN = re.compile(r"\b(\d{2})[./-](\d{2})[./-](\d{4})\b")


def _date_near_label(lines: list[str], label_patterns: list[str]) -> Optional[str]:
    for i, line in enumerate(lines):
        nline = normalize_text(line)
        if not any(re.search(p, nline) for p in label_patterns):
            continue
        window = " ".join(lines[i:i + 3])
        m = _DATE_PATTERN.search(window)
        if m:
            dd, mm, yyyy = m.groups()
            try:
                return date(int(yyyy), int(mm), int(dd)).isoformat()
            except ValueError:
                continue
    return None


def _identity_number_near_label(lines: list[str]) -> Optional[str]:
    joined = normalize_text(" ".join(lines))
    patterns = [
        r"\bN[°O]\s*CNI\s*[:\-]?\s*([A-Z0-9]{6,20})",
        r"\bCNI\s*[:\-]?\s*([A-Z0-9]{6,20})",
        r"\bIDENTIFIANT\s+UNIQUE\s*[:\-]?\s*([A-Z0-9]{6,20})",
        r"\bPASSEPORT\s*[:\-]?\s*([A-Z0-9]{5,15})",
        r"\bPASSPORT\s*(?:NO|N°|NUMBER)?\s*[:\-]?\s*([A-Z0-9]{5,15})",
    ]
    for pattern in patterns:
        m = re.search(pattern, joined)
        if m:
            return m.group(1)
    return None


def extract_by_label(lines: list[str]) -> dict:
    """Repli sans MRZ : ne couvre PAS la nationalité (un mot libre comme "CAMEROUNAISE"
    ne correspond à aucun code de la liste des nationalités du formulaire — seule la MRZ,
    qui donne un code ISO à 3 lettres, alimente ce champ)."""
    out: dict = {}

    last_name = _value_near_label(lines, [r"\bNOMS?\b", r"\bSURNAME\b"])
    if last_name:
        out["last_name"] = last_name

    first_name = _value_near_label(lines, [r"\bPRENOMS?\b", r"\bGIVEN\s*NAMES?\b", r"\bFIRST\s*NAME\b"])
    if first_name:
        out["first_name"] = first_name

    birth_date = _date_near_label(lines, [r"\bDATE\s*DE\s*NAISSANCE\b", r"\bDATE\s*OF\s*BIRTH\b", r"\bNE\(?E?\)?\s*LE\b"])
    if birth_date:
        out["birth_date"] = birth_date

    birth_place = _value_near_label(lines, [r"\bLIEU\s*DE\s*NAISSANCE\b", r"\bPLACE\s*OF\s*BIRTH\b"])
    if birth_place:
        out["birth_place"] = birth_place

    issue_date = _date_near_label(lines, [r"\bDATE\s*DE\s*DELIVRANCE\b", r"\bDATE\s*OF\s*ISSUE\b"])
    if issue_date:
        out["identity_document_issue_date"] = issue_date

    issue_place = _value_near_label(lines, [r"\bDELIVRE(?:E)?\s*A\b", r"\bLIEU\s*DE\s*DELIVRANCE\b"])
    if issue_place:
        out["identity_document_issue_place"] = issue_place

    doc_number = _identity_number_near_label(lines)
    if doc_number:
        out["identity_document_number"] = doc_number

    return out


def extract_from_image(content: bytes, document_type: str, *, label: str) -> dict:
    rows = _ocr_rows(content)
    mrz_lines = [str(r[1]).upper().replace(" ", "") for r in rows]
    text_lines = [str(r[1]).strip() for r in rows if str(r[1]).strip()]
    log(f"[diaspora-ocr] {label}: {len(text_lines)} ligne(s) OCR brute(s) : {text_lines}")

    parsed = parse_mrz(mrz_lines)

    if not parsed.get("last_name") or not parsed.get("first_name"):
        fallback = extract_by_label(text_lines)
        log(f"[diaspora-ocr] {label}: repli par libellé (pas de MRZ exploitable) : {fallback}")
        for k, v in fallback.items():
            parsed.setdefault(k, v)

    log(f"[diaspora-ocr] {label}: champs extraits : {parsed}")
    return parsed


# ---------------------------------------------------------------------------
# Qualité image — luminosité, reflets, netteté (variance du Laplacien). Même méthode que
# le contrôle client (image-quality.ts), en repli côté serveur pour les imports depuis la
# galerie, qui échappent au contrôle qualité en direct (cf. photo-capture.ts).
# ---------------------------------------------------------------------------
def assess_quality(image_bytes: bytes) -> dict:
    try:
        gray = np.asarray(Image.open(io.BytesIO(image_bytes)).convert("L"), dtype=np.float64)

        brightness = float(gray.mean())
        glare_fraction = float((gray >= 248).mean())

        lap = (
            4 * gray[1:-1, 1:-1]
            - gray[:-2, 1:-1] - gray[2:, 1:-1]
            - gray[1:-1, :-2] - gray[1:-1, 2:]
        )
        laplacian_variance = float(lap.var()) if lap.size else 0.0

        issues: list[str] = []
        score = 100
        if brightness < 55:
            score -= 35
            issues.append("Image trop sombre")
        elif brightness > 210:
            score -= 25
            issues.append("Image trop claire")
        if glare_fraction > 0.10:
            score -= 25
            issues.append("Reflet ou surexposition détecté")
        if laplacian_variance < 70:
            score -= 40
            issues.append("Image floue")
        elif laplacian_variance < 120:
            score -= 15
            issues.append("Netteté moyenne")

        score = max(0, min(100, score))
        return {
            "score": score,
            "verdict": "OK" if score >= 65 else "LOW_QUALITY",
            "issues": issues or ["Qualité image acceptable"],
            "brightness": round(brightness, 2),
            "laplacian_variance": round(laplacian_variance, 2),
            "glare_fraction": round(glare_fraction, 4),
        }
    except Exception as e:
        return {"score": 50, "verdict": "NOT_ANALYZED", "issues": [f"Contrôle qualité indisponible : {e}"]}


@app.post("/extract")
async def extract(
    recto: UploadFile = File(...),
    verso: Optional[UploadFile] = File(None),
    document_type: str = Form("CNI"),
):
    fields: dict = {}
    quality: dict = {}
    # Verso d'abord : c'est là que vit la MRZ pour une carte (CNI/séjour/consulaire).
    for side, label in filter(lambda t: t[0], [(verso, "verso"), (recto, "recto")]):
        content = await side.read()
        try:
            parsed = extract_from_image(content, document_type, label=label)
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
    """Scoring qualité seul (sans OCR) — pour valider une photo importée depuis la galerie
    avant de l'envoyer à /extract, ou pour donner un retour immédiat côté client."""
    return assess_quality(await file.read())


BP_PATTERN = re.compile(r"B[\s.]*P[\s.]*[:\-]?\s*(\d{2,6})", re.IGNORECASE)


@app.post("/extract-address")
async def extract_address(file: UploadFile = File(...)):
    """OCR best-effort d'un plan de localisation (souvent manuscrit/dessiné à la main) —
    beaucoup moins fiable qu'une MRZ imprimée normée : renvoie le texte détecté tel quel comme
    suggestion d'adresse, plus une boîte postale si un motif « BP <numéro> » est repéré.
    L'utilisateur reste toujours libre de corriger (cf. documents-step.ts côté frontend)."""
    content = await file.read()
    try:
        lines = ocr_lines_freetext(content)
    except Exception as e:
        log(f"[diaspora-ocr] extract-address: échec OCR — {e}")
        return {}
    log(f"[diaspora-ocr] extract-address: {len(lines)} ligne(s) OCR : {lines}")

    postal_box: Optional[str] = None
    address_lines: list[str] = []
    for line in lines:
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
