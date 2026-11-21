// NexVora ONE AI Studio - OpenAI-compatible client for LOCAL inference servers
// (llama.cpp `llama-server`, Ollama /v1, LM Studio, vLLM...). No cloud service is required or assumed.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "10.0.2.2", "[::1]"]);

/** Normalises and validates an endpoint base URL. Cleartext http is allowed only for this device/emulator host. */
export function validateEndpoint(input) {
	const s = String(input || "").trim().replace(/\/+$/, "").replace(/\/v1$/, "");
	if (!s) throw new Error("Endpoint URL is required");
	let u;
	try { u = new URL(s); } catch { throw new Error("Invalid endpoint URL"); }
	if (u.protocol === "https:") return u.origin + u.pathname.replace(/\/$/, "");
	if (u.protocol === "http:") {
		if (!LOCAL_HOSTS.has(u.hostname)) throw new Error("Plain http is only allowed for localhost / 127.0.0.1 / 10.0.2.2. Use https for remote servers.");
		return u.origin + u.pathname.replace(/\/$/, "");
	}
	throw new Error("Only http(s) endpoints are supported");
}

const headersFor = (cfg) => ({ "Content-Type": "application/json", ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) });
const scrubKey = (text, cfg) => (cfg.apiKey ? String(text).split(cfg.apiKey).join("[redacted]") : String(text));

async function request(cfg, path, init, fetchImpl, timeoutMs) {
	const base = validateEndpoint(cfg.baseUrl);
	if (cfg.signal?.aborted) throw new Error("Stopped");
	const ctl = new AbortController();
	const timer = timeoutMs ? setTimeout(() => ctl.abort(), timeoutMs) : null;
	cfg.signal?.addEventListener?.("abort", () => ctl.abort());
	try {
		const res = await fetchImpl(`${base}${path}`, { ...init, headers: headersFor(cfg), signal: ctl.signal });
		if (!res.ok) {
			let detail = "";
			try { const j = JSON.parse(await res.text()); detail = j?.error?.message || j?.error || j?.message || ""; } catch { /* ignore */ }
			throw new Error(scrubKey(`Server returned ${res.status}${detail ? `: ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`, cfg));
		}
		return res;
	} catch (e) {
		if (e.name === "AbortError") throw new Error(cfg.signal?.aborted ? "Stopped" : `Server did not respond within ${timeoutMs / 1000}s`);
		if (e instanceof TypeError) throw new Error(`Cannot reach the AI server at ${base}. Is it running?`);
		throw e;
	} finally { if (timer) clearTimeout(timer); }
}

/** @returns {Promise<{ok:boolean, models:string[], message:string}>} */
export async function checkServer(cfg, fetchImpl = fetch) {
	try {
		const res = await request(cfg, "/v1/models", { method: "GET" }, fetchImpl, 8000);
		const j = await res.json();
		const models = (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean);
		return { ok: true, models, message: models.length ? `Connected - ${models.length} model(s)` : "Connected, but the server reports no loaded model" };
	} catch (e) { return { ok: false, models: [], message: e.message }; }
}

/** Incremental Server-Sent-Events parser; safe for chunks split mid-line or mid-UTF-8 character. */
export function createSseParser(onData) {
	const dec = new TextDecoder("utf-8");
	let buf = "";
	return {
		push(bytes) {
			buf += typeof bytes === "string" ? bytes : dec.decode(bytes, { stream: true });
			let i;
			while ((i = buf.search(/\r?\n/)) >= 0) {
				const line = buf.slice(0, i); buf = buf.slice(buf[i] === "\r" ? i + 2 : i + 1);
				if (line.startsWith("data:")) onData(line.slice(5).trim());
			}
		},
		end() { if (buf.startsWith("data:")) onData(buf.slice(5).trim()); buf = ""; },
	};
}

/** Trims history to the most recent `maxTurns` user/assistant messages and prepends the system prompt. */
export function buildMessages({ system, history, user, maxTurns = 12 }) {
	const msgs = history.filter((m) => m.role === "user" || m.role === "assistant").slice(-maxTurns * 2);
	return [...(system?.trim() ? [{ role: "system", content: system.trim() }] : []), ...msgs, { role: "user", content: user }];
}

/**
 * Streams a chat completion. onToken(text) is called as text arrives. Resolves with the full text.
 * cfg: { baseUrl, model, apiKey?, temperature?, maxTokens?, signal? }
 */
export async function chatStream(cfg, messages, onToken, fetchImpl = fetch) {
	if (!cfg.model) throw new Error("Choose a model first");
	const body = { model: cfg.model, messages, stream: true, temperature: cfg.temperature ?? 0.7, ...(cfg.maxTokens ? { max_tokens: cfg.maxTokens } : {}) };
	const res = await request(cfg, "/v1/chat/completions", { method: "POST", body: JSON.stringify(body) }, fetchImpl, 0);
	let full = "";
	const parser = createSseParser((d) => {
		if (!d || d === "[DONE]") return;
		let j; try { j = JSON.parse(d); } catch { return; }
		if (j.error) throw new Error(scrubKey(j.error.message || "Server error", cfg));
		const t = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.text ?? "";
		if (t) { full += t; onToken(t); }
	});
	if (!res.body?.getReader) { // non-streaming runtime fallback
		parser.push(await res.text()); parser.end();
		return full;
	}
	const reader = res.body.getReader();
	for (;;) { const { done, value } = await reader.read(); if (done) break; parser.push(value); }
	parser.end();
	return full;
}

// ---- conversations (per-user, local only) ---------------------------------------------------
export function createConversationStore(storage, key = "nexvora.ai.conversations", maxConversations = 50) {
	const read = () => { try { return JSON.parse(storage.getItem(key)) || []; } catch { return []; } };
	const write = (v) => storage.setItem(key, JSON.stringify(v.slice(0, maxConversations)));
	return {
		list: () => read().map(({ id, title, updatedAt }) => ({ id, title, updatedAt })),
		get: (id) => read().find((c) => c.id === id) || null,
		create(title = "New chat") { const c = { id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title, updatedAt: new Date().toISOString(), messages: [] }; write([c, ...read()]); return c; },
		save(c) { const all = read().filter((x) => x.id !== c.id); write([{ ...c, updatedAt: new Date().toISOString() }, ...all]); },
		remove(id) { write(read().filter((c) => c.id !== id)); },
		clear() { write([]); },
	};
}
export function exportConversation(c, format = "markdown") {
	if (format === "json") return JSON.stringify(c, null, 2);
	return `# ${c.title}\n\n${c.messages.map((m) => `**${m.role === "user" ? "You" : "Assistant"}:**\n\n${m.content}`).join("\n\n---\n\n")}\n`;
}

/** Splits assistant text into text/code segments for rendering. */
export function splitCodeBlocks(text) {
	const out = []; const re = /```([\w+-]*)\n([\s\S]*?)(```|$)/g; let last = 0; let m;
	while ((m = re.exec(text))) { if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) }); out.push({ type: "code", lang: m[1], text: m[2].replace(/\n$/, "") }); last = m.index + m[0].length; }
	if (last < text.length) out.push({ type: "text", text: text.slice(last) });
	return out;
}

