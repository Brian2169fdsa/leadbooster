export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { audio_base64, mime_type, contact_name,
            company, vertical } = req.body;

    if (!audio_base64) {
      return res.status(400).json({ error: 'No audio provided' });
    }

    // Convert base64 to buffer
    const audioBuffer = Buffer.from(audio_base64, 'base64');
    const ext = (mime_type || 'audio/webm').includes('mp4')
      ? 'mp4' : 'webm';

    // Build FormData for Whisper
    const { Blob } = await import('buffer');
    const audioBlob = new Blob([audioBuffer],
      { type: mime_type || 'audio/webm' });

    const formData = new FormData();
    formData.append('file', audioBlob,
      'recording.' + ext);
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');
    formData.append('response_format', 'text');

    // Call OpenAI Whisper
    const whisperResp = await fetch(
      'https://api.openai.com/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' +
            process.env.OPENAI_API_KEY
        },
        body: formData
      }
    );

    if (!whisperResp.ok) {
      const err = await whisperResp.text();
      console.error('Whisper error:', err);
      // Return raw transcript placeholder if Whisper fails
      return res.status(200).json({
        transcript: '[Transcription unavailable]',
        summary: 'Audio recorded but could not be transcribed. Add notes manually.'
      });
    }

    const transcript = await whisperResp.text();

    if (!transcript || transcript.trim().length < 10) {
      return res.status(200).json({
        transcript: '',
        summary: 'No speech detected in recording.'
      });
    }

    // Use Claude to summarize into clean call notes
    const claudeResp = await fetch(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          messages: [{
            role: 'user',
            content: 'You are a sales call notes summarizer.' +
              ' Contact: ' + (contact_name || 'Unknown') +
              ' at ' + (company || 'Unknown') +
              ' (' + (vertical || '') + ').' +
              '\n\nTranscript:\n' + transcript +
              '\n\nWrite clean, structured call notes.' +
              ' Include: key points discussed,' +
              ' objections raised, next steps mentioned,' +
              ' and overall call sentiment.' +
              ' Keep it under 200 words.' +
              ' No preamble — start directly with the notes.'
          }]
        })
      }
    );

    let summary = transcript; // fallback to raw transcript
    if (claudeResp.ok) {
      const claudeData = await claudeResp.json();
      summary = claudeData.content?.[0]?.text || transcript;
    }

    return res.status(200).json({
      transcript: transcript,
      summary: summary
    });

  } catch (err) {
    console.error('transcribe-call error:', err);
    return res.status(200).json({
      transcript: '',
      summary: 'Recording saved — transcription failed. Add notes manually.'
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};
