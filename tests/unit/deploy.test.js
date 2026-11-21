import assert from "node:assert/strict";
import { describe, test } from "vitest";
import * as d from "../../src/lib/deploy/deploy.js";

describe("deploy status normalisation (never invents success)", () => {
	test("GitHub runs", () => {
		const t = (status, conclusion) => d.normalizeGithubRun({ status, conclusion });
		assert.equal(t("completed", "success"), "success"); assert.equal(t("completed", "failure"), "failed"); assert.equal(t("completed", "timed_out"), "failed");
		assert.equal(t("completed", "cancelled"), "canceled"); assert.equal(t("in_progress", null), "building"); assert.equal(t("queued", null), "queued");
		assert.equal(t("completed", null), "unknown"); assert.equal(t("weird", null), "unknown"); assert.equal(t(undefined, undefined), "unknown");
	});
	test("Vercel and Render", () => {
		assert.deepEqual(["READY", "ERROR", "CANCELED", "QUEUED", "BUILDING", "ready", "???", null].map(d.normalizeVercel), ["success", "failed", "canceled", "queued", "building", "success", "unknown", "unknown"]);
		assert.deepEqual(["live", "build_failed", "update_failed", "canceled", "created", "build_in_progress", "x", undefined].map(d.normalizeRender), ["success", "failed", "failed", "canceled", "queued", "building", "unknown", "unknown"]);
	});
});
describe("poller", () => {
	test("returns the first terminal state and calls onUpdate", async () => {
		const seq = ["queued", "building", "building", "success"]; const seen = []; let sleeps = 0;
		const r = await d.pollUntilDone(async () => seq.shift(), { sleepFn: async () => { sleeps++; }, onUpdate: (s) => seen.push(s) });
		assert.deepEqual(r, { state: "success" }); assert.deepEqual(seen, ["queued", "building", "building", "success"]); assert.equal(sleeps, 3);
	});
	test("failure state is reported as failure; timeout and abort never become success", async () => {
		assert.deepEqual(await d.pollUntilDone(async () => "failed", { sleepFn: async () => {} }), { state: "failed" });
		let t = 0; const r = await d.pollUntilDone(async () => "building", { timeoutMs: 100, now: () => (t += 60), sleepFn: async () => {} });
		assert.deepEqual(r, { state: "unknown", reason: "timeout" });
		const ctl = new AbortController(); ctl.abort();
		assert.deepEqual(await d.pollUntilDone(async () => "success", { signal: ctl.signal }), { state: "unknown", reason: "stopped" });
	});
	test("provider errors propagate (no silent success)", async () => {
		await assert.rejects(d.pollUntilDone(async () => { throw new Error("401 from provider"); }, { sleepFn: async () => {} }), /401/);
	});
});
describe("config generators", () => {
	test("Pages workflow, render.yaml, vercel.json, Android workflow contain expected keys", () => {
		const w = d.githubPagesWorkflow({ branch: "main", publishDir: "dist" });
		assert.match(w, /actions\/deploy-pages@v4/); assert.match(w, /path: dist/); assert.match(w, /branches: \[main\]/);
		assert.match(d.renderYaml({ name: "my-site", publishDir: "public" }), /staticPublishPath: public/);
		const v = JSON.parse(d.vercelJson({ outputDirectory: "dist" })); assert.equal(v.outputDirectory, "dist");
		assert.match(d.androidBuildWorkflow(), /assembleDebug/);
	});
	test("generators reject injection through names/paths/branches", () => {
		for (const bad of ["main\n  evil: 1", "a b", "", "../x", "x]; run: rm"]) assert.throws(() => d.githubPagesWorkflow({ branch: bad }), bad);
		assert.throws(() => d.githubPagesWorkflow({ publishDir: "../../etc" })); assert.throws(() => d.renderYaml({ name: "Bad Name" })); assert.throws(() => d.vercelJson({ outputDirectory: "/abs" }));
		assert.throws(() => d.androidBuildWorkflow({ branch: "x\ny" }));
	});
});
