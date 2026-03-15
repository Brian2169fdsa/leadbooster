export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { domain, vertical, audit_id } = req.body;

  const SB_URL = 'https://palcqjfgygpidzwjzikn.supabase.co';
  const SB_KEY = process.env.SUPABASE_SERVICE_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhbGNxamZneWdwaWR6d2p6aWtuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjc4MTUzNywiZXhwIjoyMDg4MzU3NTM3fQ.ojp5xMRnHy_GQ8ImmFG-PMlYcYw78kh7Cftp26u3CsA';

  try {
    // If audit_id provided, fetch existing audit from Supabase
    if (audit_id) {
      const auditResp = await fetch(
        SB_URL + '/rest/v1/lb_run_audits?id=eq.' + audit_id + '&select=*',
        { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } }
      );
      const audits = await auditResp.json();
      if (audits[0]?.audit_report) {
        return res.status(200).json({
          report: audits[0].audit_report,
          metrics: audits[0],
          cached: true
        });
      }
    }

    // Fetch contacts for this domain (last 2 hours)
    const since = new Date(Date.now() - 7200000).toISOString();
    const contactsResp = await fetch(
      SB_URL + '/rest/v1/lb_contacts?domain=eq.' +
      encodeURIComponent(domain) +
      '&created_at=gte.' + since +
      '&select=*&order=icp_score.desc&limit=100',
      { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } }
    );
    const contacts = await contactsResp.json();

    if (!contacts.length) {
      return res.status(200).json({
        report: 'No contacts found for this run yet. The pipeline may still be processing.',
        metrics: null,
        cached: false
      });
    }

    // Calculate metrics
    const total = contacts.length;
    const withEmail = contacts.filter(c => c.email).length;
    const withPhone = contacts.filter(c => c.phone).length;
    const withLinkedin = contacts.filter(c => c.linkedin_url).length;
    const avgIcp = Math.round(contacts.reduce((s, c) => s + (c.icp_score || 0), 0) / total);
    const avgComp = Math.round(contacts.reduce((s, c) => s + (c.final_completeness_score || 0), 0) / total);
    const scores = contacts.map(c => c.icp_score || 0).filter(s => s > 0);
    const scoreRange = scores.length ? Math.min(...scores) + '-' + Math.max(...scores) : 'N/A';

    const fromWebsite = contacts.filter(c => c.email_source === 'website').length;
    const fromHunter = contacts.filter(c => c.email_source === 'hunter').length;
    const fromApollo = contacts.filter(c => c.email_source === 'apollo').length;
    const fromPdl = contacts.filter(c => (c.email_source || '').includes('pdl')).length;
    const fromPattern = contacts.filter(c => (c.email_source || '').includes('pattern')).length;

    const top5 = contacts.slice(0, 5).map(c =>
      (c.first_name || '') + ' ' + (c.last_name || '') + ' | ' + (c.title || 'Unknown') +
      ' | ICP: ' + (c.icp_score || 0) + ' | ' + (c.icp_rationale || 'No rationale') +
      ' | Email via: ' + (c.email_source || 'none')
    ).join('\n');

    const lowScorers = contacts.filter(c => (c.icp_score || 0) < 50).slice(0, 5).map(c =>
      (c.first_name || '') + ' ' + (c.last_name || '') + ' | ' + (c.title || 'Unknown') +
      ' | Score: ' + (c.icp_score || 0) + ' | ' + (c.icp_rationale || '')
    ).join('\n');

    // Call Claude
    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `You are a lead generation analyst for ManageAI Lead Booster Pro.
Analyze this pipeline run and explain every decision made. Be specific, direct, plain language.
DOMAIN: ${domain}
VERTICAL: ${vertical}
TOTAL CONTACTS: ${total}
EMAIL RATE: ${Math.round(withEmail / total * 100)}% (${withEmail}/${total})
PHONE RATE: ${Math.round(withPhone / total * 100)}% (${withPhone}/${total})
LINKEDIN RATE: ${Math.round(withLinkedin / total * 100)}% (${withLinkedin}/${total})
AVG COMPLETENESS: ${avgComp}%
ICP SCORE RANGE: ${scoreRange} (avg ${avgIcp})
DATA SOURCES:
Website: ${fromWebsite} contacts
Hunter: ${fromHunter} contacts
Apollo: ${fromApollo} contacts
PDL: ${fromPdl} contacts
Pattern guess: ${fromPattern} contacts
TOP 5 CONTACTS BY ICP SCORE:
${top5}
LOW SCORING CONTACTS (under 50):
${lowScorers || 'None'}
Answer in this exact format:
## WHY THE TOP CONTACTS SCORED HIGH
[Specific explanation mentioning their titles and signals]
## WHY THE LOW SCORERS SCORED LOW
[What was missing or wrong]
## WHICH DATA SOURCE DID THE MOST WORK
[Website vs Hunter vs Apollo — which one and why]
## CONTACTS FOUND BUT NOT ENRICHED
[Any contacts with no email — what happened]
## WHO TONY SHOULD CALL FIRST
1. [Name] — [specific reason why]
2. [Name] — [specific reason why]
3. [Name] — [specific reason why]
## ONE IMPROVEMENT FOR THIS RUN
[Single most impactful change]`
        }]
      })
    });

    const claudeData = await claudeResp.json();
    const report = claudeData.content?.[0]?.text || 'Analysis unavailable';

    const metrics = {
      total_contacts: total,
      email_rate: Math.round(withEmail / total * 100),
      phone_rate: Math.round(withPhone / total * 100),
      linkedin_rate: Math.round(withLinkedin / total * 100),
      avg_completeness: avgComp,
      avg_icp_score: avgIcp,
      icp_score_range: scoreRange,
      contacts_from_website: fromWebsite,
      contacts_from_hunter: fromHunter,
      contacts_from_apollo: fromApollo,
      contacts_from_pdl: fromPdl,
      contacts_from_pattern: fromPattern
    };

    // Save to lb_run_audits
    await fetch(SB_URL + '/rest/v1/lb_run_audits', {
      method: 'POST',
      headers: {
        'apikey': SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        domain,
        vertical,
        audit_report: report,
        ...metrics,
        run_completed_at: new Date().toISOString()
      })
    });

    return res.status(200).json({ report, metrics, cached: false });

  } catch (err) {
    console.error('[run-analysis] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
