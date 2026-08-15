/**
 * Vercel Serverless Function: API Proxy to Google Apps Script
 * 
 * This endpoint receives requests from the frontend (browser) and relays them
 * to the Google Apps Script backend via HTTP.
 * 
 * CORS is not an issue because this is server-to-server communication.
 * The browser only talks to same-origin /api/backend endpoint.
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

  // Extract action and params from request body
  const { action, params } = req.body;

  // Validate required fields
  if (!action) {
    return res.status(400).json({ error: 'Missing action parameter' });
  }

  if (!params || !Array.isArray(params)) {
    return res.status(400).json({ error: 'params must be an array' });
  }

  // Get Apps Script URL from environment variable
  const appsScriptUrl = process.env.APPS_SCRIPT_URL;
  if (!appsScriptUrl) {
    console.error('APPS_SCRIPT_URL environment variable not set');
    return res.status(500).json({ error: 'Backend configuration error' });
  }

  try {
    // Forward request to Apps Script
    const response = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: action,
        params: params
      })
    });

    // Check if Apps Script responded with an error status
    if (!response.ok) {
      console.error(`Apps Script returned ${response.status}: ${response.statusText}`);
      return res.status(502).json({ error: `Backend returned ${response.status}` });
    }

    // Parse response from Apps Script
    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      console.error('Failed to parse Apps Script response:', parseError);
      return res.status(502).json({ error: 'Invalid response from backend' });
    }

    // Return data to frontend
    return res.status(200).json(data);

  } catch (error) {
    console.error('Proxy error:', error.message);
    return res.status(502).json({ error: 'Backend connection error: ' + error.message });
  }
}
