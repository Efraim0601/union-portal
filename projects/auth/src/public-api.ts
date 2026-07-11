/*
 * @union/auth — API publique
 * Store d'auth client PARTAGÉ (SSO inter-apps), interopérable avec la banque :
 * clé localStorage 'portail_client_auth', sync cross-tab.
 */
export * from './lib/client-auth-store';
