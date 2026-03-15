export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  const { tool_name, parameters, conversation_id } = req.body || {};
  const N8N = 'https://manageai2026.app.n8n.cloud/webhook';
  const SB_URL = 'https://palcqjfgygpidzwjzikn.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhbGNxamZneWdwaWR6d2p6aWtuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjc4MTUzNywiZXhwIjoyMDg4MzU3NTM3fQ.ojp5xMRnHy_GQ8ImmFG-PMlYcYw78kh7Cftp26u3CsA';
  console.log('[rebecca-action] tool:', tool_name, JSON.stringify(parameters));
  // ── run_territory_search ──────────────────────────────────
  if (tool_name === 'run_territory_search') {
    const { city, state, vertical } = parameters || {};
    if (!city || !state) {
      return res.status(200).json({
        success: false,
        result: 'I need a city and state to search, Boss.'
      });
    }
    // Supabase dedup — check last 30 seconds
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
          console.log('[rebecca-action] Dedup blocked territory:', dedupKey);
          return res.status(200).json({
            success: true,
            result: `Already searching ${city}, ${state} Boss — hang tight, results are coming.`
          });
        }
      }
      // Write dedup record
      await fetch(`${SB_URL}/rest/v1/lb_territory_searches`, {
        method: 'POST',
        headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ dedup_key: dedupKey, city, state, vertical, source: 'rebecca_video', created_at: new Date().toISOString() })
      });
    } catch(e) {
      console.error('[rebecca-action] Dedup check error:', e.message);
    }
    // Fire n8n AFTER responding — fire and forget, never await
    res.status(200).json({
      success: true,
      result: `On it Boss. Searching ${city}, ${state} for ${(vertical||'').replace(/_/g,' ')} companies now.`
    });
    // This runs AFTER the response is sent
    fetch(`${N8N}/lb-territory-v2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city, state, vertical, source: 'rebecca_video', submitter_name: 'Rebbecca', submitter_email: 'tony@manageai.io' })
    }).catch(e => console.error('[rebecca-action] Territory fire error:', e.message));
    return;
  }
  // ── run_lead_booster ──────────────────────────────────────
  if (tool_name === 'run_lead_booster') {
    const { company_name, domain, vertical } = parameters || {};
    if (!company_name) {
      return res.status(200).json({ success: false, result: 'I need a company name, Boss.' });
    }
    res.status(200).json({
      success: true,
      result: `On it Boss. Looking up ${company_name} now.`
    });
    fetch(`${N8N}/lb-discovery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_name, domain: domain || '', vertical: vertical || 'construction', source: 'rebecca_video', submitter_name: 'Rebbecca', submitter_email: 'tony@manageai.io' })
    }).catch(e => console.error('[rebecca-action] Discovery fire error:', e.message));
    return;
  }
  // ── run_bulk_companies ────────────────────────────────────
  if (tool_name === 'run_bulk_companies') {
    const { companies, vertical } = parameters || {};
    if (!companies?.length) {
      return res.status(200).json({ success: false, result: 'I did not catch the company names, Boss. Say them again.' });
    }
    res.status(200).json({
      success: true,
      result: `On it Boss. Firing Lead Booster on all ${companies.length} companies now.`
    });
    (async () => {
      for (let i = 0; i < companies.length; i++) {
        fetch(`${N8N}/lb-discovery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ company_name: companies[i], domain: '', vertical: vertical || 'construction', source: 'rebecca_video_bulk', submitter_name: 'Rebbecca', submitter_email: 'tony@manageai.io' })
        }).catch(e => console.error('[rebecca-action] Bulk fire error:', e.message));
        if (i < companies.length - 1) await new Promise(r => setTimeout(r, 350));
      }
    })();
    return;
  }
  // ── get_pipeline_briefing ─────────────────────────────────
  if (tool_name === 'get_pipeline_briefing') {
    try {
      const [contactsResp, pdResp] = await Promise.all([
        fetch(`${SB_URL}/rest/v1/lb_contacts?select=icp_score,vertical,created_at&limit=500`, {
          headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` }
        }).then(r => r.json()).catch(() => []),
        fetch(`https://api.pipedrive.com/v1/deals?status=open&limit=10&api_token=2fada79568e20083cf472cd5b307e9e12d171a1d`)
          .then(r => r.json()).catch(() => ({ data: null }))
      ]);
      const contacts = Array.isArray(contactsResp) ? contactsResp : [];
      const total = contacts.length;
      const elite = contacts.filter(c => c.icp_score >= 90).length;
      const strong = contacts.filter(c => c.icp_score >= 75 && c.icp_score < 90).length;
      const scores = contacts.map(c => c.icp_score).filter(Boolean);
      const avg = scores.length ? Math.round(scores.reduce((a,b) => a+b,0) / scores.length) : 0;
      const pdDeals = pdResp?.data?.length || 0;
      const topDeal = pdResp?.data?.[0]?.title || null;
      const fiveDaysAgo = new Date(Date.now() - 5*86400000).toISOString();
      const stale = contacts.filter(c => c.created_at < fiveDaysAgo).length;
      let msg = `Here is where things stand Boss. ${total} contacts total — ${elite} Elite, ${strong} Strong, average ICP ${avg}. Pipedrive shows ${pdDeals} open deals${topDeal ? `, top one is ${topDeal}` : ''}. `;
      if (stale > 0) msg += `${stale} contacts have been sitting untouched for over 5 days.`;
      return res.status(200).json({ success: true, result: msg });
    } catch(e) {
      return res.status(200).json({ success: true, result: 'Had trouble pulling your pipeline data Boss. Try again in a second.' });
    }
  }
  // ── unknown tool ──────────────────────────────────────────
  return res.status(200).json({ success: false, result: 'Not sure how to handle that one Boss.' });
}
