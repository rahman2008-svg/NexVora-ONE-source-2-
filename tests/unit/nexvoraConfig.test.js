import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "vitest";

const require = createRequire(import.meta.url);
const { APP_ID, configureProject } = require("../../utils/config.js");

function tmpProject() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "nexvora-config-"));
	fs.mkdirSync(path.join(root, "res/android/values"), { recursive: true });
	fs.writeFileSync(path.join(root, ".babelrc"), JSON.stringify({ compact: false }));
	return root;
}

test("application id is com.nexvora.one", () => {
	assert.equal(APP_ID, "com.nexvora.one");
});

test("production mode enables compact babel and writes NexVora colours", () => {
	const root = tmpProject();
	configureProject({ mode: "p", rootDir: root });
	assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".babelrc"), "utf8")).compact, true);
	const xml = fs.readFileSync(path.join(root, "res/android/values/ic_launcher_background.xml"), "utf8");
	assert.match(xml, /#050714/);
	fs.rmSync(root, { recursive: true, force: true });
});

test("shipped config.xml uses the NexVora identity and no ad/IAP plugins", () => {
	const cfg = fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../config.xml"), "utf8");
	assert.match(cfg, /id="com\.nexvora\.one"/);
	assert.match(cfg, /<name>NexVora ONE<\/name>/);
	const pkg = fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../package.json"), "utf8");
	assert.doesNotMatch(pkg, /admob|cordova-plugin-iap/i);
});
