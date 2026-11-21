// OAuth 2.0 Device Authorization Grant (RFC 8628) for public clients: no client secret, no redirect.
import { callJson, ProviderError } from "./http.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function requestDeviceCode(transport, { deviceUrl, clientId, scope }) {
	if (!clientId) throw new ProviderError("An OAuth client ID is required (register your own OAuth app; client IDs are not secret).");
	const { data } = await callJson(transport, { method: "POST", url: deviceUrl, form: { client_id: clientId, scope: scope || "" } });
	if (!data?.device_code || !data?.user_code) throw new ProviderError(data?.error_description || data?.error || "Invalid device code response");
	return { deviceCode: data.device_code, userCode: data.user_code, verificationUri: data.verification_uri, expiresIn: data.expires_in || 900, interval: data.interval || 5 };
}

/**
 * Polls until authorised. Honors authorization_pending / slow_down / expired_token / access_denied.
 * @param {{signal?:AbortSignal, sleepFn?:Function, now?:Function}} opts
 */
export async function pollDeviceToken(transport, { tokenUrl, clientId, deviceCode, interval, expiresIn }, { signal, sleepFn = sleep, now = Date.now } = {}) {
	const deadline = now() + expiresIn * 1000;
	let wait = interval * 1000;
	for (;;) {
		if (signal?.aborted) throw new ProviderError("Sign-in cancelled");
		if (now() > deadline) throw new ProviderError("The sign-in code expired. Start again.");
		await sleepFn(wait);
		if (signal?.aborted) throw new ProviderError("Sign-in cancelled");
		const { data } = await callJson(transport, {
			method: "POST",
			url: tokenUrl,
			form: { client_id: clientId, device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" },
		});
		if (data?.access_token) return { accessToken: data.access_token, scope: data.scope || "", tokenType: data.token_type || "bearer" };
		switch (data?.error) {
			case "authorization_pending":
				break;
			case "slow_down":
				wait += 5000;
				break;
			case "expired_token":
				throw new ProviderError("The sign-in code expired. Start again.");
			case "access_denied":
				throw new ProviderError("Sign-in was denied.");
			default:
				throw new ProviderError(data?.error_description || data?.error || "Unexpected token response");
		}
	}
}
