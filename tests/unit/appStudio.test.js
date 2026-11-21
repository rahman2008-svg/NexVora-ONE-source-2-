import assert from "node:assert/strict";
import { describe, test } from "vitest";
import * as a from "../../src/lib/appstudio/android.js";

const gen = (o = {}) => a.generateAndroidProject({ appName: "My App", packageName: "com.example.myapp", ...o });
describe("android project generator", () => {
	test("kotlin and java projects contain all required files with consistent package names", () => {
		for (const language of ["kotlin", "java"]) {
			const f = gen({ language }); const ext = language === "kotlin" ? "kt" : "java";
			for (const need of ["settings.gradle.kts", "build.gradle.kts", "app/build.gradle.kts", "app/src/main/AndroidManifest.xml", `app/src/main/java/com/example/myapp/MainActivity.${ext}`, ".github/workflows/android-build.yml", ".gitignore"]) assert.ok(need in f, `${language}: ${need}`);
			assert.match(f[`app/src/main/java/com/example/myapp/MainActivity.${ext}`], /package com\.example\.myapp/);
			assert.deepEqual(a.readGradleValues(f["app/build.gradle.kts"]), { applicationId: "com.example.myapp", versionName: "1.0.0", versionCode: "1", minSdk: "24", targetSdk: "35", compileSdk: "35", namespace: "com.example.myapp" });
			assert.equal(f["app/build.gradle.kts"].includes("kotlin.android"), language === "kotlin");
		}
	});
	test("every generated XML file is well-formed and the manifest passes Android checks", () => {
		const f = gen({ appName: "Tom & <Jerry>".replace(/[<>&]/g, "") + " Bangla বাংলা" });
		for (const [p, c] of Object.entries(f)) if (p.endsWith(".xml")) assert.deepEqual(a.checkXml(c), { ok: true }, p);
		assert.deepEqual(a.validateManifest(f["app/src/main/AndroidManifest.xml"]), []);
	});
	test("validation of names and SDKs", () => {
		for (const bad of ["", "app", "Com.Example.App", "com.example", "com.class.app", "com.1abc.app", "com.example.my-app", "com..x"]) if (bad !== "com.example") assert.throws(() => a.validatePackageName(bad), bad);
		assert.equal(a.validatePackageName("com.example"), "com.example");
		for (const bad of ["", "x".repeat(41), "a<b", 'a"b', "a&b"]) assert.throws(() => a.validateAppName(bad), bad);
		assert.throws(() => gen({ language: "swift" })); assert.throws(() => gen({ minSdk: 10 })); assert.throws(() => gen({ minSdk: 40, compileSdk: 35 }));
		assert.throws(() => gen({ appName: "Tom's" }), /App name/); // apostrophes rejected (would need escaping in strings.xml)
	});
});
describe("xml and manifest validation", () => {
	test("detects malformed XML precisely", () => {
		for (const [xml, re] of [["<a><b></a>", /Mismatched/], ["<a>", /Unclosed/], ["<a x=1/>", /Malformed attribute/], ["", /No root/], ["<a/><b/>", /More than one root/], ["<a><!-- x </a>", /Unterminated comment/], ["<a b=\"c></a>", /Unterminated tag/], ["<a/>junk", /Text after/]]) assert.match(a.checkXml(xml).error, re, xml);
		assert.equal(a.checkXml('<?xml version="1.0"?><a x="1" y=\'2\'><b/><![CDATA[<<>>]]></a>').ok, true);
		assert.match(a.checkXml("<a>\n<b>\n</a>").error, /line 3/);
	});
	test("manifest problems are reported", () => {
		const base = gen()["app/src/main/AndroidManifest.xml"];
		assert.match(a.validateManifest(base.replace('android:exported="true"', "")).join(), /android:exported/);
		assert.match(a.validateManifest(base.replace(/<intent-filter>[\s\S]*<\/intent-filter>/, "")).join(), /No launcher activity/);
		assert.match(a.validateManifest("<manifest></manifest>").join(), /Missing <application>/);
		assert.match(a.validateManifest("<resources/>").join(), /Root element must be <manifest>/);
		assert.match(a.validateManifest("<manifest><application></manifest>").join(), /Mismatched|Unclosed/);
	});
});
describe("gradle editing and structure", () => {
	test("read/set values with validation; no-ops don't corrupt other content", () => {
		const g = gen()["app/build.gradle.kts"];
		const v2 = a.setGradleValue(a.setGradleValue(g, "versionName", "2.1.0"), "versionCode", "7");
		assert.deepEqual([a.readGradleValues(v2).versionName, a.readGradleValues(v2).versionCode], ["2.1.0", "7"]); assert.equal(v2.replace('"2.1.0"', '"1.0.0"').replace("= 7", "= 1"), g);
		assert.throws(() => a.setGradleValue(g, "versionCode", "x1")); assert.throws(() => a.setGradleValue(g, "versionName", 'a"b')); assert.throws(() => a.setGradleValue(g, "applicationId", "Bad.Id")); assert.throws(() => a.setGradleValue(g, "nope", "1")); assert.throws(() => a.setGradleValue("plugins {}", "minSdk", "21"), /not present/);
		assert.equal(a.readGradleValues("nothing here").versionName, undefined);
	});
	test("structure viewer groups manifest, gradle, sources and resources", () => {
		const s = a.describeStructure(Object.keys(gen()));
		assert.equal(s.manifest, "app/src/main/AndroidManifest.xml"); assert.deepEqual(s.gradle.sort(), ["app/build.gradle.kts", "build.gradle.kts", "settings.gradle.kts"]); assert.equal(s.sources.length, 1); assert.deepEqual(Object.keys(s.resources).sort(), ["layout", "values"]);
	});
});
