/**
 * Vercel Serverless Function: secure AI MOM Summarization Endpoint
 * 
 * Proxies request to Google Gemini API (gemini-3.5-flash) using server-side key
 * to prevent exposure of GEMINI_API_KEY in index.html.
 * 
 * Uses Gemini Files API for recordings >= 2.5 MB to avoid payload size issues,
 * and inlineData for smaller files.
 */

const { getSession } = require('./session');

module.exports = async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Enforce Server-Side Session Authentication
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized: Session missing or expired. Please sign in.' });
  }

  // 2. Enforce 2-User Allowlist Server-Side
  const allowedEmails = (process.env.ALLOWED_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (!allowedEmails.includes(session.email.toLowerCase())) {
    return res.status(403).json({ error: `Forbidden: Email '${session.email}' is not authorized.` });
  }

  const { fileId, text } = req.body || {};
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error('GEMINI_API_KEY environment variable is missing');
    return res.status(500).json({ error: 'Server configuration error: GEMINI_API_KEY is missing' });
  }

  const appsScriptUrl = process.env.APPS_SCRIPT_URL;
  if (!appsScriptUrl) {
    console.error('APPS_SCRIPT_URL environment variable not set');
    return res.status(500).json({ error: 'Server configuration error: APPS_SCRIPT_URL is missing' });
  }

  let fileIdOnGemini = null;

  try {
    let mediaPart = null;

    // 3. Retrieve Audio from Apps Script / Google Drive
    if (fileId) {
      const response = await fetch(appsScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getAudioBase64', params: [fileId] })
      });

      if (!response.ok) {
        throw new Error(`Google Apps Script returned status ${response.status}`);
      }

      const scriptRes = await response.json();
      if (!scriptRes || !scriptRes.ok) {
        throw new Error(scriptRes ? scriptRes.msg : 'Invalid response from Apps Script');
      }

      const base64Data = scriptRes.base64;
      const mimeType = scriptRes.mimeType || 'audio/webm';
      const buffer = Buffer.from(base64Data, 'base64');
      const size = buffer.length;

      // 4. Determine upload strategy (Files API for >= 2.5MB, inlineData for smaller files)
      if (size >= 2.5 * 1024 * 1024) {
        console.log(`Using Gemini Files API upload for large audio file (${Math.round(size / 1048576)} MB)`);
        
        // Step A: Initialize resumable upload
        const initResponse = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`, {
          method: 'POST',
          headers: {
            'X-Goog-Upload-Protocol': 'resumable',
            'X-Goog-Upload-Command': 'start',
            'X-Goog-Upload-Header-Content-Length': size.toString(),
            'X-Goog-Upload-Header-Content-Type': mimeType,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            file: { displayName: `MOM_Audio_${Date.now()}` }
          })
        });

        if (!initResponse.ok) {
          throw new Error(`Failed to initialize Files API upload: ${await initResponse.text()}`);
        }

        const uploadUrl = initResponse.headers.get('x-goog-upload-url');
        if (!uploadUrl) {
          throw new Error('Upload URL was not provided in headers by Gemini');
        }

        // Step B: Upload file bytes
        const uploadResult = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            'X-Goog-Upload-Command': 'upload, finalize',
            'X-Goog-Upload-Offset': '0',
            'Content-Length': size.toString(),
          },
          body: buffer
        });

        if (!uploadResult.ok) {
          throw new Error(`Files API upload transfer failed: ${await uploadResult.text()}`);
        }

        const fileData = await uploadResult.json();
        const fileUri = fileData.file.uri;
        fileIdOnGemini = fileData.file.name; // save for cleanup

        mediaPart = {
          fileData: {
            fileUri: fileUri,
            mimeType: mimeType
          }
        };
      } else {
        console.log(`Using inlineData for small audio file (${Math.round(size / 1024)} KB)`);
        mediaPart = {
          inlineData: {
            data: base64Data,
            mimeType: mimeType
          }
        };
      }
    }

    // 5. Send Prompt & Media to Gemini (gemini-3.5-flash)
    const systemPrompt = `You are a professional secretary. Analyze the provided meeting audio (or raw text notes) and generate a structured JSON object representing the Minutes of Meeting (MOM).

You must return ONLY a valid JSON object matching this schema:
{
  "transcript": "Literal transcription of the audio, or raw text if audio is missing",
  "summary": "High-level executive summary of the meeting",
  "discussion": "Detailed description of the key discussion points and agenda topics",
  "decisions": "Bulleted list or text summarizing all decisions made during the meeting",
  "actions": [
    {
      "what": "Action item description",
      "owner": "Name or email of the person responsible",
      "due": "YYYY-MM-DD"
    }
  ]
}

Ensure the 'actions' array elements have the 'what', 'owner', and 'due' properties (use empty string if not mentioned).`;

    const parts = [];
    if (mediaPart) {
      parts.push(mediaPart);
    } else {
      parts.push({ text: `Meeting Input Notes:\n${text || ''}` });
    }
    parts.push({ text: systemPrompt });

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;
    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: 'application/json'
        }
      })
    });

    if (!geminiResponse.ok) {
      throw new Error(`Gemini API returned status ${geminiResponse.status}: ${await geminiResponse.text()}`);
    }

    const geminiResult = await geminiResponse.json();
    let textResponse = geminiResult.candidates[0].content.parts[0].text;

    // Clean up code block fences if present in output
    textResponse = textResponse.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(textResponse);

    return res.status(200).json({ ok: true, data: parsed });

  } catch (error) {
    console.error('AI Summarize Error:', error.message);
    return res.status(502).json({ error: 'AI processing failed: ' + error.message });

  } finally {
    // 6. Clean up uploaded Gemini File API object
    if (fileIdOnGemini) {
      try {
        console.log(`Cleaning up Gemini File API object: ${fileIdOnGemini}`);
        await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileIdOnGemini}?key=${apiKey}`, {
          method: 'DELETE'
        });
      } catch (cleanupError) {
        console.error('Failed to clean up Gemini file object:', cleanupError.message);
      }
    }
  }
};
