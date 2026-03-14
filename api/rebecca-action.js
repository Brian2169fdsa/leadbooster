export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const N8N_BASE = 'https://manageai2026.app.n8n.cloud/webhook';
  const body = req.body;

  // Tavus sends tool calls with a 'name' field identifying which tool was called
  const toolName = body.name || body.tool_name || body.function?.name;
  const args = body.arguments || body.parameters || body.function?.arguments || {};

  try {
    // Tool 1 - Run single company through Lead Booster
    if (toolName === 'run_lead_booster') {
      const { company_name, domain, vertical } = args;

      await fetch(N8N_BASE + '/lb-discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: company_name,
          domain: domain,
          vertical: vertical || 'construction',
          submitter_name: 'Tony',
          submitter_email: 'tony@manageai.io',
          source: 'rebecca_voice'
        })
      });

      return res.status(200).json({
        result: 'Lead Booster is now running for ' + company_name + '. I will give you updates as it progresses Boss.'
      });
    }

    // Tool 2 - Run territory search
    if (toolName === 'run_territory_search') {
      const { city, state, vertical } = args;

      await fetch(N8N_BASE + '/lb-territory-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city: city,
          state: state,
          vertical: vertical || 'construction',
          submitter_name: 'Tony',
          submitter_email: 'tony@manageai.io',
          source: 'rebecca_voice'
        })
      });

      return res.status(200).json({
        result: 'Territory search is running for ' + city + ' ' + state + ' in ' + vertical + '. Give me a couple minutes Boss.'
      });
    }

    // Tool 3 - Show bulk upload panel
    if (toolName === 'run_bulk_upload') {
      return res.status(200).json({
        result: 'Opening the bulk upload panel for you now Boss. Paste your list or drop a CSV file and hit Run.',
        action: 'show_bulk_panel'
      });
    }

    // Unknown tool
    return res.status(200).json({
      result: 'Got it Boss. Let me know what you need.'
    });

  } catch (err) {
    console.error('Rebecca action error:', err);
    return res.status(500).json({ error: 'Action failed', result: 'Sorry Boss, something went wrong. Try again.' });
  }
}
