// Lists verified GSC sites for the current user (reads tokens from cookie)

function allowCors(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

async function ensureAccessToken(req) {
  const cookie = (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('gsc_tokens='));
  if (!cookie) throw new Error('Not authenticated');
  const tokens = JSON.parse(decodeURIComponent(cookie.split('=')[1]));
  if (tokens.at && tokens.exp && tokens.exp > Date.now() + 30000) return tokens;
  // refresh
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: tokens.rt,
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Refresh failed: ' + JSON.stringify(j));
  const upd = { rt: tokens.rt, at: j.access_token, exp: Date.now() + (j.expires_in||0)*1000 };
  return upd;
}

export default async function handler(req, res) {
  try {
    if (allowCors(req, res)) return;
    const tokens = await ensureAccessToken(req);
    const r = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
      headers: { Authorization: `Bearer ${tokens.at}` }
    });
    const data = await r.json();
    if (!r.ok) return res.status(500).json(data);
    // update refreshed token if needed
    try {
      if (tokens.rt && tokens.at) {
        const exp = Date.now() + 55 * 60 * 1000; // optimistic 55m
        res.setHeader('Set-Cookie', `gsc_tokens=${encodeURIComponent(JSON.stringify({ rt: tokens.rt, at: tokens.at, exp }))}; HttpOnly; Path=/; SameSite=Lax; Secure`);
      }
    } catch {}
    res.json({ items: (data.siteEntry||[]).map(s => ({ url: s.siteUrl, permission: s.permissionLevel })) });
  } catch (e) {
    res.status(401).json({ error: e.message || String(e) });
  }
}


