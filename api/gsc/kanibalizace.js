// Aggregates GSC Search Analytics across full available range (~16 months)
// Returns queries where multiple pages of the same domain rank (real cannibalization)

async function ensureAccessToken(req) {
  const cookie = (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('gsc_tokens='));
  if (!cookie) throw new Error('Not authenticated');
  const tokens = JSON.parse(decodeURIComponent(cookie.split('=')[1]));
  if (tokens.at && tokens.exp && tokens.exp > Date.now() + 30000) return tokens;
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const body = new URLSearchParams({ client_id: clientId, grant_type: 'refresh_token', refresh_token: tokens.rt });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json();
  if (!r.ok) throw new Error('Refresh failed: ' + JSON.stringify(j));
  return { rt: tokens.rt, at: j.access_token, exp: Date.now() + (j.expires_in||0)*1000 };
}

function toISO(d){ return d.toISOString().slice(0,10); }
function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function min(a,b){ return a < b ? a : b; }

export default async function handler(req, res) {
  try {
    const tokens = await ensureAccessToken(req);
    const property = req.query.property || req.query.siteUrl;
    if (!property) return res.status(400).json({ error: 'Missing property (siteUrl)' });
    let domainFilter = '';
    if (property.startsWith('sc-domain:')) {
      domainFilter = property.slice('sc-domain:'.length);
    } else {
      try { domainFilter = new URL(property).hostname.replace(/^www\./,''); }
      catch { return res.status(400).json({ error: 'Invalid property value' }); }
    }

    // determine available range: last 16 months from today
    const today = new Date();
    const start = addDays(today, -480); // ~16 months
    const end = today;

    const queryBody = (startDate, endDate, startRow=0) => ({
      startDate: toISO(startDate), endDate: toISO(endDate),
      dimensions: ['query','page'],
      rowLimit: 25000,
      startRow,
    });

    // fetch by months to avoid rowLimit caps
    const agg = new Map(); // key: query → Map(page→ {clicks, impressions, position, ctr, hits})
    let cursor = new Date(start);
    while (cursor < end) {
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth()+1, 0);
      const windowEnd = min(monthEnd, end);
      let startRow = 0;
      // page through rows
      for (;;) {
        const r = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.at}` },
          body: JSON.stringify(queryBody(cursor, windowEnd, startRow)),
        });
        const j = await r.json();
        if (!r.ok) return res.status(500).json(j);
        const rows = j.rows || [];
        for (const row of rows) {
          const [q, page] = row.keys || [];
          if (!q || !page) continue;
          try {
            const host = new URL(page).hostname.replace(/^www\./,'');
            if (!host.endsWith(domainFilter)) continue;
          } catch { continue; }
          const byQuery = agg.get(q) || new Map();
          const v = byQuery.get(page) || { clicks:0, impressions:0, position:0, ctr:0, hits:0 };
          v.clicks += row.clicks||0;
          v.impressions += row.impressions||0;
          v.position += row.position||0;
          v.ctr += row.ctr||0;
          v.hits += 1;
          byQuery.set(page, v);
          agg.set(q, byQuery);
        }
        if (rows.length < 25000) break;
        startRow += rows.length;
      }
      cursor = addDays(windowEnd, 1);
    }

    // build cannibalization list
    const items = [];
    for (const [q, byPage] of agg.entries()) {
      if (byPage.size <= 1) continue;
      const pages = Array.from(byPage.entries()).map(([page, v]) => ({
        page,
        clicks: v.clicks,
        impressions: v.impressions,
        avgPosition: v.hits ? v.position / v.hits : 0,
        avgCtr: v.hits ? v.ctr / v.hits : 0,
      })).sort((a,b)=>a.avgPosition - b.avgPosition);
      items.push({ query: q, pages, winner: pages[0] });
    }
    items.sort((a,b)=> b.pages.reduce((s,x)=>s+x.impressions,0) - a.pages.reduce((s,x)=>s+x.impressions,0));
    // persist refreshed access token
    try {
      if (tokens.rt && tokens.at) {
        const exp = Date.now() + 55 * 60 * 1000;
        res.setHeader('Set-Cookie', `gsc_tokens=${encodeURIComponent(JSON.stringify({ rt: tokens.rt, at: tokens.at, exp }))}; HttpOnly; Path=/; SameSite=Lax; Secure`);
      }
    } catch {}
    res.json({ property, from: toISO(start), to: toISO(end), totalQueries: agg.size, cannibalized: items.length, items });
  } catch (e) {
    res.status(401).json({ error: e.message || String(e) });
  }
}


