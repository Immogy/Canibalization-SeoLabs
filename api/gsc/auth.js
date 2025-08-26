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
      '&include_granted_scopes=false' +
      `&code_challenge=${code_challenge}` +
      '&code_challenge_method=S256' +
      `&state=${state}`;

    // Vynucení výběru účtu + znovu vyžádání souhlasu + re-login (vyžádá přihlášení a výběr účtu)
    const urlWithPrompt = authUrl + '&prompt=consent%20select_account%20login';

    if (req.query.debug === '1') {
      res.status(200).json({
        ok: true,
        origin,
        redirectUri,
        authUrl: urlWithPrompt,
        clientId
      });
      return;
    }

    // Volitelně vynutit nativní Account Chooser (pokud select_account nestačí)
    const forcePicker = req.query.picker === '1' || req.query.forcePicker === '1';
    let redirect = forcePicker
      ? `https://accounts.google.com/AccountChooser?continue=${encodeURIComponent(urlWithPrompt)}`
      : urlWithPrompt;

    // Volitelně vynutit odhlášení Google účtu v popupu, aby se zobrazil picker a nezafungovalo auto-login
    const forceLogout = req.query.forceLogout === '1' || req.query.logout === '1';
    if (forceLogout) {
      redirect = `https://accounts.google.com/Logout?continue=${encodeURIComponent(redirect)}`;
    }

    // Volitelně vynutit plný login flow (zadání účtu), i když je aktivní session
    // Přesměrujeme přes ServiceLogin se službou webmasters, aby se uživatel musel vybrat/přihlásit
    const forceLogin = req.query.forceLogin === '1' || req.query.login === '1';
    if (forceLogin) {
      const cont = redirect;
      redirect = `https://accounts.google.com/ServiceLogin?service=webmastertools&passive=false&continue=${encodeURIComponent(cont)}`;
    }

    res.writeHead(302, { Location: redirect });
    res.end();
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
}


