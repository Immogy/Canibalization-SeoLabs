import { gunzipSync } from 'zlib';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchWithRetry(url, tries = 3, timeoutMs = 12000) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: ctrl.signal,
        headers: {
          'user-agent': UA,
          'accept': 'application/xml,text/xml,text/html;q=0.9,application/xhtml+xml;q=0.8,*/*;q=0.5',
          'cache-control': 'no-cache',
          'pragma': 'no-cache'
        }
      });
      clearTimeout(timer);
      if (r.ok) return r;
      lastErr = new Error('Upstream ' + r.status);
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      await new Promise(r => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastErr || new Error('fetch failed');
}

function textFromResponse(buffer, contentType, url) {
  const isGzip = (contentType || '').includes('gzip') || /\.gz($|\?)/i.test(url);
  if (isGzip) {
    try { return gunzipSync(Buffer.from(buffer)).toString('utf-8'); } catch (_) {}
  }
  return Buffer.from(buffer).toString('utf-8');
}

function normalizeDomain(input) {
  try { const u = new URL(input); return u.origin; } catch(_) { return 'https://' + String(input).replace(/^https?:\/\//i,'').replace(/\/$/,''); }
}

function extractSitemapsFromRobots(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*Sitemap:\s*(\S+)/i);
    if (m) out.push(m[1].trim());
  }
  return out;
}

function parseXmlLike(text) {
  const isIndex = /<\s*sitemapindex[\s>]/i.test(text);
  const isUrlset = /<\s*urlset[\s>]/i.test(text);
  let locs = [];
  if (isUrlset) {
    // Ber pouze <url><loc>…</loc></url> – ignoruj image:loc apod.
    const urlLocMatches = Array.from(text.matchAll(/<\s*url[\s\S]*?<\s*loc\s*>\s*([^<\s]+)\s*<\s*\/\s*loc\s*>[\s\S]*?<\s*\/\s*url\s*>/gi));
    locs = urlLocMatches.map(m => m[1]);
  } else if (isIndex) {
    locs = Array.from(text.matchAll(/<\s*loc\s*>\s*([^<\s]+)\s*<\s*\/\s*loc\s*>/gi)).map(m=>m[1]);
  }
  // Odfiltruj zjevné soubory (obrázky, pdf)
  locs = locs.filter(u => !/\.(jpg|jpeg|png|gif|webp|svg|avif|pdf)(\?.*)?$/i.test(u));
  return { type: isIndex ? 'index' : (isUrlset ? 'urlset' : 'unknown'), items: locs };
}

async function expandSitemapConcurrent(rootUrl, limit, fast, concurrency = 10) {
  const visited = new Set();
  const queue = [rootUrl];
  const outUrls = [];
  let idx = 0;
  while (idx < queue.length && outUrls.length < limit) {
    const batch = [];
    for (let i = 0; i < concurrency && idx < queue.length; i++, idx++) {
      const u = queue[idx];
      if (visited.has(u)) { i--; continue; }
      visited.add(u);
      batch.push((async () => {
        try {
          const res = await fetchWithRetry(u, 3, 12000);
          const buf = await res.arrayBuffer();
          const txt = textFromResponse(buf, res.headers.get('content-type') || '', u);
          const p = parseXmlLike(txt);
          if (p.type === 'index') {
            for (const child of p.items) {
              if (fast && outUrls.length >= limit) break;
              if (!visited.has(child)) queue.push(child);
            }
          } else if (p.type === 'urlset') {
            for (const loc of p.items) {
              outUrls.push(loc);
              if (fast && outUrls.length >= limit) break;
            }
          }
        } catch (_) {}
      })());
    }
    await Promise.all(batch);
  }
  return outUrls;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    return res.status(204).end();
  }

  const input = req.query.url || req.query.domain || req.query.d;
  if (!input) return res.status(400).json({ error: 'Missing url|domain' });
  const limit = Math.min(parseInt(req.query.limit || '5000', 10) || 5000, 20000);
  const fast = String(req.query.fast || '1') === '1';

  const origin = normalizeDomain(input);
  const robotsUrl = origin.replace(/\/$/,'') + '/robots.txt';
  const sitemaps = [];
  try {
    const rob = await fetchWithRetry(robotsUrl, 3, 15000);
    const robTxt = await rob.text();
    extractSitemapsFromRobots(robTxt).forEach(u => sitemaps.push(u));
  } catch(_) {}
  if (sitemaps.length === 0) {
    sitemaps.push(origin + '/sitemap.xml', origin + '/sitemap_index.xml', origin + '/wp-sitemap.xml');
  }

  let urls = [];
  // Rychlý režim: expandujeme paralelně a končíme po dosažení limitu
  for (const sm of sitemaps) {
    if (urls.length >= limit) break;
    try {
      const part = await expandSitemapConcurrent(sm, limit - urls.length, fast, 16);
      urls = urls.concat(part);
    } catch(_) {}
  }

  return res.status(200).json({ ok: true, origin, count: urls.length, limit, urls });
}


