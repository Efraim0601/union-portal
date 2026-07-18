/**
 * Harnais de test de charge (montée en charge) pour le backend diaspora-otp.
 *
 * Zéro dépendance externe : module `http` (agent keep-alive) + `perf_hooks`.
 * Modèle « closed-loop » : N utilisateurs virtuels (VUs) rejouent en boucle un
 * scénario métier. La rampe fait varier le nombre de VUs actifs dans le temps,
 * ce qui révèle le point de rupture (latence qui explose, erreurs qui montent).
 *
 * Métriques affichées en direct (chaque seconde) et en synthèse finale :
 *   - débit (req/s), latence p50/p95/p99/max, taux d'erreur.
 *
 * Usage :
 *   node loadtest.mjs                      # profil par défaut (rampe 10→50→150→300)
 *   BASE_URL=http://localhost:10099 \
 *   SCENARIO=journey RAMP="10:15,50:15,150:15,300:20" DOC_KB=150 node loadtest.mjs
 *
 * Scénarios (SCENARIO=) :
 *   journey  — parcours KYC complet : otp/send → otp/verify → documents → applications  (chemin d'écriture)
 *   otp      — otp/send + otp/verify uniquement
 *   read     — référentiels en lecture (countries/nationalities/agencies/lookups)  (chemin de lecture)
 *   mixed    — 80% read / 20% journey (profil de trafic réaliste)
 */

import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import crypto from 'node:crypto';

const BASE_URL = process.env.BASE_URL || 'http://localhost:10099';
const SCENARIO = process.env.SCENARIO || 'journey';
const DOC_KB = Number(process.env.DOC_KB || 150);
// Rampe : "vus:secondes,vus:secondes,…" — chaque palier maintient `vus` VUs pendant `secondes`.
const RAMP = (process.env.RAMP || '10:12,50:12,150:12,300:15')
  .split(',')
  .map((s) => {
    const [vus, sec] = s.split(':').map(Number);
    return { vus, sec };
  });

const url = new URL(BASE_URL);
const isHttps = url.protocol === 'https:';
const agent = new (isHttps ? https : http).Agent({
  keepAlive: true,
  maxSockets: 4096, // ne pas brider la concurrence : on veut voir le serveur saturer, pas le client
  maxFreeSockets: 4096,
});
const lib = isHttps ? https : http;

