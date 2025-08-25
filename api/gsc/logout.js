export default async function handler(req, res) {
  try {
    res.setHeader('Set-Cookie', [
      'gsc_tokens=; HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age=0',
      'gsc_oauth=; HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age=0'
    ]);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
}


