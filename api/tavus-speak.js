export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const TAVUS_API_KEY = process.env.TAVUS_API_KEY;
  const { conversation_id, text } = req.body;

  if (!conversation_id || !text) {
    return res.status(400).json({ error: 'conversation_id and text are required' });
  }

  try {
    const response = await fetch(`https://tavusapi.com/v2/conversations/${conversation_id}/say`, {
      method: 'POST',
      headers: {
        'x-api-key': TAVUS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        script: {
          type: 'text',
          input: text
        }
      })
    });

    if (!response.ok) {
      const errData = await response.text();
      console.error('Tavus speak error:', errData);
      return res.status(response.status).json({ error: errData });
    }

    const data = await response.json();
    return res.status(200).json({ status: 'spoken', data });
  } catch (err) {
    console.error('Tavus speak error:', err);
    return res.status(500).json({ error: 'Failed to send speech to Tavus' });
  }
}
