export default async function handler(req, res) {
  // Accept both POST and GET
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();

  // Parse params from body (POST) or query (GET)
  const domain = req.body?.domain || req.query?.domain || '';
  const vertical = req.body?.vertical || req.query?.vertical || '';
  const audit_id = req.body?.audit_id || req.query?.audit_id || '';
  const force_regenerate = req.body?.force_regenerate || req.query?.force_regenerate === 'true';

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

      // Always fetch live contacts for this domain
      const contactsDomain = cachedAudit?.domain || domain;
      const contacts = await fetchContacts(SB_URL, SB_KEY, contactsDomain);

      // Use cached report if it's real (not a placeholder) and not force-regenerating
      if (!force_regenerate &&
          cachedAudit?.audit_report &&
          cachedAudit.audit_report !== 'Historical run — full analysis available on next run' &&
          cachedAudit.audit_report.length > 100) {
        return res.status(200).json({
          report: cachedAudit.audit_report,
          metrics: cachedAudit,
          contacts: contacts,
          cached: true
        });
      }

      // Otherwise fall through to generate a new analysis
      // Use the cached audit's domain if we don't have one
      if (!domain && contactsDomain) {
        return await generateAnalysis(res, SB_URL, SB_KEY, contactsDomain,
          cachedAudit?.vertical || vertical, contacts, audit_id);
      }
    }

    // Fetch ALL contacts for this domain
    const contacts = await fetchContacts(SB_URL, SB_KEY, domain);
    return await generateAnalysis(res, SB_URL, SB_KEY, domain, vertical, contacts, audit_id);

  } catch (err) {
    console.error('[run-analysis] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function generateAnalysis(res, SB_URL, SB_KEY, domain, vertical, contacts, audit_id) {
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

  // Email source breakdown
  const fromWebsite = contacts.filter(c => c.email_source === 'website').length;
  const fromHunter = contacts.filter(c => c.email_source === 'hunter').length;
  const fromApollo = contacts.filter(c => c.email_source === 'apollo').length;
  const fromPdl = contacts.filter(c => (c.email_source || '').includes('pdl')).length;
  const fromPattern = contacts.filter(c => (c.email_source || '').includes('pattern')).length;
  const fromUnknown = contacts.filter(c => c.email && !c.email_source).length;

  // Phone source breakdown
  const phoneWebsite = contacts.filter(c => c.phone_source === 'website').length;
  const phoneApollo = contacts.filter(c => c.phone_source === 'apollo').length;
  const phonePdl = contacts.filter(c => (c.phone_source || '').includes('pdl')).length;
  const phoneUnknown = contacts.filter(c => c.phone && !c.phone_source).length;

  // LinkedIn breakdown
  const linkedinConstructed = contacts.filter(c => c.linkedin_url && !c.linkedin_source).length;
  const linkedinDirect = contacts.filter(c => c.linkedin_url && c.linkedin_source).length;

  const top5 = contacts.slice(0, 5).map(c =>
    (c.first_name || '') + ' ' + (c.last_name || '') + ' — ' + (c.title || 'Unknown') +
    ' — ICP: ' + (c.icp_score || 0) + ' — ' + (c.icp_rationale || 'No rationale') +
    ' — Email via: ' + (c.email_source || 'unknown')
  ).join('\n');

  const lowScorers = contacts.filter(c => (c.icp_score || 0) < 50).slice(0, 5).map(c =>
    (c.first_name || '') + ' ' + (c.last_name || '') + ' — ' + (c.title || 'Unknown') +
    ' — Score: ' + (c.icp_score || 0) + ' — ' + (c.icp_rationale || '')
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
        content: `You are a lead generation analyst for ManageAI's Lead Booster Pro. Analyze this pipeline run and explain in plain language. Tony is a sales professional who wants actionable intel, not a data science lecture. Keep it direct and useful. No fluff.

DOMAIN: ${domain}
VERTICAL: ${vertical}
TOTAL CONTACTS: ${total}

EMAIL RATE: ${Math.round(withEmail / total * 100)}% (${withEmail}/${total})
Email source breakdown:
  Website scrape: ${fromWebsite} contacts
  Hunter.io: ${fromHunter} contacts
  Apollo: ${fromApollo} contacts
  PDL: ${fromPdl} contacts
  Pattern guess: ${fromPattern} contacts
  Source not tagged: ${fromUnknown} contacts

PHONE RATE: ${Math.round(withPhone / total * 100)}% (${withPhone}/${total})
Phone source breakdown:
  Website: ${phoneWebsite}
  Apollo: ${phoneApollo}
  PDL: ${phonePdl}
  Source not tagged: ${phoneUnknown}

LINKEDIN RATE: ${Math.round(withLinkedin / total * 100)}% (${withLinkedin}/${total})
LinkedIn breakdown:
  Constructed from name+domain: ${linkedinConstructed}
  Direct from source: ${linkedinDirect}

AVG ICP SCORE: ${avgIcp} (range: ${scoreRange})
AVG COMPLETENESS: ${avgComp}%

TOP 5 CONTACTS BY ICP SCORE:
${top5}

LOW SCORING CONTACTS (under 50):
${lowScorers || 'None'}

Answer in this exact format:

## WHY DID THE TOP CONTACTS SCORE HIGH?
Be specific about their titles and the signals that made them high-value.

## WHY DID LOWER-SCORING CONTACTS SCORE LOW?
What was missing? Wrong title? No email? Incomplete data?

## WHICH DATA SOURCE DID THE MOST WORK?
Email came from: [breakdown]. Phone came from: [breakdown]. LinkedIn came from: [breakdown]. Explain why the waterfall ended up relying on these sources.

## WHO SHOULD TONY CALL FIRST AND WHY?
1. [Name] — [specific one-sentence reason]
2. [Name] — [specific one-sentence reason]
3. [Name] — [specific one-sentence reason]

## ONE THING THAT WOULD IMPROVE THIS RUN'S DATA
[Single most impactful change]`
      }]
    })
  });

  const claudeData = await claudeResp.json();
  const report = claudeData.content?.[0]?.text || 'Analysis unavailable — Claude API may not be configured.';

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

  // Save or update lb_run_audits
  if (audit_id) {
    // Update existing record
    await fetch(SB_URL + '/rest/v1/lb_run_audits?id=eq.' + audit_id, {
      method: 'PATCH',
      headers: {
        'apikey': SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        audit_report: report,
        ...metrics,
        run_completed_at: new Date().toISOString()
      })
    });
  } else {
    // Insert new record
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
  }

  return res.status(200).json({ report, metrics, contacts, cached: false });
}

async function fetchContacts(sbUrl, sbKey, domain) {
  if (!domain) return [];
  const resp = await fetch(
    sbUrl + '/rest/v1/lb_contacts?domain=eq.' +
    encodeURIComponent(domain) +
    '&select=id,first_name,last_name,title,email,email_source,phone,phone_source,linkedin_url,linkedin_source,icp_score,icp_rationale,final_completeness_score,created_at' +
    '&order=icp_score.desc&limit=200',
    { headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey } }
  );
  const data = await resp.json();
  return Array.isArray(data) ? data : [];
}
