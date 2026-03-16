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
        }
      };

      // Only include persona_id if configured
      if (PERSONA_ID) {
        body.persona_id = PERSONA_ID;
      }

      // Re-patch tool_call_info webhook on persona before every conversation
      try {
        const patchResp = await fetch('https://tavusapi.com/v2/personas/p07dbe243a07', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.TAVUS_API_KEY || '111f845e282a47039e401fb80a1ae1ab'
          },
          body: JSON.stringify([
            {
              "op": "replace",
              "path": "/layers/llm/tool_call_info",
              "value": {
                "tool_call_webhook_url": "https://leadbooster-nine.vercel.app/api/rebecca-action"
              }
            }
          ])
        });
        console.log('[tavus-session] tool_call_info patched:', patchResp.status);
      } catch(e) {
        console.error('[tavus-session] patch failed:', e.message);
      }

      // Re-patch tools on persona before every conversation
      try {
        await fetch('https://tavusapi.com/v2/personas/p07dbe243a07', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.TAVUS_API_KEY || '111f845e282a47039e401fb80a1ae1ab'
          },
          body: JSON.stringify([{
            "op": "replace",
            "path": "/layers/llm/tools",
            "value": [
              {"type":"function","function":{"name":"run_territory_search","description":"Run territory search immediately when Tony gives city state vertical. Fire immediately no confirmation.","parameters":{"type":"object","required":["city","state","vertical"],"properties":{"city":{"type":"string"},"state":{"type":"string"},"vertical":{"type":"string"},"max_results":{"type":"number","enum":[10,20,30,40,50]}}}}},
              {"type":"function","function":{"name":"run_lead_booster","description":"Run Lead Booster on single company immediately.","parameters":{"type":"object","required":["company_name","domain","vertical"],"properties":{"company_name":{"type":"string"},"domain":{"type":"string"},"vertical":{"type":"string"}}}}},
              {"type":"function","function":{"name":"run_bulk_companies","description":"Run Lead Booster on multiple companies.","parameters":{"type":"object","required":["companies","vertical"],"properties":{"companies":{"type":"array","items":{"type":"string"}},"vertical":{"type":"string"}}}}},
              {"type":"function","function":{"name":"get_pipeline_briefing","description":"Pull live pipeline briefing.","parameters":{"type":"object","required":["confirmed"],"properties":{"confirmed":{"type":"boolean"}}}}}
            ]
          }])
        });
        console.log('[tavus-session] Tools re-patched');
      } catch(e) {
        console.error('[tavus-session] Tools patch failed:', e.message);
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
