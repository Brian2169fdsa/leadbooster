export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { stage, company_name, message, queue_id } = req.body;
  console.log('Rebecca status ping:', stage, company_name, message);

  const TAVUS_API_KEY = process.env.TAVUS_API_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://palcqjfgygpidzwjzikn.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_KEY) {
    console.error('rebecca-status: SUPABASE_SERVICE_KEY not configured');
    return res.status(500).json({ error: 'Supabase service key not configured' });
  }

  try {
    // Look up active Tavus session from Supabase
    const sessionRes = await fetch(
      SUPABASE_URL + '/rest/v1/lb_tavus_sessions?status=eq.active&order=created_at.desc&limit=1',
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY
        }
      }
    );
    const sessions = await sessionRes.json();

    if (!sessions || sessions.length === 0) {
      console.log('rebecca-status: no active Tavus session found');
      return res.status(200).json({ status: 'no_active_session', stage, message });
    }

    const conversation_id = sessions[0].conversation_id;

    // Make Rebecca speak the status update via Tavus
    let spoken = false;
    if (TAVUS_API_KEY && conversation_id) {
      try {
        const speakRes = await fetch(
          'https://tavusapi.com/v2/conversations/' + conversation_id + '/say',
          {
            method: 'POST',
            headers: {
              'x-api-key': TAVUS_API_KEY,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              script: { type: 'text', input: message }
            })
          }
        );
        spoken = speakRes.ok;
        console.log('rebecca-status: speak result', speakRes.status);
      } catch (speakErr) {
        console.error('rebecca-status: speak error', speakErr.message);
      }
    }

    // Log to lb_pipeline_status
    try {
      await fetch(SUPABASE_URL + '/rest/v1/lb_pipeline_status', {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          queue_id,
          company_name,
          stage,
          message,
          spoken,
          created_at: new Date().toISOString()
        })
      });
    } catch (logErr) {
      console.error('rebecca-status: log error', logErr.message);
    }

    return res.status(200).json({ status: 'spoken', stage, message, spoken });

  } catch (err) {
    console.error('rebecca-status error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
