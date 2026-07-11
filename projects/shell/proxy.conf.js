// Proxy dev du shell (:4200). Comme en prod (gateway nginx), on supprime l'en-tête
// `Origin` transmis aux backends : portail et API étant servis sur la même origine,
// cet Origin est parasite et ferait rejeter Spring (« Invalid CORS request »).
const stripOrigin = { proxyReq: (proxyReq) => proxyReq.removeHeader('origin') };

module.exports = {
  // promote (staff : login, ventes, stats)
  '/promote-api': {
    target: 'http://localhost:8390',
    secure: false,
    changeOrigin: true,
    pathRewrite: { '^/promote-api': '/api' },
    on: stripOrigin,
  },
  // diaspora (onboarding)
  '/api': {
    target: 'http://localhost:10002',
    secure: false,
    changeOrigin: true,
    on: stripOrigin,
  },
};
