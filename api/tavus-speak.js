export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { conversation_id, text } = req.body;
  if (!conversation_id || !text) return res.status(400).json({ error: 'Missing conversation_id or text' });
  const TAVUS_API_KEY = process.env.TAVUS_API_KEY;
  try {
    const response = await fetch('https://tavusapi.com/v2/conversations/' + conversation_id + '/respond', {
      method: 'POST',
      headers: {
        'x-api-key': TAVUS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        response: text
      })
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('Tavus speak error:', errData);
      return res.status(response.status).json({ error: 'Tavus speak failed', details: errData });
    }
    const data = await response.json().catch(() => ({}));
    return res.status(200).json({ status: 'speaking', conversation_id });
  } catch (err) {
    console.error('tavus-speak error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
