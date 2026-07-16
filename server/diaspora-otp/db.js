import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'diaspora.db'));
db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS pre_onboarding_sessions (
    id TEXT PRIMARY KEY,
    phone TEXT NOT NULL,
    otp_code TEXT NOT NULL,
    otp_expires_at INTEGER NOT NULL,
    otp_attempts INTEGER NOT NULL DEFAULT 0,
    otp_verified INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT UNIQUE NOT NULL,
    client_type TEXT NOT NULL DEFAULT 'PARTICULIER',
    email TEXT,
    whatsapp_phone_full TEXT,
    status TEXT NOT NULL DEFAULT 'EN_COURS_DE_TRAITEMENT',
    pre_onboarding_session_id TEXT,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_applications_email ON applications(email);
  CREATE INDEX IF NOT EXISTS idx_applications_phone ON applications(whatsapp_phone_full);
  CREATE INDEX IF NOT EXISTS idx_applications_session ON applications(pre_onboarding_session_id);

  CREATE TABLE IF NOT EXISTS enterprise_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT UNIQUE NOT NULL,
    email TEXT,
    phone TEXT,
    status TEXT NOT NULL DEFAULT 'EN_COURS_DE_TRAITEMENT',
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_enterprise_email ON enterprise_applications(email);
  CREATE INDEX IF NOT EXISTS idx_enterprise_phone ON enterprise_applications(phone);

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    application_id INTEGER,
    document_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    original_name TEXT,
    mime_type TEXT,
    size_bytes INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_documents_session ON documents(session_id);
  CREATE INDEX IF NOT EXISTS idx_documents_application ON documents(application_id);

  -- reseau/region/active : mêmes champs qu'AgencyDto côté promote (projects/promote/src/app/
  -- core/models.ts), pour pouvoir réconcilier sans migration si les deux backends sont un jour
  -- reliés — aucun pont ne les relie aujourd'hui (promoteApp, Spring Boot, absent de ce dépôt).
  CREATE TABLE IF NOT EXISTS agencies (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    city TEXT,
    reseau TEXT,
    region TEXT,
    active INTEGER NOT NULL DEFAULT 1
  );

  -- Listes KYC paramétrables (secteurs, professions, tranches de revenu, etc.) + sous-secteurs
  -- (sector_code renseigné uniquement pour kind='subsectors') — éditées via /admin/parametrage.
  CREATE TABLE IF NOT EXISTS lookups (
    kind TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    sector_code TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (kind, code)
  );

  CREATE TABLE IF NOT EXISTS packages (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tagline TEXT,
    currency TEXT NOT NULL DEFAULT 'XAF',
    opening_fee REAL NOT NULL DEFAULT 0,
    subscription_fee REAL NOT NULL DEFAULT 0,
    monthly_fee REAL NOT NULL DEFAULT 0,
    payment_required INTEGER NOT NULL DEFAULT 0,
    features TEXT NOT NULL DEFAULT '[]',
    sort_order INTEGER NOT NULL DEFAULT 0
  );
