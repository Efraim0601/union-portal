/**
 * PostgreSQL embarqué pour dev/test SANS Docker (binaire téléchargé par `embedded-postgres`,
 * devDependency). Usage :
 *
 *   node loadtest/pg-dev.mjs                 # démarre PG sur le port 15432, affiche DATABASE_URL
 *   PGDEV_PORT=15433 node loadtest/pg-dev.mjs
 *   PGDEV_DIR=/chemin/donnees node loadtest/pg-dev.mjs   # datadir persistant (défaut : jetable)
 *
 * Puis, dans un autre terminal :
 *   DATABASE_URL=postgres://diaspora:diaspora@localhost:15432/diaspora node server.js
 *
 * Ctrl+C arrête proprement le serveur PG. En prod/staging : utiliser le service `postgres`
 * de deploy/test/docker-compose.yml (ou une base managée), jamais ce script.
 */
import EmbeddedPostgres from 'embedded-postgres';
import path from 'node:path';
import os from 'node:os';

const PORT = Number(process.env.PGDEV_PORT) || 15432;
const DATA_DIR = process.env.PGDEV_DIR
  ? path.resolve(process.env.PGDEV_DIR)
  : path.join(os.tmpdir(), `diaspora-pg-dev-${PORT}`);

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: 'diaspora',
  password: 'diaspora',
  port: PORT,
  persistent: false, // on gère l'arrêt nous-mêmes (SIGINT ci-dessous)
});

console.log(`[pg-dev] initialisation du cluster dans ${DATA_DIR}…`);
try {
  await pg.initialise();
} catch (e) {
  // datadir déjà initialisé (relance sur un PGDEV_DIR persistant) — on continue.
  if (!String(e?.message ?? e).includes('exists')) throw e;
}
await pg.start();
await pg.createDatabase('diaspora').catch(() => {}); // déjà créée si relance
console.log('[pg-dev] prêt.');
console.log(`[pg-dev] DATABASE_URL=postgres://diaspora:diaspora@localhost:${PORT}/diaspora`);
console.log('[pg-dev] Ctrl+C pour arrêter.');

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log('\n[pg-dev] arrêt…');
  await pg.stop().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
