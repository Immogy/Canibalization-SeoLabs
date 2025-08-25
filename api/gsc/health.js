export default async function handler(req, res) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').toString();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
  const origin = `${proto}://${host}`;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, origin, hint: 'If origin shows seolabs.cz, reverse proxy is correct.' });
}


