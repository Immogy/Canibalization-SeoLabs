export default async function handler(req, res) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').toString();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
  const origin = `${proto}://${host}`;
  res.setHeader('Cache-Control', 'no-store');
  const hasClientId = !!(process.env.GOOGLE_CLIENT_ID || process.env.CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);
  const hasSecret = !!(process.env.GOOGLE_CLIENT_SECRET || process.env.CLIENT_SECRET);
  res.status(200).json({ ok: true, origin, hasClientId, hasSecret, hint: 'If origin shows seolabs.cz, reverse proxy is correct.' });
}


