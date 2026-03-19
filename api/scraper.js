export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { url, domain, vertical, depth = 4, list_tag } = req.body || {};
  if (!url || !domain) return res.json({ contacts: [], tech_stack: [] });
  const contacts = [];
  const techStack = [];
  // Pages to try — prioritize team/about/contact pages
  const baseUrl = url.startsWith('http') ? url : 'https://' + url;
  const pagesToTry = [
    baseUrl,
    'https://' + domain + '/team',
    'https://' + domain + '/about',
    'https://' + domain + '/our-team',
    'https://' + domain + '/leadership',
    'https://' + domain + '/about-us',
    'https://' + domain + '/contact',
    'https://' + domain + '/staff',
    'https://' + domain + '/people',
    'https://' + domain + '/management',
  ].slice(0, depth);
  const pageTexts = [];
  // Fetch pages via Jina AI reader
  for (const pageUrl of pagesToTry) {
    try {
      const jinaResp = await fetch('https://r.jina.ai/' + pageUrl, {
        headers: {
          'Accept': 'text/plain',
          'X-No-Cache': 'true',
          'X-Return-Format': 'text'
        },
        signal: AbortSignal.timeout(12000)
      });
      if (jinaResp.ok) {
        const text = await jinaResp.text();
        if (text && text.length > 200) {
          pageTexts.push({
            url: pageUrl,
            text: text.substring(0, 6000)
          });
        }
      }
    } catch(e) { /* skip failed pages silently */ }
  }
  if (!pageTexts.length) {
    return res.json({ contacts: [], tech_stack: [] });
  }
  // BuiltWith tech stack lookup
  try {
    const bwResp = await fetch(
      'https://api.builtwith.com/free1/api.json?KEY=099e608a-eb03-4360-96a4-35dbd985a375&LOOKUP=' + domain,
      { signal: AbortSignal.timeout(8000) }
    );
    const bwData = await bwResp.json();
    const techs = bwData?.Results?.[0]?.Result?.Paths?.[0]?.Technologies || [];
    techs.slice(0, 8).forEach(t => { if (t.Name) techStack.push(t.Name); });
  } catch(e) { /* skip */ }
  // Combine page text for Claude
  const combinedText = pageTexts.map(p =>
    '=== PAGE: ' + p.url + ' ===\n' + p.text
  ).join('\n\n');
  // Claude Haiku extraction
  try {
    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `Extract ALL people mentioned on these website pages.
For each person find: full name, job title, email address, phone number.
IMPORTANT RULES:
- Only include real people with actual names (not generic roles like "Contact Us")
- Only include email if it is explicitly visible on the page
- Only include phone if it is explicitly visible on the page
- Title must be a real job title, not a section header
- Do not guess or fabricate any information
Return ONLY a valid JSON array, no markdown, no explanation:
[
  {
    "name": "Full Name",
    "title": "Job Title",
    "email": "email@domain.com or null",
    "phone": "phone number or null",
    "company": "Company Name",
    "source_page": "URL where found"
  }
]
If no qualifying people found, return [].
Pages to extract from:
${combinedText}`
        }]
      })
    });
    const claudeData = await claudeResp.json();
    const rawText = claudeData.content?.[0]?.text || '[]';
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const extracted = JSON.parse(cleaned);
    if (Array.isArray(extracted)) {
      extracted.forEach(c => {
        // Server-side quality filter: name + title required minimum
        if (c.name && c.name.trim().length > 1 && c.title && c.title.trim().length > 1) {
          contacts.push({
            name: c.name.trim(),
            title: c.title.trim(),
            email: c.email && c.email.includes('@') ? c.email.trim() : null,
            phone: c.phone || null,
            company: c.company || domain,
            domain: domain,
            source_page: c.source_page || url
          });
        }
      });
    }
  } catch(e) {
    console.error('Claude extraction error:', e.message);
  }
  // Email pattern guesser for contacts missing email
  // Only adds pattern guess — does not override verified emails
  contacts.forEach(c => {
    if (!c.email && c.name) {
      const parts = c.name.toLowerCase().replace(/[^a-z\s]/g,'').trim().split(/\s+/);
      const first = parts[0] || '';
      const last = parts[parts.length - 1] || '';
      if (first && last && last !== first && first.length > 1) {
        c.email_pattern = first + '.' + last + '@' + domain;
        c.email_confidence = 'pattern_guess';
      }
    }
  });
  res.json({ contacts, tech_stack: techStack });
}
