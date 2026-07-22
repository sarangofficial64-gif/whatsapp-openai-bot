import { google } from 'googleapis';
import { config } from './config.js';
import { getGoogleRefreshToken, setGoogleRefreshToken } from './store.js';

// Least-privilege scope: the bot can only see/manage files IT creates
// (uploads) — not your whole Drive. Good enough for save-and-retrieve.
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

function client(redirectUri) {
  return new google.auth.OAuth2(config.googleClientId, config.googleClientSecret, redirectUri);
}

export function isGoogleConfigured() {
  return Boolean(config.googleClientId && config.googleClientSecret);
}

/** Build the Google consent URL the user opens to authorize the bot. */
export function getAuthUrl(redirectUri) {
  return client(redirectUri).generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

/** Exchange the ?code=... Google sends back for tokens, and persist the refresh token. */
export async function handleOAuthCallback(code, redirectUri) {
  const c = client(redirectUri);
  const { tokens } = await c.getToken(code);
  if (tokens.refresh_token) {
    await setGoogleRefreshToken(tokens.refresh_token);
  }
  return tokens;
}

/** Get an authorized OAuth2 client for Drive API calls, or throw a friendly error. */
export async function getAuthorizedClient() {
  const refreshToken = await getGoogleRefreshToken();
  if (!refreshToken) {
    throw new Error("Google Drive isn't connected yet. Send /driveauth to connect it.");
  }
  const c = client();
  c.setCredentials({ refresh_token: refreshToken });
  return c;
}
