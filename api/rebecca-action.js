export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const N8N = 'https://manageai2026.app.n8n.cloud/webhook';
  const SB_URL = 'https://palcqjfgygpidzwjzikn.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhbGNxamZneWdwaWR6d2p6aWtuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjc4MTUzNywiZXhwIjoyMDg4MzU3NTM3fQ.ojp5xMRnHy_GQ8ImmFG-PMlYcYw78kh7Cftp26u3CsA';

  // Normalize — handle both Tavus server-side and frontend calls
  let tool_name = req.body.tool_name || req.body.tool || req.body.name || '';
  let parameters = req.body.parameters || {};

  // Handle Tavus arguments as JSON string
  if (!parameters || Object.keys(parameters).length === 0) {
    try {
      const raw = req.body.arguments || req.body.function_arguments || '{}';
      parameters = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch(e) {}
  }

  const conversation_id = req.body.conversation_id || '';

  console.log('[rebecca-action] tool:', tool_name,
    JSON.stringify(parameters));

  // Respond immediately — never let Vercel timeout
  res.status(200).json({
    success: true,
    tool: tool_name,
    received: parameters
  });

  // Fire n8n after response — truly fire and forget
  try {
    if (tool_name === 'run_territory_search') {
      const { city, state, vertical } = parameters;
      if (!city || !state) {
        console.error('[rebecca-action] Missing city/state');
        return;
      }

      // Dedup check — prevent firing same search twice in 30s
      const dedupKey = `${city}_${state}_${vertical}`.toLowerCase().replace(/\s/g,'_');
      try {
        const check = await fetch(
          `${SB_URL}/rest/v1/lb_territory_searches?dedup_key=eq.${encodeURIComponent(dedupKey)}&order=created_at.desc&limit=1&select=created_at`,
          { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` } }
        );
        const rows = await check.json();
        if (rows?.length > 0) {
          const age = Date.now() - new Date(rows[0].created_at).getTime();
          if (age < 30000) {
            console.log('[rebecca-action] Dedup blocked territory search');
            return;
          }
        }
        // Write dedup record
        await fetch(`${SB_URL}/rest/v1/lb_territory_searches`, {
          method: 'POST',
          headers: {
            'apikey': SB_KEY,
            'Authorization': `Bearer ${SB_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            dedup_key: dedupKey, city, state, vertical,
            source: 'rebecca_video',
            created_at: new Date().toISOString()
          })
        });
      } catch(e) {
        console.error('[rebecca-action] Dedup error:', e.message);
      }

      console.log('[rebecca-action] Firing territory:', city, state, vertical);
      const r = await fetch(`${N8N}/lb-territory-v2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city, state, vertical,
          source: 'rebecca_video',
          submitter_name: 'Rebecca',
          submitter_email: 'tony@manageai.io',
          conversation_id
        }),
        signal: AbortSignal.timeout(10000)
      });
      console.log('[rebecca-action] Territory n8n status:', r.status);
    }

    else if (tool_name === 'run_lead_booster') {
      const { company_name, domain, vertical } = parameters;
      if (!company_name) return;
      console.log('[rebecca-action] Firing discovery:', company_name, domain);
      const r = await fetch(`${N8N}/lb-discovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name, domain: domain || '', vertical: vertical || 'construction',
          source: 'rebecca_video',
          submitter_name: 'Rebecca',
          submitter_email: 'tony@manageai.io',
          conversation_id
        }),
        signal: AbortSignal.timeout(10000)
      });
      console.log('[rebecca-action] Discovery n8n status:', r.status);
    }

    else if (tool_name === 'run_bulk_companies') {
      const { companies, vertical } = parameters;
      if (!companies?.length) return;
      console.log('[rebecca-action] Firing bulk:', companies.length, 'companies');
      for (let i = 0; i < companies.length; i++) {
        const co = companies[i];
        const name = typeof co === 'string' ? co : co.name || co;
        const domain = typeof co === 'object' ? (co.domain || '') : '';
        await fetch(`${N8N}/lb-discovery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company_name: name, domain,
            vertical: vertical || 'construction',
            source: 'rebecca_bulk_video',
            submitter_name: 'Rebecca',
            submitter_email: 'tony@manageai.io'
          }),
          signal: AbortSignal.timeout(10000)
        });
        if (i < companies.length - 1) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    else if (tool_name === 'get_pipeline_briefing') {
      console.log('[rebecca-action] Firing pipeline briefing');
      await fetch(`${N8N}/lb-rebecca`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'briefing',
          conversation_id,
          source: 'rebecca_video'
        }),
        signal: AbortSignal.timeout(10000)
      });
    }

  } catch(e) {
    console.error('[rebecca-action] n8n fire error:', e.message);
  }
}
