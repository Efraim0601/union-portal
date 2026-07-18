import pg from 'pg';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const { Pool, types } = pg;

// Les timestamps sont stockés en BIGINT (epoch ms). Par défaut node-postgres renvoie les int8
// en chaîne (pour ne pas perdre de précision au-delà de 2^53) ; nos ms (~1.7e12) tiennent
// largement dans un Number sûr, donc on les reparse en nombre pour garder `new Date(ms)`.
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Uploads toujours sur disque local (les documents ne vont pas en base) — surchargeable pour
// les tests. À terme : stockage objet (cf. FICHE-TEST-METIER.md, reco #2).
const DATA_DIR = process.env.DIASPORA_DATA_DIR
  ? path.resolve(process.env.DIASPORA_DATA_DIR)
  : path.join(__dirname, 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Connexion : DATABASE_URL (postgres://user:pass@host:port/db) — fournie par docker-compose /
// l'hôte managé. Le pool gère la concurrence (plusieurs écrivains simultanés, contrairement à
// SQLite qui sérialisait tout) : c'est LE gain de la migration pour la montée en charge.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX) || 10, // par worker ; 16 workers × 10 = 160 connexions max
});
pool.on('error', (err) => console.error('[diaspora-otp] erreur pool Postgres', err));

// Raccourcis : q() renvoie toutes les lignes, one() la première (ou undefined).
const q = async (text, params) => (await pool.query(text, params)).rows;
const one = async (text, params) => (await pool.query(text, params)).rows[0];

const now = () => Date.now();
const genReference = (prefix) => `AFR-${prefix}-${crypto.randomInt(100000, 999999)}`;

/**
 * Exécute `insert(reference)` en régénérant la référence sur violation d'unicité (code PG 23505).
 * Sous charge, `genReference` (6 chiffres aléatoires) finit par se répéter (paradoxe des
 * anniversaires) — sans ce retry l'insertion renvoyait un HTTP 500 (constaté en test de charge).
 */
async function insertWithUniqueReference(prefix, insert) {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await insert(genReference(prefix));
    } catch (e) {
      if (e.code !== '23505') throw e; // 23505 = unique_violation
      lastErr = e;
    }
  }
  throw lastErr;
}