/** Per-user endpoint profiles; the API key (if any) is kept in the secure backend, never in plain storage. */
export function createEndpointStore({ meta, secure }, key = "nexvora.ai.endpoints") {
	const read = () => { try { return JSON.parse(meta.getItem(key)) || { profiles: [], active: null }; } catch { return { profiles: [], active: null }; } };
	const write = (v) => meta.setItem(key, JSON.stringify(v));
	return {
		list: () => read().profiles,
		active: () => { const s = read(); return s.profiles.find((p) => p.id === s.active) || null; },
		async save(profile, apiKey) {
			const baseUrl = validateEndpoint(profile.baseUrl);
			const id = profile.id || `ep${Date.now().toString(36)}`;
			if (apiKey) await secure.set(`ai-key:${id}`, apiKey);
			const s = read();
			const { apiKey: _drop, ...clean } = profile;
			s.profiles = [...s.profiles.filter((p) => p.id !== id), { temperature: 0.7, system: "", maxTurns: 12, ...clean, id, baseUrl, hasKey: !!apiKey || !!clean.hasKey }];
			s.active = id; write(s); return id;
		},
		async resolve(id) { const p = read().profiles.find((x) => x.id === id); if (!p) return null; return { ...p, apiKey: p.hasKey ? await secure.get(`ai-key:${id}`) : undefined }; },
		setActive(id) { const s = read(); if (!s.profiles.some((p) => p.id === id)) throw new Error("Unknown profile"); s.active = id; write(s); },
		async remove(id) { await secure.remove(`ai-key:${id}`); const s = read(); s.profiles = s.profiles.filter((p) => p.id !== id); if (s.active === id) s.active = s.profiles[0]?.id || null; write(s); },
	};
}
