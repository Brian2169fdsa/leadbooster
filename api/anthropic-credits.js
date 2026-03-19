export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const r = await fetch('https://api.anthropic.com/v1/usage', {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    });
    const d = await r.json();
    res.json({ raw: d });
  } catch(e) {
    res.json({ error: e.message });
  }
}