`);

// Migration idempotente : une base créée avant l'ajout de reseau/region/active n'a que
// (code, name, city) — `CREATE TABLE IF NOT EXISTS` ne les ajoute pas rétroactivement.
for (const col of ['reseau TEXT', 'region TEXT', "active INTEGER NOT NULL DEFAULT 1"]) {
  try {
    db.exec(`ALTER TABLE agencies ADD COLUMN ${col}`);
  } catch (e) {
    if (!String(e.message).includes('duplicate column')) throw e;
  }
}

const now = () => Date.now();
const genReference = (prefix) => `AFR-${prefix}-${crypto.randomInt(100000, 999999)}`;

// ---- Pré-onboarding : sessions OTP WhatsApp ----
// `sessionId` est désormais fourni par le CLIENT (cf. contrat du vrai backend FastAPI,
// aligné dans diaspora-api.service.ts / otp-step.ts) — identique entre l'envoi et la
// vérification, donc UPSERT plutôt qu'INSERT pour couvrir un renvoi de code.
export function createOtpSession(sessionId, phone, code, ttlMs) {
  const ts = now();
  db.prepare(
    `INSERT INTO pre_onboarding_sessions (id, phone, otp_code, otp_expires_at, otp_attempts, otp_verified, created_at)
     VALUES (?, ?, ?, ?, 0, 0, ?)
     ON CONFLICT(id) DO UPDATE SET
       phone = excluded.phone, otp_code = excluded.otp_code, otp_expires_at = excluded.otp_expires_at,
       otp_attempts = 0, otp_verified = 0`,
  ).run(sessionId, phone, code, ts + ttlMs, ts);
  return sessionId;
}

export function getOtpSession(sessionId) {
  return db.prepare(`SELECT * FROM pre_onboarding_sessions WHERE id = ?`).get(sessionId);
}

export function incrementOtpAttempts(id) {
  db.prepare(`UPDATE pre_onboarding_sessions SET otp_attempts = otp_attempts + 1 WHERE id = ?`).run(id);
}

export function markOtpVerified(id) {
  db.prepare(`UPDATE pre_onboarding_sessions SET otp_verified = 1 WHERE id = ?`).run(id);
}

// ---- Documents (recto/verso pièce d'identité, selfie, vidéo, justificatifs) ----
export function saveDocument({ sessionId, applicationId, documentType, filePath, originalName, mimeType, sizeBytes }) {
  const info = db.prepare(
    `INSERT INTO documents (session_id, application_id, document_type, file_path, original_name, mime_type, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(sessionId ?? null, applicationId ?? null, documentType, filePath, originalName ?? null, mimeType ?? null, sizeBytes ?? null, now());
  return info.lastInsertRowid;
}

export function linkDocumentsToApplication(sessionId, applicationId) {
  db.prepare(`UPDATE documents SET application_id = ? WHERE session_id = ?`).run(applicationId, sessionId);
}

export function documentsForApplication(applicationId) {
  return db.prepare(`SELECT * FROM documents WHERE application_id = ? ORDER BY created_at`).all(applicationId);
}

// ---- Dossiers particulier ----
export function createApplication(payload) {
  const reference = genReference('P');
  const ts = now();
  const info = db.prepare(
    `INSERT INTO applications (reference, client_type, email, whatsapp_phone_full, status, pre_onboarding_session_id, payload, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'EN_COURS_DE_TRAITEMENT', ?, ?, ?, ?)`,
  ).run(
    reference,
    payload.client_type ?? 'PARTICULIER',
    payload.email ?? null,
    payload.whatsapp_phone_full ?? null,
    payload.pre_onboarding_session_id ?? null,
    JSON.stringify(payload),
    ts,
    ts,
  );
  if (payload.pre_onboarding_session_id) {
    linkDocumentsToApplication(payload.pre_onboarding_session_id, info.lastInsertRowid);
  }
  return rowToApplication(db.prepare(`SELECT * FROM applications WHERE id = ?`).get(info.lastInsertRowid));
}

export function getApplicationById(id) {
  const row = db.prepare(`SELECT * FROM applications WHERE id = ?`).get(id);
  return row ? rowToApplication(row) : null;
}

export function getApplicationByReference(reference) {
  const row = db.prepare(`SELECT * FROM applications WHERE reference = ?`).get(reference);
  return row ? rowToApplication(row) : null;
}

export function getApplicationByEmail(email) {
  const row = db.prepare(`SELECT * FROM applications WHERE email = ? ORDER BY created_at DESC LIMIT 1`).get(email);
  return row ? rowToApplication(row) : null;
}

export function getApplicationByContact(identifier) {
  const row = db.prepare(
    `SELECT * FROM applications WHERE email = ? OR whatsapp_phone_full = ? ORDER BY created_at DESC LIMIT 1`,
  ).get(identifier, identifier);
  return row ? rowToApplication(row) : null;
}

