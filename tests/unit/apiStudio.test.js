import assert from "node:assert/strict";
import http from "node:http";
import { afterAll, beforeAll, describe, test } from "vitest";
import * as api from "../../src/lib/apiStudio/request.js";

let server;
let base;
beforeAll(async () => {
	server = http.createServer((req, res) => {
		let body = "";
		req.on("data", (c) => (body += c));
		req.on("end", () => {
			if (req.url.startsWith("/slow")) return setTimeout(() => res.end("late"), 1500);
			if (req.url.startsWith("/404")) { res.statusCode = 404; return res.end("nope"); }
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ method: req.method, url: req.url, auth: req.headers.authorization || null, ct: req.headers["content-type"] || null, body }));
		});
	});
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());

describe("api studio", () => {
	test("all methods hit a real server", async () => {
		for (const m of api.METHODS) {
			const r = await api.sendRequest({ method: m, url: `${base}/x`, body: m === "GET" ? "" : '{"a":1}' });
			assert.equal(r.status, 200);
			assert.equal(JSON.parse(r.body).method, m);
		}
	});
	test("params, headers, bearer and basic auth with unicode", async () => {
		const r = await api.sendRequest({ url: `${base}/p`, params: "q=বাংলা\nn=1", headers: "X-Test: 1", auth: { type: "bearer", token: "tok123" } });
		const j = JSON.parse(r.body);
		assert.match(j.url, /q=%E0%A6%AC/);
		assert.equal(j.auth, "Bearer tok123");
		const b = await api.sendRequest({ url: `${base}/p`, auth: { type: "basic", username: "ইউজার", password: "pw" } });
		assert.equal(Buffer.from(JSON.parse(b.body).auth.split(" ")[1], "base64").toString("utf8"), "ইউজার:pw");
	});
	test("JSON body sets content-type; invalid JSON with json header is rejected", async () => {
		const r = await api.sendRequest({ method: "POST", url: `${base}/j`, body: '{"k":"v"}' });
		assert.equal(JSON.parse(r.body).ct, "application/json");
		assert.throws(() => api.buildRequest({ method: "POST", url: `${base}/j`, headers: "Content-Type: application/json", body: "{bad" }), /not valid JSON/);
	});
	test("HTTP error status is a result, not an exception", async () => {
		const r = await api.sendRequest({ url: `${base}/404` });
		assert.equal(r.status, 404);
		assert.equal(r.ok, false);
	});
	test("timeout and connection refused give readable errors", async () => {
		await assert.rejects(api.sendRequest({ url: `${base}/slow` }, { timeoutMs: 200 }), /timed out/);
		await assert.rejects(api.sendRequest({ url: "http://127.0.0.1:1/" }), /Network error/);
	});
	test("URL validation", () => {
		for (const bad of ["", "   ", "not a url", "ftp://x.com", "file:///etc/passwd", "javascript:alert(1)"]) assert.throws(() => api.validateUrl(bad));
		assert.equal(api.validateUrl("https://a.com/x").hostname, "a.com");
	});
	test("bad header/param lines and empty tokens fail clearly", () => {
		assert.throws(() => api.parseKeyValueLines("novalue"), /Invalid line/);
		assert.throws(() => api.buildRequest({ url: "https://a.com", auth: { type: "bearer", token: "" } }), /empty/);
		assert.throws(() => api.buildRequest({ url: "https://a.com", method: "TRACE" }), /Unsupported/);
	});
	test("secrets are redacted from results and never persisted", async () => {
		const r = await api.sendRequest({ url: `${base}/s`, auth: { type: "bearer", token: "SECRET-TOKEN" } });
		assert.equal(JSON.stringify(r.request).includes("SECRET-TOKEN"), false);
		const mem = new Map();
		const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
		const store = api.createStore(storage);
		store.addHistory({ request: r.request, status: r.status });
		store.saveRequest("one", { url: base, auth: { type: "bearer", token: "SECRET-TOKEN" } });
		assert.equal([...mem.values()].join("").includes("SECRET-TOKEN"), false);
		// "restart": a new store over the same storage sees the data
		assert.equal(api.createStore(storage).list().saved[0].name, "one");
		assert.equal(api.createStore(storage).list().history.length, 1);
	});
	test("large response and corrupted storage", async () => {
		const big = http.createServer((_, res) => res.end("x".repeat(2_000_000)));
		await new Promise((r) => big.listen(0, "127.0.0.1", r));
		const r = await api.sendRequest({ url: `http://127.0.0.1:${big.address().port}/` });
		assert.equal(r.sizeBytes, 2_000_000);
		big.close();
		assert.deepEqual(api.createStore({ getItem: () => "{broken", setItem() {} }).list(), { history: [], saved: [] });
	});
});
