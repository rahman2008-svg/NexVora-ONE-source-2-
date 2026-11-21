import assert from "node:assert/strict";
import http from "node:http";
import { afterAll, beforeAll, describe, test } from "vitest";
import { fetchTransport } from "../../src/lib/apiStudio/request.js";
import { createCredentialStore, createMemoryBackend } from "../../src/lib/integrations/credentialStore.js";
import { buildAuthUrl, codeChallengeS256, generateCodeVerifier, generateState, parseRedirect } from "../../src/lib/integrations/pkce.js";
import { createAccountManager } from "../../src/lib/integrations/registry.js";

let server, base, polls = 0;
const send = (res, code, obj, headers = {}) => { res.writeHead(code, { "content-type": "application/json", ...headers }); res.end(obj === undefined ? "" : JSON.stringify(obj)); };
beforeAll(async () => {
	server = http.createServer((req, res) => {
		let body = ""; req.on("data", (c) => (body += c));
		req.on("end", () => {
			const auth = req.headers.authorization || req.headers["private-token"] || "";
			const u = req.url;
			if (u === "/github.com/login/device/code") return send(res, 200, { device_code: "DC", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 });
			if (u === "/github.com/login/oauth/access_token") {
				polls++;
				if (polls === 1) return send(res, 200, { error: "authorization_pending" });
				if (polls === 2) return send(res, 200, { error: "slow_down" });
				return send(res, 200, { access_token: "gho_DEVICE_TOKEN", scope: "public_repo", token_type: "bearer" });
			}
			if (u.startsWith("/api.github.com")) {
				if ((!auth.includes("gho_") && !auth.includes("ghp_")) || auth.includes("BAD")) return send(res, 401, { message: "Bad credentials ghp_BAD" });
				if (u === "/api.github.com/user") return send(res, 200, { id: 42, login: "alice", name: "Alice", email: null, avatar_url: "a" }, { "x-oauth-scopes": "public_repo, workflow" });
				if (u.startsWith("/api.github.com/user/repos?per_page=100")) return send(res, 200, [{ id: 1, full_name: "alice/one", private: false, clone_url: "c1", ssh_url: "s1", default_branch: "main", permissions: { push: true } }], { link: `<${base}/api.github.com/page2>; rel="next"` });
				if (u === "/api.github.com/page2") return send(res, 200, [{ id: 2, full_name: "alice/two", private: true, clone_url: "c2", ssh_url: "s2", default_branch: "dev" }]);
				if (u === "/api.github.com/repos/alice/one/readme") return send(res, 200, { content: Buffer.from("# হ্যালো").toString("base64") });
				if (u === "/api.github.com/user/repos" && req.method === "POST") return send(res, 201, { full_name: `alice/${JSON.parse(body).name}`, clone_url: "cx", private: true });
				if (u.startsWith("/api.github.com/repos/alice/one/actions/runs?")) return send(res, 200, { workflow_runs: [{ id: 9, name: "Build", status: "completed", conclusion: "failure", head_branch: "main", html_url: "u", created_at: "t" }] });
				if (u === "/api.github.com/repos/alice/one/actions/runs/9/jobs") return send(res, 200, { jobs: [{ id: 1, name: "Build APKs", status: "completed", conclusion: "failure", steps: [{ name: "Build debug APK", status: "completed", conclusion: "failure" }] }] });
				if (u === "/api.github.com/repos/alice/one/actions/workflows/android-build.yml/dispatches") return send(res, 204);
			}
			if (u === "/gitlab.com/api/v4/user") return auth === "glpat-OK" ? send(res, 200, { id: 7, username: "bob", name: "Bob" }) : send(res, 401, { message: "401 Unauthorized" });
			if (u.startsWith("/gitlab.com/api/v4/projects")) return send(res, 200, [{ id: 5, path_with_namespace: "bob/p", visibility: "private", http_url_to_repo: "h", ssh_url_to_repo: "s", default_branch: "main" }]);
			if (u === "/api.bitbucket.org/2.0/user") return Buffer.from(auth.split(" ")[1] || "", "base64").toString() === "carol:apppw" ? send(res, 200, { account_id: "acc1", username: "carol", display_name: "Carol" }) : send(res, 401, { error: { message: "bad" } });
			if (u.startsWith("/api.bitbucket.org/2.0/repositories")) return send(res, 200, { values: [{ uuid: "{r}", full_name: "carol/r", is_private: true, links: { clone: [{ name: "https", href: "hh" }, { name: "ssh", href: "ss" }] }, mainbranch: { name: "main" } }] });
			if (u === "/api.vercel.com/v2/user") return auth === "Bearer vtok" ? send(res, 200, { user: { id: "u1", username: "dave", name: "Dave", email: "d@x" } }) : send(res, 403, { error: { message: "Not authorized" } });
			if (u.startsWith("/api.vercel.com/v9/projects")) return send(res, 200, { projects: [{ id: "prj1", name: "site", framework: "nextjs" }] });
			if (u.startsWith("/api.vercel.com/v6/deployments")) return send(res, 200, { deployments: [{ uid: "d1", url: "site.vercel.app", state: "READY", created: 1 }] });
			if (u.startsWith("/api.vercel.com/v13/deployments")) return send(res, 200, { id: "d2", url: "site-2.vercel.app", readyState: "QUEUED" });
			if (u.startsWith("/api.render.com/v1/owners")) return auth === "Bearer rtok" ? send(res, 200, [{ owner: { id: "own1", name: "Eve", email: "e@x" } }]) : send(res, 401, { message: "Unauthorized" });
			if (u.startsWith("/api.render.com/v1/services/srv1/deploys") && req.method === "POST") return send(res, 201, { id: "dep9", status: "created" });
			if (u.startsWith("/api.render.com/v1/services/srv1/deploys")) return send(res, 200, [{ deploy: { id: "dep1", status: "live", createdAt: "t", finishedAt: "t2", commit: { id: "abc" } } }]);
			if (u.startsWith("/api.render.com/v1/services")) return send(res, 200, [{ service: { id: "srv1", name: "api", type: "web_service", serviceDetails: { url: "https://api.onrender.com" } } }]);
			send(res, 404, { message: "not found" });
		});
	});
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());

const transport = (req, t) => fetchTransport({ ...req, url: req.url.replace(/^https:\/\//, `${base}/`) }, t);
const mkStore = () => { const mem = new Map(); const secure = createMemoryBackend(); const meta = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) }; return { store: createCredentialStore({ meta, secure }), mem, secure }; };
const mkMgr = (store, extra = {}) => createAccountManager({ store, transport, sleepFn: async () => {}, ...extra });

describe("PKCE / OAuth state", () => {
	test("RFC 7636 S256 test vector", async () => {
		assert.equal(await codeChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
		const v = generateCodeVerifier(); assert.ok(v.length >= 43 && v.length <= 128 && /^[\w-]+$/.test(v));
		assert.notEqual(generateState(), generateState());
	});
	test("auth URL carries PKCE; redirect validation rejects forged state/URI/errors", async () => {
		const state = generateState();
		const url = await buildAuthUrl({ authorizeUrl: "https://x.example/authorize", clientId: "cid", redirectUri: "nexvoraone://oauth/callback", scope: "a b", state, verifier: generateCodeVerifier() });
		assert.match(url, /code_challenge_method=S256/);
		assert.equal(parseRedirect(`nexvoraone://oauth/callback?code=C&state=${state}`, { redirectUri: "nexvoraone://oauth/callback", expectedState: state }), "C");
		const o = { redirectUri: "nexvoraone://oauth/callback", expectedState: state };
		assert.throws(() => parseRedirect("nexvoraone://oauth/callback?code=C&state=evil", o), /state mismatch/);
		assert.throws(() => parseRedirect("nexvoraone://oauth/callback?code=C", o), /state mismatch/);
		assert.throws(() => parseRedirect(`evil://oauth/callback?code=C&state=${state}`, o), /does not match/);
		assert.throws(() => parseRedirect(`nexvoraone://oauth/callback?error=access_denied&state=${state}`, o), /access_denied/);
		assert.throws(() => parseRedirect(`nexvoraone://oauth/callback?state=${state}`, o), /no authorization code/);
	});
});

describe("accounts", () => {
	test("GitHub device flow: pending, slow_down, then token; identity validated; token only in secure backend", async () => {
		polls = 0; const { store, mem, secure } = mkStore(); const waits = [];
		const m = mkMgr(store, { sleepFn: async (ms) => waits.push(ms) });
		const flow = await m.startDeviceFlow("github", { clientId: "my-own-client-id" });
		assert.equal(flow.userCode, "ABCD-1234");
		const acc = await flow.wait();
		assert.deepEqual(waits, [5000, 5000, 10000]);
		assert.equal(acc.login, "alice"); assert.deepEqual(acc.scopes, ["public_repo", "workflow"]);
		assert.equal([...mem.values()].join("").includes("gho_DEVICE_TOKEN"), false);
		assert.equal(await secure.get("token:github:42"), "gho_DEVICE_TOKEN");
	});
	test("device flow requires user-supplied client id; unsupported providers rejected; denied/expired/cancel", async () => {
		const m = mkMgr(mkStore().store);
		await assert.rejects(m.startDeviceFlow("github", { clientId: "" }), /client ID is required/);
		await assert.rejects(m.startDeviceFlow("vercel", { clientId: "x" }), /use a token/);
	});
	test("token connect validates credentials for every provider; bad token is rejected and not stored", async () => {
		const { store, secure } = mkStore(); const m = mkMgr(store);
		await assert.rejects(m.connectWithToken("github", { token: "ghp_BAD" }), (e) => e.status === 401 && !e.message.includes("ghp_BAD"));
		assert.equal(store.list().length, 0);
		assert.equal((await m.connectWithToken("github", { token: "ghp_GOOD" })).login, "alice");
		assert.equal((await m.connectWithToken("gitlab", { token: "glpat-OK" })).login, "bob");
		assert.equal((await m.connectWithToken("bitbucket", { token: "apppw", username: "carol" })).login, "carol");
		assert.equal((await m.connectWithToken("vercel", { token: "vtok" })).login, "dave");
		assert.equal((await m.connectWithToken("render", { token: "rtok" })).login, "Eve");
		await assert.rejects(m.connectWithToken("vercel", { token: "nope" }), /Not authorized/);
		await assert.rejects(m.connectWithToken("github", { token: "  " }), /empty/);
		await assert.rejects(m.connectWithToken("bitbucket", { token: "x" }), /username/);
		assert.equal(m.status().filter((s) => s.connected).length, 5);
		assert.equal(await secure.get("token:vercel:u1"), "vtok");
	});
	test("multiple accounts: switch, disconnect falls back, full disconnect clears secret", async () => {
		const { store, secure } = mkStore(); const m = mkMgr(store);
		await m.connectWithToken("github", { token: "ghp_ONE" });
		await store.add({ id: "github:99", provider: "github", login: "second" }, "ghp_TWO");
		assert.equal(store.activeId("github"), "github:99");
		m.switchAccount("github", "github:42"); assert.equal(store.activeId("github"), "github:42");
		assert.throws(() => m.switchAccount("github", "github:nope"), /Unknown/);
		await m.disconnect("github:42"); assert.equal(store.activeId("github"), "github:99");
		assert.equal(await secure.get("token:github:42"), null);
		await m.disconnect("github:99"); assert.equal(await m.adapter("github"), null);
		assert.equal(m.status().find((s) => s.provider === "github").connected, false);
	});
	test("two users/stores are fully isolated", async () => {
		const a = mkStore(), b = mkStore();
		await mkMgr(a.store).connectWithToken("github", { token: "ghp_A" });
		assert.equal(b.store.list().length, 0); assert.equal(await b.secure.get("token:github:42"), null);
	});
	test("persistence flag reflects backend (memory backend is not persistent)", () => assert.equal(mkStore().store.persistent, false));
});

describe("provider operations", () => {
	test("GitHub: repo pagination, readme (unicode), create, runs, jobs, dispatch, git creds", async () => {
		const m = mkMgr(mkStore().store); await m.connectWithToken("github", { token: "ghp_GOOD" });
		const gh = await m.adapter("github");
		const repos = await gh.listRepos(); assert.deepEqual(repos.map((r) => r.fullName), ["alice/one", "alice/two"]);
		assert.equal(await gh.getReadme("alice/one"), "# হ্যালো");
		assert.equal((await gh.createRepo({ name: "new-one" })).fullName, "alice/new-one");
		await assert.rejects(gh.createRepo({ name: "bad name!" }), /Invalid repository name/);
		const runs = await gh.listWorkflowRuns("alice/one"); assert.equal(runs[0].conclusion, "failure");
		assert.equal((await gh.listRunJobs("alice/one", 9))[0].steps[0].name, "Build debug APK");
		assert.deepEqual(await gh.dispatchWorkflow("alice/one", "android-build.yml", "main"), { dispatched: true });
		assert.deepEqual(gh.gitCredentials("alice"), { username: "alice", password: "ghp_GOOD" });
	});
	test("GitLab / Bitbucket repo listing", async () => {
		const m = mkMgr(mkStore().store);
		await m.connectWithToken("gitlab", { token: "glpat-OK" }); await m.connectWithToken("bitbucket", { token: "apppw", username: "carol" });
		assert.equal((await (await m.adapter("gitlab")).listRepos())[0].fullName, "bob/p");
		const bb = (await (await m.adapter("bitbucket")).listRepos())[0]; assert.equal(bb.sshUrl, "ss");
	});
	test("Vercel and Render list/trigger using the user's own token", async () => {
		const m = mkMgr(mkStore().store);
		await m.connectWithToken("vercel", { token: "vtok" }); await m.connectWithToken("render", { token: "rtok" });
		const v = await m.adapter("vercel");
		assert.equal((await v.listProjects())[0].name, "site"); assert.equal((await v.listDeployments("prj1"))[0].state, "READY");
		assert.equal((await v.redeploy({ name: "site", deploymentId: "d1" })).state, "QUEUED");
		await assert.rejects(v.redeploy({ name: "site" }), /required/);
		const r = await m.adapter("render");
		assert.equal((await r.listServices())[0].id, "srv1"); assert.equal((await r.listDeploys("srv1"))[0].status, "live");
		assert.equal((await r.triggerDeploy("srv1")).id, "dep9");
	});
	test("network failure surfaces a readable error", async () => {
		const m = createAccountManager({ store: mkStore().store, transport: (req, t) => fetchTransport({ ...req, url: "http://127.0.0.1:1/x" }, t) });
		await assert.rejects(m.connectWithToken("github", { token: "ghp_X" }), /Network error/);
	});
});
