const crypto = require('crypto');
const https = require('https');

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let cachedCerts = null;
let cachedCertsTime = 0;

function fetchCerts() {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    if (cachedCerts && (now - cachedCertsTime) < CACHE_TTL_MS) {
      return resolve(cachedCerts);
    }
    https.get(GOOGLE_CERTS_URL, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const certs = JSON.parse(data);
          cachedCerts = certs;
          cachedCertsTime = now;
          resolve(certs);
        } catch (e) {
          reject(new Error('Failed to parse Google certs: ' + e.message));
        }
      });
    }).on('error', reject);
  });
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function verifyRS256(header, payload, signature, cert) {
  const verify = crypto.createVerify('RSA-SHA256');
  verify.update(header + '.' + payload);
  return verify.verify(cert, signature);
}

async function verifyGoogleIdToken(idToken, expectedClientId) {
  if (!idToken || typeof idToken !== 'string') {
    return { valid: false, error: 'invalid token format' };
  }

  const parts = idToken.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'invalid JWT structure' };
  }

  let header, payload;
  try {
    header = JSON.parse(base64UrlDecode(parts[0]).toString('utf8'));
    payload = JSON.parse(base64UrlDecode(parts[1]).toString('utf8'));
  } catch (e) {
    return { valid: false, error: 'failed to decode JWT' };
  }

  if (header.alg !== 'RS256' || header.typ !== 'JWT') {
    return { valid: false, error: 'unsupported algorithm or type' };
  }

  const certs = await fetchCerts();
  const cert = certs.keys.find(k => k.kid === header.kid);
  if (!cert) {
    cachedCerts = null;
    cachedCertsTime = 0;
    return { valid: false, error: 'certificate not found' };
  }

  const publicKey = crypto.createPublicKey({
    key: {
      kty: cert.kty,
      n: cert.n,
      e: cert.e,
    },
    format: 'jwk',
  });

  const signature = base64UrlDecode(parts[2]);
  const valid = verifyRS256(parts[0], parts[1], signature, publicKey);
  if (!valid) {
    return { valid: false, error: 'invalid signature' };
  }

  if (!GOOGLE_ISSUERS.includes(payload.iss)) {
    return { valid: false, error: 'invalid issuer' };
  }

  if (payload.aud !== expectedClientId) {
    return { valid: false, error: 'invalid audience' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    return { valid: false, error: 'token expired' };
  }

  if (payload.iat && payload.iat > now + 300) {
    return { valid: false, error: 'token issued in future' };
  }

  if (!payload.sub || typeof payload.sub !== 'string') {
    return { valid: false, error: 'missing subject' };
  }

  return {
    valid: true,
    googleId: payload.sub,
    email: payload.email || null,
    name: payload.name || null,
    picture: payload.picture || null,
  };
}

module.exports = { verifyGoogleIdToken };