// ---- Corps multipart (upload document) construit à la main (pas de dépendance) ----
const DOC_BUFFER = crypto.randomBytes(DOC_KB * 1024); // ~ photo pièce d'identité
function multipartBody(documentType) {
  const boundary = '----loadtest' + crypto.randomBytes(8).toString('hex');
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="document_type"\r\n\r\n${documentType}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="doc.jpg"\r\n` +
      `Content-Type: image/jpeg\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, DOC_BUFFER, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

// ---- Client HTTP bas niveau : renvoie {status, ms, ok, body} et draine toujours la réponse ----
function request(method, pathname, { json, multipart } = {}) {
  return new Promise((resolve) => {
    const headers = {};
    let payload = null;
    if (json !== undefined) {
      payload = Buffer.from(JSON.stringify(json));
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = payload.length;
    } else if (multipart) {
      payload = multipart.body;
      headers['Content-Type'] = multipart.contentType;
      headers['Content-Length'] = payload.length;
    }
    const start = performance.now();
    const req = lib.request(
      { hostname: url.hostname, port: url.port, path: pathname, method, headers, agent },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const ms = performance.now() - start;
          resolve({ status: res.statusCode, ms, ok: res.statusCode >= 200 && res.statusCode < 400, body: Buffer.concat(chunks) });
        });
      },
    );
    req.on('error', (err) => resolve({ status: 0, ms: performance.now() - start, ok: false, error: err.code || err.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

// ---- Scénarios ----
let seq = 0;
function newSession() {
  return `lt-${process.pid}-${Date.now().toString(36)}-${(seq++).toString(36)}`;
}

async function scenarioJourney(rec) {
  const sessionId = newSession();
  const phone = '+2376' + String(90000000 + (seq % 9999999)).padStart(8, '0');

  const send = await request('POST', '/api/pre-onboarding/otp/send', { json: { session_id: sessionId, phone } });
  rec('otp/send', send);
  if (!send.ok) return;
  let otp = '000000';
  try { otp = JSON.parse(send.body).fallback_otp || otp; } catch {}

  const verify = await request('POST', '/api/pre-onboarding/otp/verify', { json: { session_id: sessionId, phone, otp } });
  rec('otp/verify', verify);

  const up = await request('POST', `/api/pre-onboarding/${sessionId}/documents`, { multipart: multipartBody('ID_RECTO') });
  rec('documents', up);

  const appRes = await request('POST', '/api/applications', {
    json: { client_type: 'PARTICULIER', email: `${sessionId}@test.local`, whatsapp_phone_full: phone, pre_onboarding_session_id: sessionId, first_name: 'Load', last_name: 'Test' },
  });
  rec('applications', appRes);
}

async function scenarioOtp(rec) {
  const sessionId = newSession();
  const phone = '+2376' + String(90000000 + (seq % 9999999)).padStart(8, '0');
  const send = await request('POST', '/api/pre-onboarding/otp/send', { json: { session_id: sessionId, phone } });
  rec('otp/send', send);
  if (!send.ok) return;
  let otp = '000000';
  try { otp = JSON.parse(send.body).fallback_otp || otp; } catch {}
  rec('otp/verify', await request('POST', '/api/pre-onboarding/otp/verify', { json: { session_id: sessionId, phone, otp } }));
}

const READ_PATHS = ['/api/countries/active', '/api/nationalities/active', '/api/agencies/active', '/api/lookups/sectors', '/api/lookups/professions'];
async function scenarioRead(rec) {
  const p = READ_PATHS[seq++ % READ_PATHS.length];
  rec(p.replace('/api/', ''), await request('GET', p));
}

async function scenarioMixed(rec) {
  if ((seq++ % 5) === 0) return scenarioJourney(rec);
  return scenarioRead(rec);
}

const SCENARIOS = { journey: scenarioJourney, otp: scenarioOtp, read: scenarioRead, mixed: scenarioMixed };
const runScenario = SCENARIOS[SCENARIO];
if (!runScenario) { console.error(`Scénario inconnu: ${SCENARIO}`); process.exit(1); }

// ---- Collecte des métriques ----
const windowLat = []; // latences de la fenêtre courante (1s)
let windowReqs = 0, windowErrs = 0;
const allLat = [];
let totalReqs = 0, totalErrs = 0;
const statusCounts = {};
const perEndpoint = {}; // nom -> {lat:[], errs}

function record(endpoint, res) {
  totalReqs++; windowReqs++;
  windowLat.push(res.ms); allLat.push(res.ms);
  statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
  if (!res.ok) { totalErrs++; windowErrs++; }
  const e = (perEndpoint[endpoint] ||= { lat: [], errs: 0, n: 0 });
  e.lat.push(res.ms); e.n++; if (!res.ok) e.errs++;
}

function pct(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

// ---- Contrôleur de rampe : `targetVUs` varie, les workers s'auto-régulent ----
let targetVUs = 0;
let running = true;
let activeWorkers = 0;

async function worker(index) {
  while (running) {
    if (index >= targetVUs) { await sleep(25); continue; } // en trop pour le palier courant : on patiente
    activeWorkers++;
    try { await runScenario(record); } catch { /* compté via record */ }
    activeWorkers--;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Reporting temps réel (chaque seconde) ----
const startedAt = performance.now();
const reportTimer = setInterval(() => {
  const sorted = windowLat.slice().sort((a, b) => a - b);
  const rps = windowReqs; // fenêtre = 1s
  const errPct = windowReqs ? ((windowErrs / windowReqs) * 100).toFixed(1) : '0.0';
  const t = ((performance.now() - startedAt) / 1000).toFixed(0);
  console.log(
    `[t=${t.padStart(3)}s] VUs=${String(targetVUs).padStart(3)} ` +
      `req/s=${String(rps).padStart(5)} ` +
      `p50=${fmt(pct(sorted, 50))} p95=${fmt(pct(sorted, 95))} p99=${fmt(pct(sorted, 99))} max=${fmt(sorted[sorted.length - 1] || 0)} ` +
      `err=${errPct.padStart(5)}%`,
  );
  windowLat.length = 0; windowReqs = 0; windowErrs = 0;
}, 1000);
const fmt = (ms) => `${ms.toFixed(0).padStart(4)}ms`;

// ---- Orchestration de la rampe ----
async function main() {
  const totalSec = RAMP.reduce((s, p) => s + p.sec, 0);
  const maxVUs = Math.max(...RAMP.map((p) => p.vus));
  console.log(`\n=== LOAD TEST diaspora-otp ===`);
  console.log(`cible=${BASE_URL}  scénario=${SCENARIO}  doc=${DOC_KB}KB  durée≈${totalSec}s  VUs max=${maxVUs}`);
  console.log(`rampe: ${RAMP.map((p) => `${p.vus}VU/${p.sec}s`).join(' → ')}\n`);

  // On démarre tout de suite un pool de workers = maxVUs ; `targetVUs` les active par paliers.
  for (let i = 0; i < maxVUs; i++) worker(i);

  for (const stage of RAMP) {
    targetVUs = stage.vus;
    await sleep(stage.sec * 1000);
  }
  running = false;
  clearInterval(reportTimer);
  await sleep(300); // laisser les requêtes en vol se terminer

  // ---- Synthèse ----
  const sorted = allLat.slice().sort((a, b) => a - b);
  const durS = (performance.now() - startedAt) / 1000;
  console.log(`\n=== SYNTHÈSE (${durS.toFixed(1)}s) ===`);
  console.log(`requêtes totales : ${totalReqs}   débit moyen : ${(totalReqs / durS).toFixed(0)} req/s`);
  console.log(`erreurs          : ${totalErrs} (${((totalErrs / totalReqs) * 100).toFixed(2)}%)`);
  console.log(`latence globale  : p50=${fmt(pct(sorted, 50))} p95=${fmt(pct(sorted, 95))} p99=${fmt(pct(sorted, 99))} max=${fmt(sorted[sorted.length - 1] || 0)}`);
  console.log(`codes HTTP       : ${JSON.stringify(statusCounts)}`);
  console.log(`\npar endpoint :`);
  for (const [name, e] of Object.entries(perEndpoint)) {
    const s = e.lat.slice().sort((a, b) => a - b);
    console.log(`  ${name.padEnd(14)} n=${String(e.n).padStart(6)} p50=${fmt(pct(s, 50))} p95=${fmt(pct(s, 95))} p99=${fmt(pct(s, 99))} err=${e.errs}`);
  }
  agent.destroy();
  process.exit(0);
}

main();
