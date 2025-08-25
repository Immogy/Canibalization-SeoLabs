export const config = { runtime: 'nodejs18.x' };

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const MAX_BYTES = 5 * 1024 * 1024; // 5MB safety limit

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const srcRaw = String(req.query.src || '').trim();
    if (!srcRaw) return res.status(400).json({ error: 'Missing src' });

    // decode and validate URL
    let src;
    try {
      src = new URL(decodeURIComponent(srcRaw));
    } catch (e) {
      return res.status(400).json({ error: 'Bad src' });
    }
    if (!ALLOWED_PROTOCOLS.has(src.protocol)) {
      return res.status(400).json({ error: 'Protocol not allowed' });
    }

    // Fetch upstream with browser-like headers
    const upstream = await fetch(src.toString(), {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
        'referer': 'https://www.instagram.com/',
        'accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
      },
      redirect: 'follow'
    });
    if (!upstream.ok) {
      return res.status(502).json({ error: 'Upstream status ' + upstream.status });
    }

    // Limit size
    const contentLength = Number(upstream.headers.get('content-length') || '0');
    if (contentLength && contentLength > MAX_BYTES) {
      return res.status(413).json({ error: 'Image too large' });
    }

    const arrayBuffer = await upstream.arrayBuffer();
    let buf = Buffer.from(arrayBuffer);
    if (buf.byteLength > MAX_BYTES) {
      return res.status(413).json({ error: 'Image too large' });
    }

    // Optional resizing
    const w = Number(req.query.w || 0);
    const h = Number(req.query.h || 0);
    const fit = String(req.query.fit || 'cover');
    try {
      if (w || h) {
        const sharp = (await import('sharp')).default;
        buf = await sharp(buf).resize({ width: w || undefined, height: h || undefined, fit }).toFormat('jpeg').toBuffer();
      }
    } catch (e) {
      // Best effort – fallback to original buffer on sharp errors
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).send(buf);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
}


