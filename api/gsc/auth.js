// OAuth PKCE start for Google Search Console (readonly)
// Expects env GOOGLE_CLIENT_ID
import { webcrypto, randomBytes } from 'node:crypto';

function getOrigin(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').toString();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
  return `${proto}://${host}`;
}

function base64urlencode(a) {
  return Buffer.from(a)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sha256(verifier) {
  return webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
}

export default async function handler(req, res) {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID || process.env.CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: 'Missing GOOGLE_CLIENT_ID' });

    const origin = getOrigin(req);
    const redirectUri = `${origin}/api/gsc/callback`;
    const returnUrl = typeof req.query.returnUrl === 'string' ? req.query.returnUrl : origin;
    const mode = (req.query.mode === 'popup') ? 'popup' : 'cookie';
    // security: allow only same-origin return
    const safeReturn = returnUrl.startsWith(origin) ? returnUrl : origin;

    // PKCE
    const code_verifier = base64urlencode(randomBytes(32));
    const challengeBuffer = await sha256(code_verifier);
    const code_challenge = base64urlencode(Buffer.from(challengeBuffer));

    // state: cookie nebo popup bez cookie
    let state;
    if (mode === 'cookie') {
      state = base64urlencode(randomBytes(16));
      const payload = { v: 1, state, cv: code_verifier, ru: safeReturn };
      res.setHeader('Set-Cookie', `gsc_oauth=${encodeURIComponent(JSON.stringify(payload))}; HttpOnly; Path=/; SameSite=Lax; Secure`);
    } else {
      // předej potřebná data v state (base64url JSON)
      const stObj = { v: 1, m: 'popup', cv: code_verifier, ru: safeReturn };
      state = base64urlencode(Buffer.from(JSON.stringify(stObj)));
    }

    const scope = encodeURIComponent('https://www.googleapis.com/auth/webmasters.readonly');
    const authUrl =
      'https://accounts.google.com/o/oauth2/v2/auth' +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      '&response_type=code' +
      `&scope=${scope}` +
      '&access_type=offline' +
      '&include_granted_scopes=true' +
      `&code_challenge=${code_challenge}` +
      '&code_challenge_method=S256' +
      `&state=${state}`;

    // Bezpečnost: přidej explicitní prompt, aby Google stránku vždy vykreslil
    // a předejdeme „silent“ výsledku v některých prohlížečích
    const urlWithPrompt = authUrl + '&prompt=consent';

    res.writeHead(302, { Location: urlWithPrompt });
    res.end();
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
}


