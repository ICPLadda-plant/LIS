const crypto = require('crypto');

const COOKIE_NAME = 'lis_session';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;

function base64urlEncode(input) {
  return Buffer.from(input).toString('base64url');
}

function base64urlDecode(input) {
  return Buffer.from(input, 'base64url');
}

function sessionSecret(options = {}) {
  return options.secret || process.env.LIS_SESSION_SECRET || process.env.LIS_SSO_SECRET || process.env.PRODUCTION_SSO_SECRET || '';
}

function ttlSeconds(options = {}) {
  const configured = Number(process.env.LIS_SESSION_TTL_SECONDS);
  if (Number.isFinite(options.ttlSeconds) && options.ttlSeconds > 0) return Math.floor(options.ttlSeconds);
  if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
  return DEFAULT_TTL_SECONDS;
}

function secondsNow(options = {}) {
  const date = options.now instanceof Date ? options.now : new Date();
  return Math.floor(date.getTime() / 1000);
}

function signPayload(payloadPart, secret) {
  return crypto.createHmac('sha256', secret).update(payloadPart).digest('base64url');
}

function createLisSessionCookieValue(userId, options = {}) {
  const secret = sessionSecret(options);
  if (!secret) throw new Error('LIS session cookie secret is not configured');

  const payload = {
    sub: String(userId || '').trim(),
    exp: secondsNow(options) + ttlSeconds(options),
  };
  if (!payload.sub) throw new Error('LIS session cookie user id is required');

  const payloadPart = base64urlEncode(JSON.stringify(payload));
  const signaturePart = signPayload(payloadPart, secret);
  return `${payloadPart}.${signaturePart}`;
}

function verifyLisSessionCookieValue(value, options = {}) {
  const secret = sessionSecret(options);
  if (!value || !secret) return null;

  const [payloadPart, signaturePart] = String(value).split('.');
  if (!payloadPart || !signaturePart) return null;

  const expected = signPayload(payloadPart, secret);
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(signaturePart);
  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(base64urlDecode(payloadPart).toString('utf8'));
  } catch {
    return null;
  }

  const userId = String(payload.sub || '').trim();
  const expiresAt = Number(payload.exp);
  if (!userId || !Number.isFinite(expiresAt)) return null;
  if (secondsNow(options) > expiresAt) return null;

  return { userId, expiresAt };
}

function parseCookieHeader(header) {
  return String(header || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separator = part.indexOf('=');
      if (separator === -1) return cookies;
      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      if (name) cookies[name] = value;
      return cookies;
    }, {});
}

function getLisSessionUserId(req, options = {}) {
  const cookies = parseCookieHeader(req?.headers?.cookie);
  return verifyLisSessionCookieValue(cookies[COOKIE_NAME], options)?.userId || null;
}

function requestIsSecure(req) {
  return Boolean(req?.secure || String(req?.get?.('x-forwarded-proto') || '').split(',')[0].trim() === 'https');
}

function serializeCookie(name, value, attributes = {}) {
  const parts = [`${name}=${value}`];
  if (attributes.maxAge !== undefined) parts.push(`Max-Age=${attributes.maxAge}`);
  if (attributes.expires) parts.push(`Expires=${attributes.expires.toUTCString()}`);
  parts.push(`Path=${attributes.path || '/'}`);
  if (attributes.httpOnly) parts.push('HttpOnly');
  if (attributes.secure) parts.push('Secure');
  parts.push(`SameSite=${attributes.sameSite || 'Lax'}`);
  return parts.join('; ');
}

function setLisSessionCookie(res, userId, req, options = {}) {
  const value = createLisSessionCookieValue(userId, options);
  res.setHeader(
    'Set-Cookie',
    serializeCookie(COOKIE_NAME, value, {
      httpOnly: true,
      maxAge: ttlSeconds(options),
      path: '/',
      sameSite: 'Lax',
      secure: requestIsSecure(req),
    }),
  );
}

function clearLisSessionCookie(res, req) {
  res.setHeader(
    'Set-Cookie',
    serializeCookie(COOKIE_NAME, '', {
      expires: new Date(0),
      httpOnly: true,
      maxAge: 0,
      path: '/',
      sameSite: 'Lax',
      secure: requestIsSecure(req),
    }),
  );
}

module.exports = {
  COOKIE_NAME,
  DEFAULT_TTL_SECONDS,
  createLisSessionCookieValue,
  clearLisSessionCookie,
  getLisSessionUserId,
  setLisSessionCookie,
  verifyLisSessionCookieValue,
};
