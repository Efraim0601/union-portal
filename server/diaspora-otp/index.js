import express from 'express';
import crypto from 'node:crypto';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();
app.use((_req, res, next) => {
  // Le dev-server Angular (proxy /api) parle en same-origin ; ce header ne sert
  // qu'à couvrir un appel direct (ex. test manuel via curl/Postman).
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// OCR (RapidOCR + MRZ) : service Python séparé (server/diaspora-ocr) — on relaie tel quel,
// avant express.json(), pour ne jamais toucher au corps multipart (upload d'images).
const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL || 'http://localhost:10003';
app.use(
  '/api/pre-onboarding/extract',
  createProxyMiddleware({
    target: OCR_SERVICE_URL,
    changeOrigin: true,
    // Express a déjà retiré le préfixe de montage de req.url ici (il ne reste que '/') —
    // on réécrit donc inconditionnellement vers l'unique route exposée par le service OCR.
    pathRewrite: () => '/extract',
  }),
);

app.use(express.json());

const PORT = process.env.PORT || 10002;
const CALLBELL_API_KEY = process.env.CALLBELL_API_KEY;
const CALLBELL_CHANNEL_UUID = process.env.CALLBELL_CHANNEL_UUID;
const CALLBELL_FROM = process.env.CALLBELL_FROM || 'whatsapp';
const CALLBELL_SEND_URL = 'https://api.callbell.eu/v1/messages/send';

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

if (!CALLBELL_API_KEY || !CALLBELL_CHANNEL_UUID) {
  console.warn(
    '[diaspora-otp] CALLBELL_API_KEY / CALLBELL_CHANNEL_UUID manquant(s) — ' +
    'copiez .env.example en .env et renseignez vos identifiants Callbell. ' +
    'Sans ça, /whatsapp-otp/send renverra une erreur 502.',
  );
}

/** phone (E.164) -> { code, sessionId, expiresAt, attempts, verified } */
const otpStore = new Map();

function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

app.post('/api/pre-onboarding/whatsapp-otp/send', async (req, res) => {
  const { phone } = req.body ?? {};
  if (!phone) return res.status(400).json({ error: 'phone requis' });
  if (!CALLBELL_API_KEY || !CALLBELL_CHANNEL_UUID) {
    return res.status(502).json({ error: 'Callbell non configuré côté serveur (voir .env).' });
  }

  const code = generateCode();
  const sessionId = crypto.randomUUID();

  try {
    const callbellRes = await fetch(CALLBELL_SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CALLBELL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: phone,
        from: CALLBELL_FROM,
        type: 'text',
        channel_uuid: CALLBELL_CHANNEL_UUID,
        content: { text: `Votre code de vérification Afriland First Bank est : ${code}\nIl expire dans 5 minutes.` },
      }),
    });
    if (!callbellRes.ok) {
      const detail = await callbellRes.text().catch(() => '');
      console.error('[diaspora-otp] Callbell a refusé l’envoi', callbellRes.status, detail);
      return res.status(502).json({ error: 'Envoi WhatsApp refusé par Callbell.', detail });
    }
  } catch (err) {
    console.error('[diaspora-otp] Erreur réseau vers Callbell', err);
    return res.status(502).json({ error: 'Envoi WhatsApp impossible (réseau).' });
  }

  otpStore.set(phone, { code, sessionId, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0, verified: false });
  res.json({ pre_onboarding_session_id: sessionId });
});

app.post('/api/pre-onboarding/whatsapp-otp/verify', (req, res) => {
  const { phone, code } = req.body ?? {};
  if (!phone || !code) return res.status(400).json({ error: 'phone et code requis' });

  const entry = otpStore.get(phone);
  if (!entry) return res.status(400).json({ error: 'Aucun code envoyé pour ce numéro.' });
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(phone);
    return res.status(400).json({ error: 'Code expiré, renvoyez-en un nouveau.' });
  }
  if (entry.attempts >= OTP_MAX_ATTEMPTS) {
    otpStore.delete(phone);
    return res.status(429).json({ error: 'Trop de tentatives, renvoyez un nouveau code.' });
  }

  entry.attempts += 1;
  if (entry.code !== code) return res.status(400).json({ error: 'Code invalide.' });

  entry.verified = true;
  res.json({ pre_onboarding_session_id: entry.sessionId, verified: true });
});

app.listen(PORT, () => {
  console.log(`[diaspora-otp] écoute sur http://localhost:${PORT}`);
});
