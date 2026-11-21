// Shared JSON HTTP helper for provider adapters. Transport signature matches apiStudio:
// transport({url,method,headers,body}, timeoutMs) -> {status, headers, body:string}
import { fetchTransport } from "lib/apiStudio/request";

export class ProviderError extends Error {
	constructor(message, status = 0) {
		super(message);
		this.name = "ProviderError";
		this.status = status;
	}
}

const scrub = (text, secrets) => secrets.filter(Boolean).reduce((t, s) => t.split(s).join("[redacted]"), String(text));

export async function callJson(transport, { method = "GET", url, headers = {}, body, form, timeoutMs = 20000, secrets = [] }) {
	const h = { Accept: "application/json", ...headers };
	let payload;
	if (form) {
		h["Content-Type"] = "application/x-www-form-urlencoded";
		payload = new URLSearchParams(form).toString();
	} else if (body !== undefined) {
		h["Content-Type"] = "application/json";
		payload = JSON.stringify(body);
	}
	let res;
	try {
		res = await (transport || fetchTransport)({ method, url, headers: h, body: payload }, timeoutMs);
	} catch (e) {
		throw new ProviderError(scrub(e.message, secrets));
	}
	let data = null;
	if (res.body) {
		try {
			data = JSON.parse(res.body);
		} catch {
			data = { raw: res.body };
		}
	}
	if (res.status < 200 || res.status >= 300) {
		const msg = data?.message || data?.error?.message || data?.error_description || data?.error || `HTTP ${res.status}`;
		throw new ProviderError(scrub(typeof msg === "string" ? msg : JSON.stringify(msg), secrets), res.status);
	}
	return { data, headers: res.headers };
}
