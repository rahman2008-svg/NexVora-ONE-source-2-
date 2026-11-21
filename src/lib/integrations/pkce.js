// PKCE (RFC 7636) and OAuth state helpers. No secrets, no storage.
const b64url = (bytes) => {
	let s = "";
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const randomString = (nBytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(nBytes)));
export const generateCodeVerifier = () => randomString(48); // 64 chars, within 43..128
export async function codeChallengeS256(verifier) {
	return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}
export const generateState = () => randomString(24);

/** Builds an Authorization Code + PKCE URL. */
export async function buildAuthUrl({ authorizeUrl, clientId, redirectUri, scope, state, verifier }) {
	const u = new URL(authorizeUrl);
	u.searchParams.set("response_type", "code");
	u.searchParams.set("client_id", clientId);
	u.searchParams.set("redirect_uri", redirectUri);
	if (scope) u.searchParams.set("scope", scope);
	u.searchParams.set("state", state);
	u.searchParams.set("code_challenge", await codeChallengeS256(verifier));
	u.searchParams.set("code_challenge_method", "S256");
	return u.toString();
}

/** Validates a redirect URL: exact redirect base, matching state, and a code (or provider error). */
export function parseRedirect(url, { redirectUri, expectedState }) {
	const u = new URL(url);
	const base = new URL(redirectUri);
	if (u.protocol !== base.protocol || u.host !== base.host || u.pathname !== base.pathname)
		throw new Error("Redirect does not match the registered redirect URI");
	const err = u.searchParams.get("error");
	if (err) throw new Error(`Authorization failed: ${err}`);
	const state = u.searchParams.get("state");
	if (!expectedState || !state || state !== expectedState) throw new Error("OAuth state mismatch - possible forged redirect");
	const code = u.searchParams.get("code");
	if (!code) throw new Error("Redirect contained no authorization code");
	return code;
}
