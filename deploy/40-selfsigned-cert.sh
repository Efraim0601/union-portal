#!/bin/sh
# Génère un certificat TLS auto-signé au premier démarrage si absent.
# Placé dans /docker-entrypoint.d/ : l'entrypoint nginx l'exécute AVANT de
# lancer nginx (donc les fichiers existent quand la conf 'listen 443 ssl' charge).
#
# But : activer HTTPS sur le serveur de test pour que la caméra (getUserMedia,
# selfie/CNI) fonctionne — les navigateurs bloquent la caméra hors origine sûre.
# Le certificat étant auto-signé, le navigateur affichera un avertissement à
# accepter une seule fois. Pour la vraie prod, remplacer par un cert Let's Encrypt.
set -e

SSL_DIR=/etc/nginx/ssl
CRT="$SSL_DIR/union.crt"
KEY="$SSL_DIR/union.key"

if [ -s "$CRT" ] && [ -s "$KEY" ]; then
  echo "TLS: certificat existant conservé ($CRT)"
  exit 0
fi

mkdir -p "$SSL_DIR"
CN="${TLS_CN:-afriland-union.local}"
echo "TLS: génération d'un certificat auto-signé (CN=$CN, 825 jours)…"
openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout "$KEY" -out "$CRT" -days 825 \
  -subj "/C=CM/O=Afriland/CN=$CN" \
  -addext "subjectAltName=DNS:$CN,DNS:localhost,IP:127.0.0.1"
chmod 600 "$KEY"
echo "TLS: certificat prêt."
