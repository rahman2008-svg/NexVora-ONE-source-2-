// Deploy Studio helpers: status normalisation, config generators and a safe poller.
// Success is only ever reported when the PROVIDER reports it; unknown values stay "unknown".

export const STATES = ["queued", "building", "success", "failed", "canceled", "unknown"];

export function normalizeGithubRun({ status, conclusion }) {
	if (status === "completed") {
		if (conclusion === "success") return "success";
		if (conclusion === "cancelled" || conclusion === "skipped") return "canceled";
		if (["failure", "timed_out", "startup_failure", "action_required", "neutral", "stale"].includes(conclusion)) return "failed";
		return "unknown";
	}
	if (status === "queued" || status === "waiting" || status === "pending" || status === "requested") return "queued";
	if (status === "in_progress") return "building";
	return "unknown";
}
export function normalizeVercel(state) {
	switch (String(state || "").toUpperCase()) {
		case "READY": return "success";
		case "ERROR": return "failed";
		case "CANCELED": return "canceled";
		case "QUEUED": case "INITIALIZING": return "queued";
		case "BUILDING": return "building";
		default: return "unknown";
	}
}
export function normalizeRender(status) {
	switch (String(status || "").toLowerCase()) {
		case "live": return "success";
		case "build_failed": case "update_failed": case "pre_deploy_failed": return "failed";
		case "canceled": case "deactivated": return "canceled";
		case "created": case "queued": return "queued";
		case "build_in_progress": case "update_in_progress": case "pre_deploy_in_progress": return "building";
		default: return "unknown";
	}
}
export const isTerminal = (s) => s === "success" || s === "failed" || s === "canceled";

/** Polls `fetchState()` -> normalized state until terminal, timeout or abort. Never fabricates success. */
export async function pollUntilDone(fetchState, { intervalMs = 5000, timeoutMs = 15 * 60_000, sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)), signal, now = Date.now, onUpdate } = {}) {
	const deadline = now() + timeoutMs;
	for (;;) {
		if (signal?.aborted) return { state: "unknown", reason: "stopped" };
		const state = await fetchState();
		onUpdate?.(state);
		if (isTerminal(state)) return { state };
		if (now() >= deadline) return { state: "unknown", reason: "timeout" };
		await sleepFn(intervalMs);
	}
}

const safeBranch = (b) => { if (!/^[\w][\w./-]{0,100}$/.test(b || "")) throw new Error("Invalid branch name"); return b; };
const safeDir = (d) => { if (!/^[\w][\w./-]*$/.test(d || "") || d.includes("..")) throw new Error("Invalid directory"); return d; };

/** GitHub Pages deployment workflow for a static folder (uses the repo owner's own Pages settings). */
export function githubPagesWorkflow({ branch = "main", publishDir = "." } = {}) {
	return `name: Deploy to GitHub Pages
on:
  push:
    branches: [${safeBranch(branch)}]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ${safeDir(publishDir)}
      - id: deployment
        uses: actions/deploy-pages@v4
`;
}
export function renderYaml({ name, publishDir = ".", buildCommand = "" }) {
	if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(name || "")) throw new Error("Service name: lowercase letters, digits and dashes");
	return `services:
  - type: web
    name: ${name}
    runtime: static
    buildCommand: ${JSON.stringify(buildCommand || "echo no build step")}
    staticPublishPath: ${safeDir(publishDir)}
`;
}
export function vercelJson({ outputDirectory = ".", buildCommand = null } = {}) {
	return `${JSON.stringify({ $schema: "https://openapi.vercel.sh/vercel.json", buildCommand, outputDirectory: safeDir(outputDirectory), cleanUrls: true }, null, 2)}\n`;
}
export function androidBuildWorkflow({ branch = "main" } = {}) {
	return `name: Android debug APK
on:
  push:
    branches: [${safeBranch(branch)}]
  workflow_dispatch:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17
      - uses: android-actions/setup-android@v3
      - uses: gradle/actions/setup-gradle@v4
      - run: gradle --no-daemon assembleDebug
      - uses: actions/upload-artifact@v4
        with:
          name: app-debug
          path: app/build/outputs/apk/debug/*.apk
`;
}
