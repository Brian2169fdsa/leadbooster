export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const event = req.body;
  console.log('Tavus callback received:', event.event_type || event.type, JSON.stringify(event).substring(0, 200));

  // Always return 200 immediately so Tavus does not retry
  res.status(200).json({ received: true });
}
