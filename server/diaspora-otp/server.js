/**
 * Point d'entrée « production » : lance un pool de workers (un par cœur) via node:cluster,
 * chacun exécutant l'app Express de index.js. Le noyau répartit les connexions entrantes
 * entre les workers → on exploite tous les cœurs au lieu d'un seul (le backend est
 * majoritairement synchrone : SQLite via DatabaseSync + I/O disque des uploads).
 *
 * Nombre de workers : CLUSTER_WORKERS (défaut = nombre de cœurs). CLUSTER_WORKERS=1 →
 * process unique, comportement identique à `node index.js` (pratique en dev/débogage).
 *
 * SQLite reste partagé (même fichier WAL) : plusieurs lecteurs simultanés + un écrivain à la
 * fois, busy_timeout (cf. db.js) sérialise proprement les écritures concurrentes des workers.
 */
import cluster from 'node:cluster';
import os from 'node:os';

const WORKERS = Math.max(1, Number(process.env.CLUSTER_WORKERS) || os.availableParallelism());

if (WORKERS > 1 && cluster.isPrimary) {
  // Crée le schéma + amorce les référentiels UNE fois dans le primaire, avant de forker :
  // évite que N workers tentent de semer la base en même temps au premier démarrage.
  await import('./db.js');
  console.log(`[diaspora-otp] primaire ${process.pid} — démarrage de ${WORKERS} workers`);
  for (let i = 0; i < WORKERS; i++) cluster.fork();
  cluster.on('exit', (worker, code, signal) => {
    console.error(`[diaspora-otp] worker ${worker.process.pid} arrêté (${signal || code}) — relance`);
    cluster.fork();
  });
} else {
  await import('./index.js');
}
