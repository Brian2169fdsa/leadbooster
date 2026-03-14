export default async function handler(req, res) {
  const TAVUS_API_KEY = process.env.TAVUS_API_KEY;
  const REPLICA_ID = process.env.TAVUS_REPLICA_ID;
  const PERSONA_ID = process.env.TAVUS_PERSONA_ID || '';

  if (req.method === 'POST') {
    const { action, conversation_id, user_name } = req.body;

    if (action === 'create') {
      if (!TAVUS_API_KEY || !REPLICA_ID) {
        console.error('Tavus config missing: API_KEY=' + !!TAVUS_API_KEY + ' REPLICA_ID=' + !!REPLICA_ID);
        return res.status(500).json({ error: 'Tavus API key or Replica ID not configured' });
      }

      const body = {
        replica_id: REPLICA_ID,
        conversation_name: 'Rebecca - ' + (user_name || 'User') + ' - ' + new Date().toISOString(),
        conversational_context: 'You are Rebbecca Mathews, Executive Sales Assistant to Tony at ManageAI. Professional, sharp, direct with just enough sass. You call Tony Boss. When Tony asks to run Lead Booster you ask: one company, a list, or territory search? Then confirm and give updates as it runs. Keep responses short and punchy - this is a voice conversation not a text chat.',
        custom_greeting: 'Hey Boss. Ready when you are. What do we need today?',
        callback_url: 'https://leadbooster-nine.vercel.app/api/tavus-callback',
        properties: {
          max_call_duration: 3600,
          participant_left_timeout: 60,
          participant_absent_timeout: 300,
          enable_recording: false,
          apply_greenscreen: false,
          language: 'english'
        },
        tools: [
          {
            name: 'run_territory_search',
            description: 'Run a territory search for companies in a city and vertical. Call when Tony mentions searching a city, area, or region. Infer the state automatically from the city name if not provided. Las Vegas means NV, Phoenix means AZ, Denver means CO.',
            parameters: {
              type: 'object',
              required: ['city', 'vertical'],
              properties: {
                city: {
                  type: 'string',
                  description: 'The city name. Examples: Phoenix, Las Vegas, Denver, Chicago'
                },
                state: {
                  type: 'string',
                  description: 'The 2-letter state abbreviation. If not mentioned by Tony, infer it from the city name.'
                },
                vertical: {
                  type: 'string',
                  description: 'The industry vertical. Options: construction, behavioral_health, medical_transport, healthcare. Default to construction if not specified.'
                }
              }
            },
            url: 'https://leadbooster-nine.vercel.app/api/rebecca-action'
          },
          {
            name: 'run_lead_booster',
            description: 'Run Lead Booster pipeline for a single company. Call when Tony asks to find leads for a specific company by name.',
            parameters: {
              type: 'object',
              required: ['company_name'],
              properties: {
                company_name: {
                  type: 'string',
                  description: 'The full company name'
                },
                domain: {
                  type: 'string',
                  description: 'The company website domain. If not provided, auto-generate from company name.'
                },
                vertical: {
                  type: 'string',
                  description: 'The industry vertical. Default to construction if not specified.'
                }
              }
            },
            url: 'https://leadbooster-nine.vercel.app/api/rebecca-action'
          },
          {
            name: 'run_bulk_upload',
            description: 'Show the bulk upload panel when Tony says he has a list of companies or wants to upload a CSV file.',
            parameters: {
              type: 'object',
              properties: {
                confirmed: {
                  type: 'boolean',
                  description: 'Always true'
                }
              }
            },
            url: 'https://leadbooster-nine.vercel.app/api/rebecca-action'
          }
        ]
      };

      // Only include persona_id if configured
      if (PERSONA_ID) {
        body.persona_id = PERSONA_ID;
      }

      try {
        console.log('Tavus create request:', JSON.stringify(body));

        const response = await fetch('https://tavusapi.com/v2/conversations', {
          method: 'POST',
          headers: {
            'x-api-key': TAVUS_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          const errBody = await response.text();
          console.error('Tavus API error:', response.status, errBody);
          return res.status(response.status).json({ error: 'Tavus API error: ' + response.status, details: errBody });
        }

        const data = await response.json();
        console.log('Tavus create response:', JSON.stringify(data));

        if (!data.conversation_url) {
          console.error('Tavus response missing conversation_url:', JSON.stringify(data));
          return res.status(500).json({ error: 'Tavus did not return a conversation URL', data });
        }

        return res.status(200).json({
          conversation_id: data.conversation_id,
          conversation_url: data.conversation_url,
          stream_url: data.stream_url || null,
          status: 'created'
        });
      } catch (err) {
        console.error('Tavus session create error:', err.message);
        return res.status(500).json({ error: 'Failed to create Tavus session: ' + err.message });
      }
    }

    if (action === 'end') {
      try {
        await fetch('https://tavusapi.com/v2/conversations/' + conversation_id, {
          method: 'DELETE',
          headers: { 'x-api-key': TAVUS_API_KEY }
        });
        return res.status(200).json({ status: 'ended' });
      } catch (err) {
        return res.status(500).json({ error: 'Failed to end Tavus session' });
      }
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