function rowToApplication(row) {
  if (!row) return null;
  const payload = JSON.parse(row.payload);
  return {
    ...payload,
    id: row.id,
    reference: row.reference,
    status: row.status,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

// ---- Référentiel agences (paramétrable via l'interface admin diaspora) ----
function rowToAgency(row) {
  return { code: row.code, name: row.name, city: row.city ?? undefined, reseau: row.reseau ?? undefined, region: row.region ?? undefined, active: !!row.active };
}

export function listAgencies() {
  return db.prepare(`SELECT code, name, city, reseau, region, active FROM agencies ORDER BY name`).all().map(rowToAgency);
}

export function replaceAgencies(list) {
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM agencies`).run();
    const ins = db.prepare(`INSERT INTO agencies (code, name, city, reseau, region, active) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const a of list) {
      ins.run(
        String(a.code ?? ''), String(a.name ?? ''),
        a.city ? String(a.city) : null, a.reseau ? String(a.reseau) : null, a.region ? String(a.region) : null,
        a.active === false ? 0 : 1,
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return listAgencies();
}

/** Amorce la table au premier démarrage seulement — n'écrase jamais des agences déjà saisies. */
export function seedAgenciesIfEmpty(defaults) {
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM agencies`).get();
  if (n === 0) replaceAgencies(defaults);
}

// ---- Listes KYC paramétrables (sectors, professions, income-ranges, income-types,
//      funds-origins, account-objects) + sous-secteurs ----
export function listLookup(kind) {
  return db.prepare(`SELECT code, name FROM lookups WHERE kind = ? ORDER BY sort_order, name`).all(kind);
}

export function replaceLookup(kind, list) {
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM lookups WHERE kind = ?`).run(kind);
    const ins = db.prepare(`INSERT INTO lookups (kind, code, name, sort_order) VALUES (?, ?, ?, ?)`);
    list.forEach((r, i) => ins.run(kind, String(r.code ?? ''), String(r.name ?? ''), i));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return listLookup(kind);
}

export function seedLookupIfEmpty(kind, defaults) {
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM lookups WHERE kind = ?`).get(kind);
  if (n === 0) replaceLookup(kind, defaults);
}

export function listSubsectors() {
  return db.prepare(`SELECT code, name, sector_code FROM lookups WHERE kind = 'subsectors' ORDER BY sort_order, name`).all();
}

export function replaceSubsectors(list) {
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM lookups WHERE kind = 'subsectors'`).run();
    const ins = db.prepare(`INSERT INTO lookups (kind, code, name, sector_code, sort_order) VALUES ('subsectors', ?, ?, ?, ?)`);
    list.forEach((r, i) => ins.run(String(r.code ?? ''), String(r.name ?? ''), r.sector_code ? String(r.sector_code) : null, i));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return listSubsectors();
}

export function seedSubsectorsIfEmpty(defaults) {
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM lookups WHERE kind = 'subsectors'`).get();
  if (n === 0) replaceSubsectors(defaults);
}

// ---- Packages / formules de compte ----
function rowToPackage(row) {
  return {
    code: row.code, name: row.name, tagline: row.tagline ?? undefined, currency: row.currency,
    opening_fee: row.opening_fee, subscription_fee: row.subscription_fee, monthly_fee: row.monthly_fee,
    payment_required: !!row.payment_required, features: JSON.parse(row.features || '[]'),
  };
}

export function listPackages() {
  return db.prepare(`SELECT * FROM packages ORDER BY sort_order, name`).all().map(rowToPackage);
}

export function replacePackages(list) {
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM packages`).run();
    const ins = db.prepare(
      `INSERT INTO packages (code, name, tagline, currency, opening_fee, subscription_fee, monthly_fee, payment_required, features, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    list.forEach((p, i) => ins.run(
      String(p.code ?? ''), String(p.name ?? ''), p.tagline ? String(p.tagline) : null,
      String(p.currency ?? 'XAF'), Number(p.opening_fee) || 0, Number(p.subscription_fee) || 0, Number(p.monthly_fee) || 0,
      p.payment_required ? 1 : 0, JSON.stringify(Array.isArray(p.features) ? p.features : []), i,
    ));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return listPackages();
}

export function seedPackagesIfEmpty(defaults) {
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM packages`).get();
  if (n === 0) replacePackages(defaults);
}

// ---- Dossiers entreprise ----
export function createEnterpriseApplication(payload) {
  const reference = genReference('ENT');
  const ts = now();
  const info = db.prepare(
    `INSERT INTO enterprise_applications (reference, email, phone, status, payload, created_at, updated_at)
     VALUES (?, ?, ?, 'EN_COURS_DE_TRAITEMENT', ?, ?, ?)`,
  ).run(reference, payload.email ?? null, payload.phone ?? null, JSON.stringify(payload), ts, ts);
  const row = db.prepare(`SELECT * FROM enterprise_applications WHERE id = ?`).get(info.lastInsertRowid);
  return rowToApplication(row);
}
