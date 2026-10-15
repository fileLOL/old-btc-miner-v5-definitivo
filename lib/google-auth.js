'use strict';

const https = require('https');

function verifyGoogleIdToken(idToken, clientId) {
  if (!clientId || typeof idToken !== 'string' || idToken.length > 8192) {
    return Promise.resolve({ valid: false, error: 'Google sign-in is not configured' });
  }
  return new Promise((resolve) => {
    const url = new URL('https://oauth2.googleapis.com/tokeninfo');
    url.searchParams.set('id_token', idToken);
    const request = https.get(url, { timeout: 5000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; if (body.length > 16384) request.destroy(); });
      response.on('end', () => {
        try {
          const data = JSON.parse(body);
          const valid = response.statusCode === 200 && data.aud === clientId &&
            data.iss && ['accounts.google.com', 'https://accounts.google.com'].includes(data.iss) &&
            data.email_verified === 'true' && data.sub;
          resolve(valid ? { valid: true, googleId: data.sub, email: data.email || null, name: data.name || null }
            : { valid: false, error: 'Google token is invalid or email is not verified' });
        } catch { resolve({ valid: false, error: 'Invalid Google token response' }); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', () => resolve({ valid: false, error: 'Google verification unavailable' }));
  });
}

module.exports = { verifyGoogleIdToken };
