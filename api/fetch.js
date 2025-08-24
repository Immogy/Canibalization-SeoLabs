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
    const upstream = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 SeoLabs Proxy' } });
    const ct = upstream.headers.get('content-type') || 'text/plain; charset=utf-8';
    const status = upstream.status;
    const buf = await upstream.arrayBuffer();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', ct.includes('xml') || ct.includes('html') || ct.includes('text') || ct.includes('json') ? ct : 'text/plain; charset=utf-8');
    return res.status(status).send(Buffer.from(buf));
  } catch (e) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(502).send('Proxy error: ' + e.message);
  }
}


