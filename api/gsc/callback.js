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

    // read cookie payload
    const cookie = (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('gsc_oauth='));
    if (!cookie) return res.status(400).send('Missing oauth cookie');
    const payload = JSON.parse(decodeURIComponent(cookie.split('=')[1]));
    if (payload.state !== state) return res.status(400).send('Invalid state');

    const body = new URLSearchParams({
      client_id: clientId,
      code: String(code),
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: payload.cv,
    });

    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const tokens = await r.json();
    if (!r.ok) return res.status(500).send('Token exchange failed: ' + JSON.stringify(tokens));

    // store refresh token securely (simple cookie demo – doporučuji DB/KV)
    // Pozn.: V produkci uložte do DB pod uživatelský účet. Zde jen pro demo uložím do cookie (šifrování by bylo lepší).
    const storage = { rt: tokens.refresh_token, at: tokens.access_token, exp: Date.now() + (tokens.expires_in||0)*1000 };
    res.setHeader('Set-Cookie', [
      `gsc_tokens=${encodeURIComponent(JSON.stringify(storage))}; HttpOnly; Path=/; SameSite=Lax; Secure`,
      // clear temporary oauth cookie
      'gsc_oauth=; HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age=0'
    ]);

    res.writeHead(302, { Location: payload.ru || origin });
    res.end();
  } catch (e) {
    res.status(500).send(e.message || String(e));
  }
}


