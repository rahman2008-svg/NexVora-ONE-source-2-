// NexVora ONE API Studio - request building, validation, execution and formatting.
// No secrets are ever written to history: sensitive headers are redacted.

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const SENSITIVE = /^(authorization|proxy-authorization|x-api-key|api-key|cookie|set-cookie|x-auth-token)$/i;

/** Parses "Key: value" lines (blank lines and # comments ignored). */
export function parseKeyValueLines(text, sep = ":") {
	const out = [];
	for (const raw of String(text || "").split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const i = line.indexOf(sep);
		if (i <= 0) throw new Error(`Invalid line "${line}" - expected key${sep} value`);
		out.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
	}
	return out;
}

/** Only http(s) URLs are allowed. Returns a URL object. */
export function validateUrl(input) {
	const s = String(input || "").trim();
	if (!s) throw new Error("URL is required");
	let u;
	try {
		u = new URL(s);
	} catch {
		throw new Error("Invalid URL");
	}
	if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http and https URLs are allowed");
	return u;
}

export function utf8ToBase64(text) {
	let bin = "";
	for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
	return btoa(bin);
}

/**
 * @param {{method?:string,url:string,params?:string,headers?:string,body?:string,
 *          auth?:{type:"none"|"bearer"|"basic",token?:string,username?:string,password?:string}}} spec
 * @returns {{method:string,url:string,headers:Record<string,string>,body:string|undefined}}
 */
export function buildRequest(spec) {
	const method = (spec.method || "GET").toUpperCase();
	if (!METHODS.includes(method)) throw new Error(`Unsupported method ${method}`);
	const u = validateUrl(spec.url);
	for (const [k, v] of parseKeyValueLines(spec.params, "=")) u.searchParams.append(k, v);
	const headers = {};
	for (const [k, v] of parseKeyValueLines(spec.headers)) headers[k] = v;
	const auth = spec.auth || { type: "none" };
	if (auth.type === "bearer") {
		if (!auth.token) throw new Error("Bearer token is empty");
		headers.Authorization = `Bearer ${auth.token}`;
	} else if (auth.type === "basic") {
		if (!auth.username) throw new Error("Basic auth username is empty");
		headers.Authorization = `Basic ${utf8ToBase64(`${auth.username}:${auth.password || ""}`)}`;
	}
	let body;
	if (spec.body && method !== "GET") {
		body = spec.body;
		const hasCT = Object.keys(headers).some((h) => h.toLowerCase() === "content-type");
		if (!hasCT) {
			try {
				JSON.parse(body);
				headers["Content-Type"] = "application/json";
			} catch {
				headers["Content-Type"] = "text/plain; charset=utf-8";
			}
		} else if (/json/i.test(Object.entries(headers).find(([h]) => h.toLowerCase() === "content-type")[1])) {
			try {
				JSON.parse(body);
			} catch (e) {
				throw new Error(`Request body is not valid JSON: ${e.message}`);
			}
		}
	}
	return { method, url: u.toString(), headers, body };
}

export function redactHeaders(headers) {
	const out = {};
	for (const [k, v] of Object.entries(headers || {})) out[k] = SENSITIVE.test(k) ? "[redacted]" : v;
	return out;
}

/** Safe-to-persist copy of a built request (no tokens). */
export function redactRequest(req) {
	return { method: req.method, url: req.url, headers: redactHeaders(req.headers), body: req.body };
}

export function formatBody(text, contentType = "") {
	if (/json/i.test(contentType) || /^\s*[[{]/.test(text)) {
		try {
			return JSON.stringify(JSON.parse(text), null, 2);
		} catch {
			/* not JSON - fall through */
		}
	}
	return text;
}

/**
 * Default transport: fetch with timeout. The app swaps in a Cordova HTTP transport (no CORS).
 * @returns {Promise<{status:number,headers:Record<string,string>,body:string}>}
 */
export async function fetchTransport(req, timeoutMs, fetchImpl = fetch) {
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), timeoutMs);
	try {
		const res = await fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body, signal: ctl.signal });
		const headers = {};
		res.headers.forEach((v, k) => {
			headers[k] = v;
		});
		return { status: res.status, headers, body: await res.text() };
	} catch (e) {
		if (e?.name === "AbortError") throw new Error(`Request timed out after ${timeoutMs / 1000}s`);
		throw new Error(`Network error: ${e?.cause?.code || e?.message || e}`);
	} finally {
		clearTimeout(timer);
	}
}

/** Cordova advanced-http transport (bypasses WebView CORS). */
export function cordovaTransport(http) {
	return (req, timeoutMs) =>
		new Promise((resolve, reject) => {
			http.sendRequest(
				req.url,
				{ method: req.method.toLowerCase(), headers: req.headers, data: req.body, serializer: "utf8", responseType: "text", timeout: timeoutMs / 1000 },
				(r) => resolve({ status: r.status, headers: r.headers || {}, body: r.data ?? "" }),
				(e) => {
					if (e?.status > 0) resolve({ status: e.status, headers: e.headers || {}, body: e.error ?? "" });
					else reject(new Error(`Network error: ${e?.error || "request failed"}`));
				},
			);
		});
}

/** Runs a spec and returns a display-ready result. Never throws for HTTP error statuses. */
export async function sendRequest(spec, { transport = fetchTransport, timeoutMs = 30000, now = () => Date.now() } = {}) {
	const req = buildRequest(spec);
	const t0 = now();
	const res = await transport(req, timeoutMs);
	const ct = Object.entries(res.headers).find(([k]) => k.toLowerCase() === "content-type")?.[1] || "";
	return {
		request: redactRequest(req),
		status: res.status,
		ok: res.status >= 200 && res.status < 300,
		timeMs: now() - t0,
		headers: res.headers,
		body: formatBody(res.body, ct),
		sizeBytes: new TextEncoder().encode(res.body).length,
	};
}

/** Persistent history/collections on any Storage-like object. */
export function createStore(storage, key = "nexvora.api") {
	const read = () => {
		try {
			return JSON.parse(storage.getItem(key)) || { history: [], saved: [] };
		} catch {
			return { history: [], saved: [] };
		}
	};
	const write = (v) => storage.setItem(key, JSON.stringify(v));
	return {
		addHistory(entry) {
			const s = read();
			s.history = [{ ...entry, at: new Date().toISOString() }, ...s.history].slice(0, 50);
			write(s);
		},
		saveRequest(name, spec) {
			const s = read();
			const { auth, ...rest } = spec; // never persist credentials
			s.saved = [{ name, spec: { ...rest, auth: { type: auth?.type || "none" } } }, ...s.saved.filter((x) => x.name !== name)];
			write(s);
		},
		list: read,
		clearHistory() {
			const s = read();
			s.history = [];
			write(s);
		},
	};
}
