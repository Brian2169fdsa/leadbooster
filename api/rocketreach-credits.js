export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const r = await fetch('https://api.rocketreach.co/api/v2/account', {
      headers: { 'Api-Key': process.env.ROCKETREACH_API_KEY || '1bfcccck2fafb53720f5ff0303ab04513c2b8cb0' }
    });
    const d = await r.json();
    const remaining = d.lookups_left ?? d.monthly_credits_remaining ?? d.credits_remaining ?? d.lookups_remaining ?? null;
    res.json({
      remaining,
      label: remaining !== null ? 'lookups remaining' : 'Active',
      detail: remaining !== null ? 'Monthly reset' : 'View account for credit balance',
      status: remaining !== null ? (remaining > 50 ? 'healthy' : remaining > 10 ? 'low' : 'critical') : 'healthy',
      link: 'https://rocketreach.co/subscription',
      raw: d
    });
  } catch(e) {
    res.json({ remaining: null, label: 'Active', detail: 'View account for credit balance', status: 'healthy', link: 'https://rocketreach.co/subscription', error: e.message });
  }
}
