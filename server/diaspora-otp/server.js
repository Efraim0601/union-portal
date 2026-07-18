/**
 * Point d'entrée « production » : lance un pool de workers (un par cœur) via node:cluster,
 * chacun exécutant l'app Express de index.js. Le noyau répartit les connexions entrantes
 * entre les workers → on exploite tous les cœurs au lieu d'un seul (le backend est
 * majoritairement synchrone : SQLite via DatabaseSync + I/O disque des uploads).
 *
 * Nombre de workers : CLUSTER_WORKERS (défaut = nombre de cœurs). CLUSTER_WORKERS=1 →
 * process unique, comportement identique à `node index.js` (pratique en dev/débogage).
 *
 * Base : PostgreSQL (DATABASE_URL), pool de connexions par worker — écrivains réellement
 * concurrents. Le bootstrap (schéma + seeds) est fait par les workers eux-mêmes, sérialisé
 * par pg_advisory_lock (cf. index.js) : le premier sème, les autres attendent puis passent.
 */
import os from 'node:os';

// Round-robin FORCÉ : c'est le défaut partout sauf Windows, où le partage de handle laisse
// le kernel choisir le worker — mesuré ici : 92% des requêtes sur UN seul worker, ce qui
// annulait tout le bénéfice du cluster. Avec 'rr' le primaire accepte et distribue
// équitablement les connexions aux workers. La variable doit être posée AVANT le chargement
// du module cluster (d'où l'import dynamique ci-dessous) ; `??=` laisse la main à un
// éventuel réglage explicite de l'environnement.
process.env.NODE_CLUSTER_SCHED_POLICY ??= 'rr';
const cluster = (await import('node:cluster')).default;

const WORKERS = Math.max(1, Number(process.env.CLUSTER_WORKERS) || os.availableParallelism());

if (WORKERS > 1 && cluster.isPrimary) {
  console.log(`[diaspora-otp] primaire ${process.pid} — démarrage de ${WORKERS} workers`);
  for (let i = 0; i < WORKERS; i++) cluster.fork();
  cluster.on('exit', (worker, code, signal) => {
    console.error(`[diaspora-otp] worker ${worker.process.pid} arrêté (${signal || code}) — relance`);
    cluster.fork();
  });
} else {
  await import('./index.js');
}
