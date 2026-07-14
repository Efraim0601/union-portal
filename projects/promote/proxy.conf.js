// Proxy dev de promote servi seul (:4201). Supprime l'en-tête `Origin` transmis au
// backend (même origine que le portail) pour éviter le rejet « Invalid CORS request ».
// PROMOTE_API_TARGET permet de viser un backend déjà déployé (ex. conteneur publié
// sur :6390) sans toucher au fichier : PROMOTE_API_TARGET=http://localhost:6390 ng serve promote.
module.exports = {
  '/promote-api': {
    target: process.env.PROMOTE_API_TARGET || 'http://localhost:8390',
    secure: false,
    changeOrigin: true,
    pathRewrite: { '^/promote-api': '/api' },
    on: { proxyReq: (proxyReq) => proxyReq.removeHeader('origin') },
  },
};
