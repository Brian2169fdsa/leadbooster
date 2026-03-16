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
      const cachedAudit = audits[0];

      // Always fetch live contacts for this domain (no time window)
      const contactsDomain = cachedAudit?.domain || domain;
      const contacts = await fetchContacts(SB_URL, SB_KEY, contactsDomain);

      if (cachedAudit?.audit_report) {
        return res.status(200).json({
          report: cachedAudit.audit_report,
          metrics: cachedAudit,
          contacts: contacts,
          cached: true
        });
      }
    }

    // Fetch ALL contacts for this domain (no time window — get everything)
    const contacts = await fetchContacts(SB_URL, SB_KEY, domain);

    if (!contacts.length) {
      return res.status(200).json({
        report: 'No contacts found for this domain yet. The pipeline may still be processing.',
        metrics: null,
        contacts: [],
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
    // Contacts with no email_source set — data source unknown
    const fromUnknown = contacts.filter(c => c.email && !c.email_source).length;

    const top5 = contacts.slice(0, 5).map(c =>
      (c.first_name || '') + ' ' + (c.last_name || '') + ' | ' + (c.title || 'Unknown') +
      ' | ICP: ' + (c.icp_score || 0) + ' | ' + (c.icp_rationale || 'No rationale') +
      ' | Email via: ' + (c.email_source || 'unknown')
    ).join('\n');

    const lowScorers = contacts.filter(c => (c.icp_score || 0) < 50).slice(0, 5).map(c =>
      (c.first_name || '') + ' ' + (c.last_name || '') + ' | ' + (c.title || 'Unknown') +
      ' | Score: ' + (c.icp_score || 0) + ' | ' + (c.icp_rationale || '')
    ).join('\n');

    // Build per-contact decision matrix for the prompt
    const decisionMatrix = contacts.slice(0, 20).map(c => {
      const sources = [];
      if (c.email_source) sources.push('Email: ' + c.email_source);
      if (c.phone_source) sources.push('Phone: ' + c.phone_source);
      if (c.linkedin_url) sources.push('LinkedIn: constructed');
      return (c.first_name || '') + ' ' + (c.last_name || '') +
        ' | ' + (c.title || '?') +
        ' | Sources: ' + (sources.join(', ') || 'none recorded') +
        ' | Has email: ' + (c.email ? 'yes' : 'no') +
        ' | Has phone: ' + (c.phone ? 'yes' : 'no') +
        ' | ICP: ' + (c.icp_score || 0);
    }).join('\n');

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
Website scrape: ${fromWebsite} contacts
Hunter.io: ${fromHunter} contacts
Apollo: ${fromApollo} contacts
PDL: ${fromPdl} contacts
Pattern guess: ${fromPattern} contacts
Source unknown (not tagged): ${fromUnknown} contacts
PER-CONTACT DECISION MATRIX (first 20):
${decisionMatrix}
TOP 5 CONTACTS BY ICP SCORE:
${top5}
LOW SCORING CONTACTS (under 50):
${lowScorers || 'None'}
Answer in this exact format:
## DATA SOURCE DECISION MATRIX
[For each enrichment source (Website, Hunter, Apollo, PDL, Pattern), explain what it was used for, how many contacts it found, and why it was chosen over alternatives. If a source found 0 contacts, explain why it may have failed.]
## WHY THE TOP CONTACTS SCORED HIGH
[Specific explanation mentioning their titles and signals]
## WHY THE LOW SCORERS SCORED LOW
[What was missing or wrong]
## CONTACTS FOUND BUT NOT ENRICHED
[Any contacts with no email — what happened and which source failed]
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
      contacts_from_pattern: fromPattern,
      contacts_from_unknown: fromUnknown
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

    return res.status(200).json({ report, metrics, contacts, cached: false });

  } catch (err) {
    console.error('[run-analysis] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function fetchContacts(sbUrl, sbKey, domain) {
  if (!domain) return [];
  const resp = await fetch(
    sbUrl + '/rest/v1/lb_contacts?domain=eq.' +
    encodeURIComponent(domain) +
    '&select=id,first_name,last_name,title,email,email_source,phone,phone_source,linkedin_url,icp_score,icp_rationale,final_completeness_score,created_at' +
    '&order=icp_score.desc&limit=200',
    { headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey } }
  );
  const data = await resp.json();
  return Array.isArray(data) ? data : [];
}
