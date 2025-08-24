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
  const locs = Array.from(text.matchAll(/<\s*loc\s*>\s*([^<\s]+)\s*<\s*\/\s*loc\s*>/gi)).map(m=>m[1]);
  return { type: isIndex ? 'index' : (isUrlset ? 'urlset' : 'unknown'), items: locs };
}

async function expandSitemap(sitemapUrl, limit, visited = new Set(), outUrls = []) {
  if (visited.has(sitemapUrl)) return outUrls;
  visited.add(sitemapUrl);
  if (outUrls.length >= limit) return outUrls;

  const res = await fetchWithRetry(sitemapUrl, 3, 12000);
  const buf = await res.arrayBuffer();
  const txt = textFromResponse(buf, res.headers.get('content-type') || '', sitemapUrl);
  const parsed = parseXmlLike(txt);
  if (parsed.type === 'index') {
    for (const child of parsed.items) {
      if (outUrls.length >= limit) break;
      await expandSitemap(child, limit, visited, outUrls);
    }
  } else if (parsed.type === 'urlset') {
    for (const u of parsed.items) {
      outUrls.push(u);
      if (outUrls.length >= limit) break;
    }
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

  const origin = normalizeDomain(input);
  const robotsUrl = origin.replace(/\/$/,'') + '/robots.txt';
  const sitemaps = [];
  try {
    const rob = await fetchWithRetry(robotsUrl, 2, 8000);
    const robTxt = await rob.text();
    extractSitemapsFromRobots(robTxt).forEach(u => sitemaps.push(u));
  } catch(_) {}
  if (sitemaps.length === 0) {
    sitemaps.push(origin + '/sitemap.xml', origin + '/sitemap_index.xml', origin + '/wp-sitemap.xml');
  }

  const visited = new Set();
  const urls = [];
  for (const sm of sitemaps) {
    if (urls.length >= limit) break;
    try { await expandSitemap(sm, limit, visited, urls); } catch(_) {}
  }

  return res.status(200).json({ ok: true, origin, count: urls.length, limit, urls });
}


