export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const r = await fetch('https://api.apollo.io/api/v1/auth/health', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      body: JSON.stringify({ api_key: 'q54-425S9MpJYWrWR3NK6A' })
    });
    const d = await r.json();
    const healthy = d.is_logged_in || d.user?.id;
    res.json({ healthy, raw: d });
  } catch(e) {
    res.json({ healthy: false, error: e.message });
  }
}
