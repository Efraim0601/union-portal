// ============================================================================
// Gateway hôte SANS Docker — équivalent de deploy/nginx.conf pour un poste où
// Docker Linux n'est pas disponible (dockerd Windows / pas de WSL2).
//
// Sert, sur UNE SEULE origine (:8090), les 3 apps Native Federation buildées
// dans dist et proxifie les API :
//   /                     -> dist/shell/browser        (host, SPA fallback)
//   /remotes/promote/*    -> dist/promote/browser      (remote staff)
//   /remotes/diaspora/*   -> dist/diaspora/browser     (remote onboarding)
//   /federation.manifest.json -> deploy/federation.manifest.prod.json (no-store)
//   /api/*                -> DIASPORA_UPSTREAM  (backend diaspora, défaut 127.0.0.1:8080)
//   /promote-api/*        -> PROMOTE_UPSTREAM   (backend promote, défaut 127.0.0.1:8390)
//
// L'en-tête Origin est retiré côté proxy (backend servi same-origin -> évite le
// rejet « Invalid CORS request » de Spring), comme dans nginx.conf.
//
// Aucune dépendance npm : uniquement les modules natifs de Node.
//   Lancement :  node deploy/host-gateway.mjs
//   Env :        GATEWAY_PORT (8090), DIASPORA_UPSTREAM, PROMOTE_UPSTREAM
// ============================================================================
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PORTAL = resolve(HERE, '..');
const DIST = join(PORTAL, 'dist');
const ROOTS = {
  shell: join(DIST, 'shell', 'browser'),
  promote: join(DIST, 'promote', 'browser'),
  diaspora: join(DIST, 'diaspora', 'browser'),
};
const MANIFEST = join(PORTAL, 'deploy', 'federation.manifest.prod.json');

const PORT = Number(process.env.GATEWAY_PORT || 8090);
const DIASPORA_UPSTREAM = process.env.DIASPORA_UPSTREAM || '127.0.0.1:8080';
const PROMOTE_UPSTREAM = process.env.PROMOTE_UPSTREAM || '127.0.0.1:8390';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};
const contentType = (p) => MIME[extname(p).toLowerCase()] || 'application/octet-stream';
const isAsset = (p) => extname(p) !== '';

function safeJoin(base, rel) {
  const p = normalize(join(base, decodeURIComponent(rel)));
  if (p !== base && !p.startsWith(base + sep)) return null; // anti path-traversal
  return p;
}

async function sendFile(res, filePath, { noStore = false, cache = false } = {}) {
  try {
    const data = await readFile(filePath);
    const headers = { 'content-type': contentType(filePath) };
    if (noStore) headers['cache-control'] = 'no-store';
    else if (cache) headers['cache-control'] = 'public, max-age=2592000, immutable';
    res.writeHead(200, headers);
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

function proxy(req, res, upstream, pathOverride) {
  const [host, port] = upstream.split(':');
  const headers = { ...req.headers, host: `${host}:${port}` };
  delete headers['origin']; // same-origin backend -> évite le rejet CORS de Spring
  const up = http.request(
    { host, port: Number(port), method: req.method, path: pathOverride || req.url, headers },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);
    }
  );
  up.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Bad gateway (upstream ${upstream} indisponible) : ${e.message}`);
  });
  req.pipe(up);
}

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = (req.url || '/').split('?')[0];

    // --- API (proxy) ---
    if (urlPath === '/api' || urlPath.startsWith('/api/')) {
      return proxy(req, res, DIASPORA_UPSTREAM);
    }
    if (urlPath === '/promote-api' || urlPath.startsWith('/promote-api/')) {
      return proxy(req, res, PROMOTE_UPSTREAM, (req.url || '').replace(/^\/promote-api/, '/api'));
    }

    // --- Manifest de fédération (prod, jamais mis en cache) ---
    if (urlPath === '/federation.manifest.json') {
      if (await sendFile(res, MANIFEST, { noStore: true })) return;
      res.writeHead(404);
      return res.end('federation manifest introuvable');
    }

    // --- MediaPipe (FaceLandmarker, capture selfie/KYC) ------------------------
    // Les fronts référencent le modèle en chemin ABSOLU racine (`/mediapipe/wasm`,
    // `/mediapipe/face_landmarker.task`, cf. shared/face-mesh.ts). En fédération les
    // assets d'un remote vivent sous /remotes/<app>/, donc à la racine /mediapipe/*
    // tomberait en 404 (SPA fallback) et la détection de visage ne s'initialiserait
    // jamais. On sert l'unique copie (buildée dans le remote diaspora) à la racine,
    // exactement comme le fait deploy/nginx.conf.
    if (urlPath === '/mediapipe' || urlPath.startsWith('/mediapipe/')) {
      const rel = urlPath.replace(/^\/mediapipe\/?/, '');
      const fp = safeJoin(join(ROOTS.diaspora, 'mediapipe'), rel);
      if (fp && existsSync(fp) && statSync(fp).isFile()) {
        return void sendFile(res, fp, { cache: true });
      }
      res.writeHead(404);
      return res.end('mediapipe asset introuvable');
    }

    // --- Remotes (assets statiques + SPA fallback) ---
    for (const remote of ['promote', 'diaspora']) {
      const prefix = `/remotes/${remote}/`;
      if (urlPath.startsWith(prefix)) {
        const rel = urlPath.slice(prefix.length) || 'index.html';
        const fp = safeJoin(ROOTS[remote], rel);
        if (fp && existsSync(fp) && statSync(fp).isFile()) {
          // remoteEntry.json ET importmap.json sont des points d'entrée de fédération à NOM FIXE
          // mais CONTENU variable à chaque build : jamais mis en cache (sinon un rebuild sert un
          // manifest/importmap périmé -> deps hashées introuvables -> page blanche).
          const noStore = rel.endsWith('remoteEntry.json') || rel.endsWith('importmap.json');
          return void sendFile(res, fp, { noStore, cache: !noStore && isAsset(urlPath) });
        }
        return void sendFile(res, join(ROOTS[remote], 'index.html'), { noStore: true });
      }
    }

    // --- Shell (host) : fichier statique, sinon SPA fallback ---
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
    const fp = safeJoin(ROOTS.shell, rel);
    if (fp && existsSync(fp) && statSync(fp).isFile()) {
      // index.html ET importmap.json jamais mis en cache (nom fixe, contenu variable à chaque
      // build → sinon on sert une coquille/importmap périmé référençant d'anciens bundles).
      // Les autres assets sont hashés → cache long OK.
      const noStore = rel === 'index.html' || rel.endsWith('/index.html') || rel === 'importmap.json' || rel.endsWith('/importmap.json');
      return void sendFile(res, fp, { noStore, cache: !noStore && isAsset(urlPath) });
    }
    if (isAsset(urlPath)) {
      res.writeHead(404);
      return res.end('Not found');
    }
    return void sendFile(res, join(ROOTS.shell, 'index.html'), { noStore: true });
  } catch (e) {
    res.writeHead(500);
    res.end('gateway error: ' + e.message);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `[host-gateway] http://0.0.0.0:${PORT}  |  /api -> ${DIASPORA_UPSTREAM}  |  /promote-api -> ${PROMOTE_UPSTREAM}`
  );
});