/** Transaction sur une connexion dédiée du pool (BEGIN/COMMIT/ROLLBACK). */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Schéma — idempotent (CREATE TABLE IF NOT EXISTS). Appelé au démarrage sous
// verrou consultatif (cf. index.js) pour éviter les courses DDL entre workers.
// ---------------------------------------------------------------------------
export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pre_onboarding_sessions (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      otp_code TEXT NOT NULL,
      otp_expires_at BIGINT NOT NULL,
      otp_attempts INTEGER NOT NULL DEFAULT 0,
      otp_verified INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      reference TEXT UNIQUE NOT NULL,
      client_type TEXT NOT NULL DEFAULT 'PARTICULIER',
      email TEXT,
      whatsapp_phone_full TEXT,
      status TEXT NOT NULL DEFAULT 'EN_COURS_DE_TRAITEMENT',
      pre_onboarding_session_id TEXT,
      payload JSONB NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_applications_email ON applications(email);
    CREATE INDEX IF NOT EXISTS idx_applications_phone ON applications(whatsapp_phone_full);
    CREATE INDEX IF NOT EXISTS idx_applications_session ON applications(pre_onboarding_session_id);

    CREATE TABLE IF NOT EXISTS enterprise_applications (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      reference TEXT UNIQUE NOT NULL,
      email TEXT,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'EN_COURS_DE_TRAITEMENT',
      payload JSONB NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_enterprise_email ON enterprise_applications(email);
    CREATE INDEX IF NOT EXISTS idx_enterprise_phone ON enterprise_applications(phone);

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      session_id TEXT,
      application_id INTEGER,
      document_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      original_name TEXT,
      mime_type TEXT,
      size_bytes INTEGER,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_documents_session ON documents(session_id);
    CREATE INDEX IF NOT EXISTS idx_documents_application ON documents(application_id);

    CREATE TABLE IF NOT EXISTS agencies (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT,
      reseau TEXT,
      region TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );

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
}

// ---- Pré-onboarding : sessions OTP WhatsApp ----
// `sessionId` fourni par le CLIENT (contrat du vrai backend FastAPI) — identique entre l'envoi
// et la vérification, donc UPSERT (ON CONFLICT) pour couvrir un renvoi de code.
export async function createOtpSession(sessionId, phone, code, ttlMs) {
  const ts = now();
  await pool.query(
    `INSERT INTO pre_onboarding_sessions (id, phone, otp_code, otp_expires_at, otp_attempts, otp_verified, created_at)
     VALUES ($1, $2, $3, $4, 0, 0, $5)
     ON CONFLICT (id) DO UPDATE SET
       phone = EXCLUDED.phone, otp_code = EXCLUDED.otp_code, otp_expires_at = EXCLUDED.otp_expires_at,
       otp_attempts = 0, otp_verified = 0`,
    [sessionId, phone, code, ts + ttlMs, ts],
  );
  return sessionId;
}

export function getOtpSession(sessionId) {
  return one(`SELECT * FROM pre_onboarding_sessions WHERE id = $1`, [sessionId]);
}

export function incrementOtpAttempts(id) {
  return pool.query(`UPDATE pre_onboarding_sessions SET otp_attempts = otp_attempts + 1 WHERE id = $1`, [id]);
}

export function markOtpVerified(id) {
  return pool.query(`UPDATE pre_onboarding_sessions SET otp_verified = 1 WHERE id = $1`, [id]);
}

// ---- Documents ----
export async function saveDocument({ sessionId, applicationId, documentType, filePath, originalName, mimeType, sizeBytes }) {
  const row = await one(
    `INSERT INTO documents (session_id, application_id, document_type, file_path, original_name, mime_type, size_bytes, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [sessionId ?? null, applicationId ?? null, documentType, filePath, originalName ?? null, mimeType ?? null, sizeBytes ?? null, now()],
  );
  return row.id;
}

export function linkDocumentsToApplication(sessionId, applicationId, client = pool) {
  return client.query(`UPDATE documents SET application_id = $1 WHERE session_id = $2`, [applicationId, sessionId]);
}

export function documentsForApplication(applicationId) {
  return q(`SELECT * FROM documents WHERE application_id = $1 ORDER BY created_at`, [applicationId]);
}

/** Dernier document d'un type donné pour une session (ex. l'image de référence 'CNI_RECTO'
 *  pour la comparaison faciale déclenchée à l'enregistrement d'un 'CLIENT_VIDEO'). */
export function latestSessionDocument(sessionId, documentType) {
  return one(
    `SELECT * FROM documents WHERE session_id = $1 AND document_type = $2 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [sessionId, documentType],
  );
}

// ---- Dossiers particulier ----
export async function createApplication(payload) {
  const ts = now();
  // Insertion + rattachement des documents dans une même transaction (cohérence).
  return insertWithUniqueReference('P', (reference) =>
    tx(async (client) => {
      const inserted = (await client.query(
        `INSERT INTO applications (reference, client_type, email, whatsapp_phone_full, status, pre_onboarding_session_id, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'EN_COURS_DE_TRAITEMENT', $5, $6, $7, $8) RETURNING *`,
        [
          reference,
          payload.client_type ?? 'PARTICULIER',
          payload.email ?? null,
          payload.whatsapp_phone_full ?? null,
          payload.pre_onboarding_session_id ?? null,
          JSON.stringify(payload),
          ts,
          ts,
        ],
      )).rows[0];
      if (payload.pre_onboarding_session_id) {
        await linkDocumentsToApplication(payload.pre_onboarding_session_id, inserted.id, client);
      }
      return rowToApplication(inserted);
    }),
  );
}

export async function getApplicationById(id) {
  const row = await one(`SELECT * FROM applications WHERE id = $1`, [id]);
  return row ? rowToApplication(row) : null;
}

export async function getApplicationByReference(reference) {
  const row = await one(`SELECT * FROM applications WHERE reference = $1`, [reference]);
  return row ? rowToApplication(row) : null;
}

export async function getApplicationByEmail(email) {
  const row = await one(`SELECT * FROM applications WHERE email = $1 ORDER BY created_at DESC LIMIT 1`, [email]);
  return row ? rowToApplication(row) : null;
}

export async function getApplicationByContact(identifier) {
  const row = await one(
    `SELECT * FROM applications WHERE email = $1 OR whatsapp_phone_full = $1 ORDER BY created_at DESC LIMIT 1`,
    [identifier],
  );
  return row ? rowToApplication(row) : null;
}

function rowToApplication(row) {
  if (!row) return null;
  // payload est en JSONB : node-postgres le renvoie déjà désérialisé (objet JS).
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  return {
    ...payload,
    id: row.id,
    reference: row.reference,
    status: row.status,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

// ---- Référentiel agences ----
function rowToAgency(row) {
  return { code: row.code, name: row.name, city: row.city ?? undefined, reseau: row.reseau ?? undefined, region: row.region ?? undefined, active: !!row.active };
}

export async function listAgencies() {
  return (await q(`SELECT code, name, city, reseau, region, active FROM agencies ORDER BY name`)).map(rowToAgency);
}

export async function replaceAgencies(list) {
  await tx(async (client) => {
    await client.query(`DELETE FROM agencies`);
    for (const a of list) {
      await client.query(
        `INSERT INTO agencies (code, name, city, reseau, region, active) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          String(a.code ?? ''), String(a.name ?? ''),
          a.city ? String(a.city) : null, a.reseau ? String(a.reseau) : null, a.region ? String(a.region) : null,
          a.active === false ? 0 : 1,
        ],
      );
    }
  });
  return listAgencies();
}

/** Amorce au premier démarrage seulement — n'écrase jamais des agences déjà saisies. */
export async function seedAgenciesIfEmpty(defaults) {
  const { n } = await one(`SELECT COUNT(*)::int AS n FROM agencies`);
  if (n === 0) await replaceAgencies(defaults);
}

// ---- Listes KYC paramétrables ----
export function listLookup(kind) {
  return q(`SELECT code, name FROM lookups WHERE kind = $1 ORDER BY sort_order, name`, [kind]);
}

export async function replaceLookup(kind, list) {
  await tx(async (client) => {
    await client.query(`DELETE FROM lookups WHERE kind = $1`, [kind]);
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      await client.query(`INSERT INTO lookups (kind, code, name, sort_order) VALUES ($1, $2, $3, $4)`,
        [kind, String(r.code ?? ''), String(r.name ?? ''), i]);
    }
  });
  return listLookup(kind);
}

export async function seedLookupIfEmpty(kind, defaults) {
  const { n } = await one(`SELECT COUNT(*)::int AS n FROM lookups WHERE kind = $1`, [kind]);
  if (n === 0) await replaceLookup(kind, defaults);
}

export function listSubsectors() {
  return q(`SELECT code, name, sector_code FROM lookups WHERE kind = 'subsectors' ORDER BY sort_order, name`);
}

export async function replaceSubsectors(list) {
  await tx(async (client) => {
    await client.query(`DELETE FROM lookups WHERE kind = 'subsectors'`);
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      await client.query(
        `INSERT INTO lookups (kind, code, name, sector_code, sort_order) VALUES ('subsectors', $1, $2, $3, $4)`,
        [String(r.code ?? ''), String(r.name ?? ''), r.sector_code ? String(r.sector_code) : null, i],
      );
    }
  });
  return listSubsectors();
}

export async function seedSubsectorsIfEmpty(defaults) {
  const { n } = await one(`SELECT COUNT(*)::int AS n FROM lookups WHERE kind = 'subsectors'`);
  if (n === 0) await replaceSubsectors(defaults);
}

// ---- Packages ----
function rowToPackage(row) {
  return {
    code: row.code, name: row.name, tagline: row.tagline ?? undefined, currency: row.currency,
    opening_fee: row.opening_fee, subscription_fee: row.subscription_fee, monthly_fee: row.monthly_fee,
    payment_required: !!row.payment_required, features: JSON.parse(row.features || '[]'),
  };
}

export async function listPackages() {
  return (await q(`SELECT * FROM packages ORDER BY sort_order, name`)).map(rowToPackage);
}

export async function replacePackages(list) {
  await tx(async (client) => {
    await client.query(`DELETE FROM packages`);
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      await client.query(
        `INSERT INTO packages (code, name, tagline, currency, opening_fee, subscription_fee, monthly_fee, payment_required, features, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          String(p.code ?? ''), String(p.name ?? ''), p.tagline ? String(p.tagline) : null,
          String(p.currency ?? 'XAF'), Number(p.opening_fee) || 0, Number(p.subscription_fee) || 0, Number(p.monthly_fee) || 0,
          p.payment_required ? 1 : 0, JSON.stringify(Array.isArray(p.features) ? p.features : []), i,
        ],
      );
    }
  });
  return listPackages();
}

export async function seedPackagesIfEmpty(defaults) {
  const { n } = await one(`SELECT COUNT(*)::int AS n FROM packages`);
  if (n === 0) await replacePackages(defaults);
}

// ---- Dossiers entreprise ----
export async function createEnterpriseApplication(payload) {
  const ts = now();
  return insertWithUniqueReference('ENT', async (reference) => {
    const row = await one(
      `INSERT INTO enterprise_applications (reference, email, phone, status, payload, created_at, updated_at)
       VALUES ($1, $2, $3, 'EN_COURS_DE_TRAITEMENT', $4, $5, $6) RETURNING *`,
      [reference, payload.email ?? null, payload.phone ?? null, JSON.stringify(payload), ts, ts],
    );
    return rowToApplication(row);
  });
}

// ---- Verrou consultatif (bootstrap schéma + seed sans course entre workers) ----
export async function withBootstrapLock(fn) {
  const LOCK_KEY = 918273645; // constante arbitraire partagée par tous les workers
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    return await fn();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    client.release();
  }
}

export { pool };
