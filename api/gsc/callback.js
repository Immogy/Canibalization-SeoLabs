// OAuth PKCE callback – exchanges code for tokens and redirects to returnUrl
// Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (if using confidential) –
// for PKCE we only need client_id.

export default async function handler(req, res) {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID || process.env.CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) return res.status(500).send('Missing GOOGLE_CLIENT_ID');

    const proto = (req.headers['x-forwarded-proto'] || 'https').toString();
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
    const origin = `${proto}://${host}`;
    const redirectUri = `${origin}/api/gsc/callback`;
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send('Missing code/state');

    // detect popup vs cookie mode
    let mode = 'cookie';
    let cv, ru;
    const cookie = (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('gsc_oauth='));
    if (cookie) {
      const payload = JSON.parse(decodeURIComponent(cookie.split('=')[1]));
      if (payload.state !== state) return res.status(400).send('Invalid state');
      cv = payload.cv; ru = payload.ru;
    } else {
      // popup mode: state je base64url JSON
      try {
        const st = JSON.parse(Buffer.from(state.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString());
        if (!st || st.m !== 'popup') return res.status(400).send('Invalid state');
        mode = 'popup';
        cv = st.cv; ru = st.ru;
      } catch {
        return res.status(400).send('Missing oauth cookie/state');
      }
    }

    const body = new URLSearchParams({
      client_id: clientId,
      code: String(code),
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: cv,
    });

    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const tokens = await r.json();
    if (!r.ok) return res.status(500).send('Token exchange failed: ' + JSON.stringify(tokens));

    if (mode === 'cookie') {
      const storage = { rt: tokens.refresh_token, at: tokens.access_token, exp: Date.now() + (tokens.expires_in||0)*1000 };
      res.setHeader('Set-Cookie', [
        `gsc_tokens=${encodeURIComponent(JSON.stringify(storage))}; HttpOnly; Path=/; SameSite=Lax; Secure`,
        'gsc_oauth=; HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age=0'
      ]);
      res.writeHead(302, { Location: ru || origin });
      res.end();
    } else {
      // popup mode: vrátíme HTML, které předá tokeny zpět původní stránce přes postMessage
      const storage = { rt: tokens.refresh_token, at: tokens.access_token, exp: Date.now() + (tokens.expires_in||0)*1000 };
      // nastav také 3rd-party cookie (SameSite=None) pro následné CORS požadavky s credentials
      res.setHeader('Set-Cookie', `gsc_tokens=${encodeURIComponent(JSON.stringify(storage))}; HttpOnly; Path=/; SameSite=None; Secure`);
      const html = `<!doctype html><html><body><script>
        try {
          window.opener && window.opener.postMessage({ source:'gsc-oauth', tokens:${JSON.stringify(tokens)} }, '${ru ? new URL(ru).origin : origin}');
        } catch (e) {}
        window.close();
      </script>Úspěšně přihlášeno. Zavřete okno.</body></html>`;
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.end(html);
    }
  } catch (e) {
    res.status(500).send(e.message || String(e));
  }
}


