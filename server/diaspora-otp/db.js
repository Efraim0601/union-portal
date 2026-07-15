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

  CREATE TABLE IF NOT EXISTS agencies (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    city TEXT
  );
`);

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
export function listAgencies() {
  return db.prepare(`SELECT code, name, city FROM agencies ORDER BY name`).all();
}

export function replaceAgencies(list) {
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM agencies`).run();
    const ins = db.prepare(`INSERT INTO agencies (code, name, city) VALUES (?, ?, ?)`);
    for (const a of list) ins.run(String(a.code ?? ''), String(a.name ?? ''), a.city ? String(a.city) : null);
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
