export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const tokenResp = await fetch('https://api.snov.io/v1/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: 'bfefd71311a20c0370eb79bab95ed49a',
        client_secret: '3517b26c29857d71f02173ea651f4108'
      })
    });
    const tokenData = await tokenResp.json();
    const token = tokenData.access_token;
    if (!token) return res.json({ remaining: null, error: 'No token' });
    const r = await fetch('https://api.snov.io/v1/get-balance', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const d = await r.json();
    res.json({ remaining: d.balance ?? d.credits ?? null, raw: d });
  } catch(e) {
    res.json({ remaining: null, error: e.message });
  }
}
