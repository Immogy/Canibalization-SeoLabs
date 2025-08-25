import { gunzipSync, inflateSync, brotliDecompressSync } from 'zlib';
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
      lastErr = new Error(`Upstream ${r.status}`);
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      // backoff
      await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr || new Error('fetch failed');
}

// Jednoduché per-host throttling (omezení zahlcení / WAF)
const hostTimestamps = new Map();
async function throttleHost(host, delayMs = 250) {
  const last = hostTimestamps.get(host) || 0;
  const now = Date.now();
  const wait = Math.max(0, last + delayMs - now);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  hostTimestamps.set(host, Date.now());
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    return res.status(204).end();
  }
  const url = req.query.url || req.query.u;
  if (!url) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(400).send('Missing url');
  }
  try {
    // připrav varianty URL (http/https, s www/bez www)
    const makeVariants = (u) => {
      try {
        const o = new URL(u);
        const host = o.hostname.replace(/^www\./i, '');
        const path = o.pathname + (o.search || '');
        // per-host throttling
        throttleHost(host).catch(()=>{});
        return [
          `https://${host}${path}`,
          `https://www.${host}${path}`,
          `http://${host}${path}`,
          `http://www.${host}${path}`
        ];
      } catch(_) { return [u]; }
    };
    const variants = makeVariants(url);
    let upstream = null; let lastErr;
    for (const v of variants) {
      try { upstream = await fetchWithRetry(v, 3, 12000); break; } catch(e) { lastErr = e; }
    }
    if (!upstream || !upstream.ok) {
      // Server-side fallback přes r.jina.ai (read-only)
      const hostPath = (()=>{ try { const u = new URL(url); return u.host + u.pathname + (u.search||''); } catch(_) { return url.replace(/^https?:\/\//i,''); } })();
      const jinaVariants = [
        'https://r.jina.ai/http://' + hostPath,
        'https://r.jina.ai/https://' + hostPath,
      ];
      for (const j of jinaVariants) {
        try { upstream = await fetchWithRetry(j, 2, 12000); if (upstream.ok) break; } catch(e) { lastErr = e; }
      }
      if (!upstream) throw lastErr || new Error('All variants failed');
    }
    const ct = upstream.headers.get('content-type') || 'text/plain; charset=utf-8';
    const enc = (upstream.headers.get('content-encoding') || '').toLowerCase();
    const status = upstream.status;
    let buf = Buffer.from(await upstream.arrayBuffer());
    try {
      if (enc.includes('gzip')) buf = gunzipSync(buf);
      else if (enc.includes('br')) buf = brotliDecompressSync(buf);
      else if (enc.includes('deflate')) buf = inflateSync(buf);
    } catch(_) {}
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', ct.includes('xml') || ct.includes('html') || ct.includes('text') || ct.includes('json') ? ct : 'text/plain; charset=utf-8');
    return res.status(status).send(buf);
  } catch (e) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(502).send('Proxy error: ' + e.message);
  }
}


