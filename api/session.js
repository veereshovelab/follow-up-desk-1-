const crypto = require('crypto');

const COOKIE_NAME = 'fud_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET environment variable is missing.');
  }
  return secret;
}

/**
 * Sign data payload with HMAC-SHA256
 */
function sign(data) {
  const secret = getSecret();
  const json = JSON.stringify(data);
  const base64Data = Buffer.from(json).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(base64Data).digest('base64url');
  return `${base64Data}.${signature}`;
}

/**
 * Verify and decode signed payload
 */
function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [base64Data, signature] = parts;
  const secret = getSecret();
  const expectedSignature = crypto.createHmac('sha256', secret).update(base64Data).digest('base64url');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(base64Data, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) {
      return null; // Expired session
    }
    return payload;
  } catch (e) {
    return null;
  }
}

/**
 * Parse cookies from request headers
 */
function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      list[parts.shift().trim()] = decodeURIComponent(parts.join('='));
    });
  }
  return list;
}

/**
 * Create Set-Cookie header string
 */
function createSessionCookie(payload, maxAgeSeconds = SESSION_TTL_MS / 1000) {
  const token = sign({
    ...payload,
    exp: Date.now() + (maxAgeSeconds * 1000)
  });
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

/**
 * Create Set-Cookie header to clear session
 */
function createClearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/**
 * Get verified session from HTTP request
 */
function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  return verify(token);
}

module.exports = {
  sign,
  verify,
  parseCookies,
  createSessionCookie,
  createClearCookie,
  getSession,
  COOKIE_NAME
};
