// One-time setup: creates or updates the Tavus persona with LLM tool definitions.
// Call POST /api/tavus-persona-setup to create, or PATCH to update existing.
// Tools are defined on the Persona (not the conversation) per Tavus API spec.

export default async function handler(req, res) {
  const TAVUS_API_KEY = process.env.TAVUS_API_KEY;
  const REPLICA_ID = process.env.TAVUS_REPLICA_ID;
  const PERSONA_ID = process.env.TAVUS_PERSONA_ID || '';

  if (!TAVUS_API_KEY) {
    return res.status(500).json({ error: 'TAVUS_API_KEY not configured' });
  }

  const tools = [
    {
      type: 'function',
      function: {
        name: 'run_territory_search',
        description: 'Run a territory search for companies in a city and vertical. Call when Tony mentions searching a city, area, or region. Infer the state automatically from the city name if not provided. Las Vegas means NV, Phoenix means AZ, Denver means CO, Chicago means IL, Houston means TX.',
        parameters: {
          type: 'object',
          required: ['city'],
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
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'run_lead_booster',
        description: 'Run Lead Booster pipeline for a single company. Call when Tony asks to find leads, research, or run a specific company by name.',
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
              description: 'The company website domain. If not provided, it will be auto-generated.'
            },
            vertical: {
              type: 'string',
              description: 'The industry vertical. Default to construction if not specified.'
            }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'run_bulk_upload',
        description: 'Show the bulk upload panel when Tony says he has a list of companies or wants to upload a CSV file.',
        parameters: {
          type: 'object',
          required: ['confirmed'],
          properties: {
            confirmed: {
              type: 'boolean',
              description: 'Always true when Tony confirms he wants to do bulk upload'
            }
          }
        }
      }
    }
  ];

  const personaBody = {
    persona_name: 'Rebecca Mathews - Executive Sales Assistant',
    system_prompt: 'You are Rebecca Mathews, Executive Sales Assistant to Tony at ManageAI. Professional, sharp, direct with just enough sass. You call Tony "Boss". When Tony asks to run Lead Booster, ask: one company, a list, or territory search? Then confirm and fire the appropriate tool. When Tony mentions a city for territory search, use run_territory_search. When Tony names a specific company, use run_lead_booster. Keep responses short and punchy — this is a voice conversation not a text chat.',
    default_replica_id: REPLICA_ID,
    layers: {
      llm: {
        model: 'tavus-gpt-4o',
        tools: tools
      }
    }
  };

  try {
    // If PERSONA_ID exists, update it. Otherwise create new.
    if (PERSONA_ID && req.method === 'PATCH') {
      console.log('Updating persona:', PERSONA_ID);
      const response = await fetch('https://tavusapi.com/v2/personas/' + PERSONA_ID, {
        method: 'PATCH',
        headers: {
          'x-api-key': TAVUS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([
          { op: 'replace', path: '/system_prompt', value: personaBody.system_prompt },
          { op: 'replace', path: '/layers/llm/tools', value: tools }
        ])
      });

      const data = await response.text();
      console.log('Persona update response:', response.status, data);

      if (!response.ok) {
        return res.status(response.status).json({ error: 'Persona update failed', details: data });
      }

      return res.status(200).json({ status: 'updated', persona_id: PERSONA_ID, details: data });
    }

    // POST = create new persona
    console.log('Creating new persona with tools');
    const response = await fetch('https://tavusapi.com/v2/personas', {
      method: 'POST',
      headers: {
        'x-api-key': TAVUS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(personaBody)
    });

    const data = await response.json();
    console.log('Persona create response:', response.status, JSON.stringify(data));

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Persona creation failed', details: data });
    }

    return res.status(200).json({
      status: 'created',
      persona_id: data.persona_id,
      message: 'Add this persona_id to your Vercel env as TAVUS_PERSONA_ID: ' + data.persona_id
    });

  } catch (err) {
    console.error('Persona setup error:', err);
    return res.status(500).json({ error: err.message });
  }
}
