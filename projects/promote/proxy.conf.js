// Proxy dev de promote servi seul (:4201). Supprime l'en-tête `Origin` transmis au
// backend (même origine que le portail) pour éviter le rejet « Invalid CORS request ».
module.exports = {
  '/promote-api': {
    target: 'http://localhost:8390',
    secure: false,
    changeOrigin: true,
    pathRewrite: { '^/promote-api': '/api' },
    on: { proxyReq: (proxyReq) => proxyReq.removeHeader('origin') },
  },
};
