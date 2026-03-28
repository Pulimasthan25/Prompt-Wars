/**
 * Optional Google Identity Services (OAuth 2.0) ID token verification.
 * Set GOOGLE_OAUTH_CLIENT_ID to your Web client ID; REQUIRED_GOOGLE_AUTH=true to enforce.
 */

function createGoogleAuthMiddleware() {
  const clientId = (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const requireAuth = process.env.REQUIRE_GOOGLE_AUTH === 'true';

  return async function googleAuthMiddleware(req, res, next) {
    if (requireAuth && !clientId) {
      return res.status(503).json({
        error: 'Sign-in is required but GOOGLE_OAUTH_CLIENT_ID is not configured.',
      });
    }

    if (!requireAuth && !clientId) {
      return next();
    }

    const auth = req.headers.authorization || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    const idToken = m ? m[1]?.trim() : '';

    if (requireAuth && !idToken) {
      return res.status(401).json({ error: 'Sign in with Google is required for this deployment.' });
    }

    if (!idToken) {
      return next();
    }

    if (!clientId) {
      return next();
    }

    try {
      const { OAuth2Client } = require('google-auth-library');
      const client = new OAuth2Client(clientId);
      const ticket = await client.verifyIdToken({
        idToken,
        audience: clientId,
      });
      req.googleUser = ticket.getPayload();
      return next();
    } catch (e) {
      if (requireAuth) {
        return res.status(401).json({ error: 'Invalid or expired Google sign-in.' });
      }
      return next();
    }
  };
}

module.exports = { createGoogleAuthMiddleware };
