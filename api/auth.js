/**
 * Vercel Serverless Function: Authentication Endpoint
 * 
 * Handles Google OAuth ID token verification via google-auth-library,
 * 2-user email whitelist authorization, session cookie issuance, session checks, and logout.
 */

const { OAuth2Client } = require('google-auth-library');
const { getSession, createSessionCookie, createClearCookie } = require('./session');

function getAllowedEmails() {
  const env = process.env.ALLOWED_EMAILS || '';
  return env.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}

module.exports = async function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;

  // 1. GET: Check current session status
  if (req.method === 'GET') {
    const session = getSession(req);
    const allowedEmails = getAllowedEmails();

    if (session && session.email && allowedEmails.includes(session.email.toLowerCase())) {
      return res.status(200).json({
        authenticated: true,
        user: { sub: session.sub, email: session.email },
        clientId: clientId || ''
      });
    }

    return res.status(200).json({
      authenticated: false,
      clientId: clientId || ''
    });
  }

  // 2. DELETE: Logout
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', createClearCookie());
    return res.status(200).json({ ok: true, message: 'Logged out successfully' });
  }

  // 3. POST: Login with Google ID Token
  if (req.method === 'POST') {
    const { credential } = req.body || {};

    if (!credential) {
      return res.status(400).json({ error: 'Missing Google ID token credential' });
    }

    if (!clientId) {
      console.error('GOOGLE_CLIENT_ID environment variable not set');
      return res.status(500).json({ error: 'Server configuration error: GOOGLE_CLIENT_ID is missing' });
    }

    try {
      // Verify ID token using Google's official Node.js library
      const client = new OAuth2Client(clientId);
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: clientId
      });

      const payload = ticket.getPayload();
      if (!payload) {
        return res.status(401).json({ error: 'Invalid Google ID token payload' });
      }

      // Security Checks: aud, iss, email_verified, exp
      const issuer = payload.iss;
      const validIssuer = issuer === 'accounts.google.com' || issuer === 'https://accounts.google.com';
      if (!validIssuer) {
        return res.status(401).json({ error: 'Invalid token issuer' });
      }

      if (payload.aud !== clientId) {
        return res.status(401).json({ error: 'Token audience mismatch' });
      }

      if (!payload.email_verified) {
        return res.status(401).json({ error: 'Google email is not verified' });
      }

      if (!payload.exp || payload.exp * 1000 < Date.now()) {
        return res.status(401).json({ error: 'Google ID token expired' });
      }

      const email = payload.email.toLowerCase();
      const sub = payload.sub; // Stable Google User Subject ID
      const allowedEmails = getAllowedEmails();

      // Enforce 2-user allowlist
      if (!allowedEmails.includes(email)) {
        console.warn(`Access Denied: Unauthorized login attempt by ${email} (sub: ${sub})`);
        return res.status(403).json({ error: `Access Denied: Email '${email}' is not in the authorized user list.` });
      }

      // Issue HttpOnly + Secure + SameSite=Lax session cookie
      const cookieHeader = createSessionCookie({ sub, email });
      res.setHeader('Set-Cookie', cookieHeader);

      return res.status(200).json({
        ok: true,
        user: { sub, email }
      });

    } catch (error) {
      console.error('Google ID token verification error:', error.message);
      return res.status(401).json({ error: 'Authentication failed: ' + error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
