import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, test } from "vitest";
import * as ai from "../../src/lib/ai/client.js";
import * as models from "../../src/lib/ai/models.js";
import { createMemoryBackend } from "../../src/lib/integrations/credentialStore.js";

let server, base, gguf;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nx-ai-"));
const env = { ...process.env, HOME: tmp };
const execRaw = (cmd) => new Promise((res) => execFile("/bin/sh", ["-c", cmd], { env }, (_e, so, se) => res(`${so}${se}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastAuth = null;

beforeAll(async () => {
	gguf = Buffer.concat([Buffer.from("GGUF"), Buffer.alloc(2 * 1024 * 1024, 1)]);
	server = http.createServer((req, res) => {
		let body = ""; req.on("data", (c) => (body += c));
		req.on("end", async () => {
			lastAuth = req.headers.authorization || null;
			if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "tiny-model" }] }));
			if (req.url === "/v1/chat/completions") {
				const b = JSON.parse(body);
				if (b.model === "boom") { res.statusCode = 500; return res.end(JSON.stringify({ error: { message: "model failed key-SECRET" } })); }
				res.setHeader("content-type", "text/event-stream");
				const ev = (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;
				const full = `${ev("হ্যালো ")}${ev("world")}data: [DONE]\n\n`;
				const buf = Buffer.from(full);
				// split mid-line AND mid multi-byte character
				res.write(buf.subarray(0, 30)); await sleep(5); res.write(buf.subarray(30, 47)); await sleep(5); res.end(buf.subarray(47));
				return;
			}
			if (req.url === "/model.gguf") return res.end(gguf);
			if (req.url === "/bad.gguf") return res.end(Buffer.alloc(2 * 1024 * 1024, 65));
			res.statusCode = 404; res.end("nf");
		});
	});
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

describe("endpoint validation", () => {
	test("https anywhere, http only for this device/emulator", () => {
		assert.equal(ai.validateEndpoint("https://ai.example.com/v1/"), "https://ai.example.com");
		assert.equal(ai.validateEndpoint("http://localhost:8080/"), "http://localhost:8080");
		assert.equal(ai.validateEndpoint("http://127.0.0.1:8080/v1"), "http://127.0.0.1:8080");
		for (const bad of ["", "nope", "http://192.168.1.5:8080", "http://example.com", "ftp://localhost", "file:///x"]) assert.throws(() => ai.validateEndpoint(bad), bad);
	});
});
describe("client", () => {
	test("health check lists models; unreachable server gives a readable message", async () => {
		const ok = await ai.checkServer({ baseUrl: base }); assert.deepEqual([ok.ok, ok.models], [true, ["tiny-model"]]);
		const bad = await ai.checkServer({ baseUrl: "http://127.0.0.1:1" }); assert.equal(bad.ok, false); assert.match(bad.message, /Cannot reach/);
	});
	test("streaming survives chunks split mid-line and mid-UTF-8; sends bearer only when configured", async () => {
		const tokens = [];
		const full = await ai.chatStream({ baseUrl: base, model: "tiny-model" }, [{ role: "user", content: "hi" }], (t) => tokens.push(t));
		assert.equal(full, "হ্যালো world"); assert.deepEqual(tokens, ["হ্যালো ", "world"]); assert.equal(lastAuth, null);
		await ai.chatStream({ baseUrl: base, model: "tiny-model", apiKey: "key-SECRET" }, [{ role: "user", content: "hi" }], () => {}); assert.equal(lastAuth, "Bearer key-SECRET");
	});
	test("server errors surface with the API key scrubbed; missing model and stop work", async () => {
		await assert.rejects(ai.chatStream({ baseUrl: base, model: "boom", apiKey: "key-SECRET" }, [], () => {}), (e) => /500/.test(e.message) && !e.message.includes("key-SECRET"));
		await assert.rejects(ai.chatStream({ baseUrl: base }, [], () => {}), /Choose a model/);
		const ctl = new AbortController(); ctl.abort();
		await assert.rejects(ai.chatStream({ baseUrl: base, model: "tiny-model", signal: ctl.signal }, [], () => {}), /Stopped/);
	});
	test("SSE parser handles CRLF, trailing data without newline, junk lines", () => {
		const got = []; const p = ai.createSseParser((d) => got.push(d));
		p.push("event: x\r\ndata: a\r\n\r\n: comment\ndata: b"); p.end(); assert.deepEqual(got, ["a", "b"]);
	});
	test("message building trims context and adds the system prompt", () => {
		const history = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: String(i) }));
		const m = ai.buildMessages({ system: " be brief ", history, user: "now", maxTurns: 2 });
		assert.equal(m[0].content, "be brief"); assert.equal(m.length, 1 + 4 + 1); assert.equal(m.at(-1).content, "now");
		assert.equal(ai.buildMessages({ history: [], user: "x" }).length, 1);
	});
	test("code block splitting", () => {
		const parts = ai.splitCodeBlocks("a\n```js\nlet x=1;\n```\nb");
		assert.deepEqual(parts.map((p) => p.type), ["text", "code", "text"]); assert.equal(parts[1].lang, "js"); assert.equal(parts[1].text, "let x=1;");
		assert.equal(ai.splitCodeBlocks("```py\nunclosed")[0].type, "code");
	});
});
describe("conversations and endpoint profiles", () => {
	const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };
	test("history persists, caps, exports (markdown/json), corrupted storage is tolerated", () => {
		const s = mem(); const st = ai.createConversationStore(s, "k", 3);
		const c = st.create("Bangla চ্যাট"); c.messages.push({ role: "user", content: "হ্যালো" }, { role: "assistant", content: "Hi" }); st.save(c);
		assert.equal(ai.createConversationStore(s, "k").get(c.id).messages.length, 2);
		for (let i = 0; i < 5; i++) st.create(`c${i}`); assert.equal(st.list().length, 3);
		assert.match(ai.exportConversation(c, "markdown"), /\*\*You:\*\*\n\nহ্যালো/); assert.equal(JSON.parse(ai.exportConversation(c, "json")).id, c.id);
		st.remove(st.list()[0].id); st.clear(); assert.equal(st.list().length, 0);
		assert.deepEqual(ai.createConversationStore({ getItem: () => "{x", setItem() {} }).list(), []);
	});
	test("endpoint profiles keep the API key out of plain storage; profiles are independent per user", async () => {
		const secure = createMemoryBackend(); const meta = mem();
		const eps = ai.createEndpointStore({ meta, secure });
		const id = await eps.save({ name: "Local", baseUrl: "http://localhost:8080/v1", model: "m" }, "my-secret-key");
		assert.equal([...meta.m.values()].join("").includes("my-secret-key"), false);
		assert.equal((await eps.resolve(id)).apiKey, "my-secret-key"); assert.equal(eps.active().baseUrl, "http://localhost:8080");
		await assert.rejects(eps.save({ name: "bad", baseUrl: "http://192.168.0.2" }), /Plain http/);
		const other = ai.createEndpointStore({ meta: mem(), secure: createMemoryBackend() }); assert.equal(other.list().length, 0);
		await eps.remove(id); assert.equal(await secure.get(`ai-key:${id}`), null);
	});
});
describe("model manager (real shell, real curl, real HTTP download)", () => {
	const mm = models.createModelManager(execRaw);
	test("name/URL validation", () => {
		assert.throws(() => models.validateModelUrl("http://x.com/m.gguf"), /https/); assert.throws(() => models.validateModelUrl("nope"));
		assert.equal(models.fileNameFromUrl("https://h/a/My%20M.gguf"), "My M.gguf");
		assert.equal(models.formatBytes(3 * 2 ** 30), "3.00 GB");
	});
	test("storage/memory info, empty list, bad names rejected (no shell injection)", async () => {
		assert.ok((await mm.storage()).freeBytes > 0); assert.ok((await mm.memory()).totalBytes > 0); assert.deepEqual(await mm.list(), []);
		for (const bad of ["x.txt", "../a.gguf", "a b.gguf", "a;rm -rf x.gguf", ".gguf", "$(id).gguf"]) await assert.rejects(mm.validate(bad), bad);
	});
	test("real download with progress, GGUF validation, list, delete; bad file flagged invalid", async () => {
		// https is required in production; this test drives the same code path against the local server
		// by calling the shell pieces directly with an http URL via curl (validateModelUrl is bypassed on purpose).
		const run = mm.run; const dir = path.join(tmp, "models"); fs.mkdirSync(dir, { recursive: true });
		await run(`cd ${dir} && curl -fsL -o good.gguf ${base}/model.gguf && curl -fsL -o bad.gguf ${base}/bad.gguf`);
		assert.deepEqual(await mm.validate("good.gguf"), { valid: true, sizeBytes: gguf.length });
		assert.equal((await mm.validate("bad.gguf")).valid, false);
		assert.deepEqual((await mm.list()).map((m) => m.name).sort(), ["bad.gguf", "good.gguf"]);
		await mm.remove("bad.gguf"); assert.equal((await mm.list()).length, 1);
		assert.equal(await mm.serverAvailable(), false);
		await assert.rejects(mm.startServer("good.gguf"), /not installed/);
		assert.match(mm.serverCommand("good.gguf", { port: 9090 }), /--host 127\.0\.0\.1 --port 9090/);
	});
	test("startDownload refuses http, refuses when storage is insufficient", async () => {
		await assert.rejects(mm.startDownload(`${base}/model.gguf`), /https/);
		await assert.rejects(mm.startDownload("https://example.com/huge.gguf", "huge.gguf", 2 ** 60), /Not enough storage/);
	});
	test("background download job: progress states for success, failure and cancel", async () => {
		const dir = path.join(tmp, "models");
		// simulate the background job's own protocol (.part -> final + .done exit code) using real curl
		await mm.run(`cd ${dir} && ( sh -c 'curl -fL -o job.gguf.part ${base}/model.gguf && mv job.gguf.part job.gguf; echo $? > job.gguf.done' >/dev/null 2>&1 & )`);
		let p; for (let i = 0; i < 50; i++) { p = await mm.progress("job.gguf", gguf.length); if (p.state !== "downloading") break; await sleep(100); }
		assert.equal(p.state, "complete"); assert.equal(p.percent, 100);
		await mm.run(`cd ${dir} && ( sh -c 'curl -fL -o bad2.gguf.part ${base}/missing.gguf; echo $? > bad2.gguf.done' >/dev/null 2>&1 & )`);
		for (let i = 0; i < 50; i++) { p = await mm.progress("bad2.gguf"); if (p.state !== "downloading") break; await sleep(100); }
		assert.equal(p.state, "failed"); assert.match(p.reason, /curl exit/);
		await mm.cancelDownload("bad2.gguf"); assert.equal((await mm.progress("bad2.gguf")).state, "downloading"); // nothing running, nothing finished
	});
});
