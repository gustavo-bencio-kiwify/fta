import { google } from "googleapis";

export function getGoogleOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId) throw new Error("Missing GOOGLE_CLIENT_ID");
  if (!clientSecret) throw new Error("Missing GOOGLE_CLIENT_SECRET");
  if (!redirectUri) throw new Error("Missing GOOGLE_REDIRECT_URI");

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}
