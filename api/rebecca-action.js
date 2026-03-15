export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body;
  console.log('Rebecca action received:', JSON.stringify(body));

  // Tavus sends tool calls in multiple possible formats - handle all of them
  const toolName = body.tool_name || body.name || body.function?.name || body.type;
  const params = body.parameters || body.arguments || body.function?.arguments || body.input || {};
  const conversationId = body.conversation_id || body.conversationId || '';

  // City to state inference map
  const CITY_STATE_MAP = {
    // Arizona
    'phoenix': 'AZ', 'scottsdale': 'AZ', 'tempe': 'AZ', 'chandler': 'AZ',
    'gilbert': 'AZ', 'mesa': 'AZ', 'glendale': 'AZ', 'peoria': 'AZ',
    'tucson': 'AZ', 'flagstaff': 'AZ', 'sedona': 'AZ', 'yuma': 'AZ',
    // Nevada
    'las vegas': 'NV', 'henderson': 'NV', 'reno': 'NV', 'sparks': 'NV',
    'north las vegas': 'NV', 'boulder city': 'NV',
    // California
    'los angeles': 'CA', 'san francisco': 'CA', 'san diego': 'CA',
    'sacramento': 'CA', 'oakland': 'CA', 'san jose': 'CA', 'fresno': 'CA',
    'long beach': 'CA', 'bakersfield': 'CA', 'anaheim': 'CA',
    // Texas
    'houston': 'TX', 'dallas': 'TX', 'austin': 'TX', 'san antonio': 'TX',
    'fort worth': 'TX', 'el paso': 'TX', 'plano': 'TX', 'arlington': 'TX',
    // Florida
    'miami': 'FL', 'orlando': 'FL', 'tampa': 'FL', 'jacksonville': 'FL',
    'st petersburg': 'FL', 'fort lauderdale': 'FL', 'tallahassee': 'FL',
    // New York
    'new york': 'NY', 'new york city': 'NY', 'nyc': 'NY', 'brooklyn': 'NY',
    'buffalo': 'NY', 'rochester': 'NY', 'albany': 'NY',
    // Illinois
    'chicago': 'IL', 'aurora': 'IL', 'naperville': 'IL', 'rockford': 'IL',
    // Colorado
    'denver': 'CO', 'colorado springs': 'CO', 'fort collins': 'CO',
    // Washington
    'seattle': 'WA', 'spokane': 'WA', 'tacoma': 'WA', 'bellevue': 'WA',
    // Oregon
    'portland': 'OR', 'salem': 'OR', 'eugene': 'OR', 'bend': 'OR',
    // Georgia
    'atlanta': 'GA', 'savannah': 'GA', 'augusta': 'GA', 'columbus': 'GA',
    // North Carolina
    'charlotte': 'NC', 'raleigh': 'NC', 'greensboro': 'NC', 'durham': 'NC',
    // Tennessee
    'nashville': 'TN', 'memphis': 'TN', 'knoxville': 'TN', 'chattanooga': 'TN',
    // Ohio
    'cleveland': 'OH', 'cincinnati': 'OH', 'toledo': 'OH',
    // Michigan
    'detroit': 'MI', 'grand rapids': 'MI', 'warren': 'MI', 'ann arbor': 'MI',
    // Pennsylvania
    'philadelphia': 'PA', 'pittsburgh': 'PA', 'allentown': 'PA',
    // Massachusetts
    'boston': 'MA', 'worcester': 'MA', 'cambridge': 'MA',
    // Virginia
    'virginia beach': 'VA', 'norfolk': 'VA', 'richmond': 'VA',
    // Minnesota
    'minneapolis': 'MN', 'saint paul': 'MN',
    // Missouri
    'kansas city': 'MO', 'st louis': 'MO', 'saint louis': 'MO',
    // Utah
    'salt lake city': 'UT', 'provo': 'UT', 'west valley city': 'UT',
    // Indiana
    'indianapolis': 'IN', 'fort wayne': 'IN', 'evansville': 'IN',
  };

  // Vertical normalization
  const VERTICAL_MAP = {
    'construction': 'construction',
    'contractor': 'construction',
    'contractors': 'construction',
    'general contractor': 'construction',
    'behavioral health': 'behavioral_health',
    'behavioral_health': 'behavioral_health',
    'mental health': 'behavioral_health',
    'rehab': 'behavioral_health',
    'addiction': 'behavioral_health',
    'medical transport': 'medical_transport',
    'medical_transport': 'medical_transport',
    'nemt': 'medical_transport',
    'ambulance': 'medical_transport',
    'transport': 'medical_transport',
    'healthcare': 'healthcare',
    'medical': 'healthcare',
    'health': 'healthcare',
    'b2b': 'b2b_professional_services',
    'professional services': 'b2b_professional_services',
    'home services': 'home_services',
    'hvac': 'home_services',
    'plumbing': 'home_services',
  };

  function inferState(city) {
    if (!city) return null;
    const normalized = city.toLowerCase().trim();
    return CITY_STATE_MAP[normalized] || null;
  }

  function normalizeVertical(vertical) {
    if (!vertical) return 'construction';
    const normalized = vertical.toLowerCase().trim();
    return VERTICAL_MAP[normalized] || vertical;
  }

  const N8N_BASE = 'https://manageai2026.app.n8n.cloud/webhook';

  try {
    // ===== TERRITORY SEARCH =====
    if (toolName === 'run_territory_search') {
      // Global in-memory dedup — prevents Tavus multi-fires within 10 seconds
      const dedupKey = `territory_${(params.city||'').toLowerCase()}_${(params.state||'').toLowerCase()}`;
      if (!global._rebeccaDedup) global._rebeccaDedup = {};
      const lastFire = global._rebeccaDedup[dedupKey] || 0;
      if (Date.now() - lastFire < 10000) {
        console.log('[rebecca-action] Dedup blocked territory fire:', dedupKey);
        return res.status(200).json({
          success: true,
          message: 'Already searching that territory Boss, hang tight.'
        });
      }
      global._rebeccaDedup[dedupKey] = Date.now();

      let city = (params.city || '').trim();
      let state = (params.state || '').trim();
      let vertical = normalizeVertical(params.vertical);

      // Infer state from city if not provided
      if (!state && city) {
        const inferredState = inferState(city);
        if (inferredState) {
          state = inferredState;
          console.log('Rebecca: inferred state', inferredState, 'for city', city);
        }
      }

      // Fallback defaults
      if (!city) city = 'Phoenix';
      if (!state) state = 'AZ';

      console.log('Rebecca: firing territory search', city, state, vertical);

      const response = await fetch(N8N_BASE + '/lb-territory-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city: city,
          state: state,
          vertical: vertical,
          submitter_name: 'Tony',
          submitter_email: 'tony@manageai.io',
          source: 'rebecca_tavus_tool'
        })
      });

      console.log('Territory webhook status:', response.status);

      return res.status(200).json({
        result: 'Territory search is running for ' + city + ' ' + state + ' in ' + vertical + '. Give me a couple minutes Boss — I will tell you what comes back.'
      });
    }

    // ===== SINGLE COMPANY =====
    if (toolName === 'run_lead_booster') {
      let company = (params.company_name || params.company || '').trim();
      let domain = (params.domain || '').trim();
      let vertical = normalizeVertical(params.vertical);

      if (!company) {
        return res.status(200).json({
          result: 'I need a company name Boss. What company do you want me to run?'
        });
      }

      // Auto-generate domain if not provided
      if (!domain) {
        domain = company.toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .replace(/\s+(inc|llc|corp|construction|group|services|company|co)$/g, '')
          .trim()
          .replace(/\s+/g, '') + '.com';
        console.log('Rebecca: auto-generated domain:', domain);
      }

      console.log('Rebecca: firing Lead Booster for', company, domain, vertical);

      const response = await fetch(N8N_BASE + '/lb-discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: company,
          domain: domain,
          vertical: vertical,
          submitter_name: 'Tony',
          submitter_email: 'tony@manageai.io',
          source: 'rebecca_tavus_tool'
        })
      });

      console.log('Discovery webhook status:', response.status);

      return res.status(200).json({
        result: 'On it Boss. Running Lead Booster for ' + company + ' right now. I will give you updates as it progresses.'
      });
    }

    // ===== BULK UPLOAD =====
    if (toolName === 'run_bulk_upload') {
      return res.status(200).json({
        result: 'Opening the bulk upload panel now Boss. Paste your list or drop a CSV and hit Run.',
        action: 'show_bulk_panel'
      });
    }

    // ===== UNKNOWN TOOL =====
    console.log('Rebecca: unknown tool called:', toolName);
    return res.status(200).json({
      result: 'Got it Boss. What do you need?'
    });

  } catch (err) {
    console.error('Rebecca action error:', err);
    return res.status(200).json({
      result: 'Sorry Boss, I hit a technical issue. Try again in a moment.'
    });
  }
}
