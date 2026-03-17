export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const SB_URL = 'https://palcqjfgygpidzwjzikn.supabase.co';
  const SB_KEY = process.env.SUPABASE_SERVICE_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhbGNxamZneWdwaWR6d2p6aWtuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjc4MTUzNywiZXhwIjoyMDg4MzU3NTM3fQ.ojp5xMRnHy_GQ8ImmFG-PMlYcYw78kh7Cftp26u3CsA';
  const { table, method = 'GET', query = '', body } = req.body;
  if (!table) return res.status(400).json({ error: 'table required' });
  const url = SB_URL + '/rest/v1/' + table + (query ? '?' + query : '');
  const options = {
    method,
    headers: {
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }
  };
  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }
  const resp = await fetch(url, options);
  const data = await resp.json();
  return res.status(resp.status).json(data);
}
