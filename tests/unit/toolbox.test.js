import assert from "node:assert/strict";
import { describe, test } from "vitest";
import * as t from "../../src/lib/toolbox/tools.js";

describe("toolbox", () => {
	test("json format/minify/validate", () => {
		assert.equal(t.jsonFormat('{"a":[1,2]}'), '{\n  "a": [\n    1,\n    2\n  ]\n}');
		assert.equal(t.jsonMinify('{ "a" : 1 }'), '{"a":1}');
		assert.equal(t.jsonValidate("{").valid, false);
		assert.equal(t.jsonValidate("[1]").valid, true);
		assert.throws(() => t.jsonFormat("{bad"));
	});
	test("base64 round-trips unicode and url-safe input", () => {
		const s = "héllo ✓ 日本";
		assert.equal(t.base64Decode(t.base64Encode(s)), s);
		assert.equal(t.base64Encode("hello"), "aGVsbG8=");
		assert.equal(t.base64Decode("aGVsbG8"), "hello");
	});
	test("url encode/decode", () => {
		assert.equal(t.urlEncode("a b&c=d/é"), "a%20b%26c%3Dd%2F%C3%A9");
		assert.equal(t.urlDecode("a%20b%26c"), "a b&c");
	});
	test("regex tester", () => {
		const r = t.regexTest("(\\d+)-(\\w)", "", "12-a 3-b");
		assert.equal(r.length, 2);
		assert.deepEqual(r[1].groups, ["3", "b"]);
		assert.throws(() => t.regexTest("(", "", "x"));
	});
	test("hash known vectors", async () => {
		assert.equal(await t.hash("abc", "SHA-256"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
		assert.equal(await t.hash("abc", "SHA-1"), "a9993e364706816aba3e25717850c26c9cd0d89d");
	});
	test("uuid v4 format and uniqueness", () => {
		const a = t.uuidv4();
		assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		assert.notEqual(a, t.uuidv4());
	});
	test("timestamp converter", () => {
		assert.equal(t.timestampConvert("0").iso, "1970-01-01T00:00:00.000Z");
		assert.equal(t.timestampConvert("1700000000").iso, "2023-11-14T22:13:20.000Z");
		assert.equal(t.timestampConvert("1700000000000").unixSeconds, 1700000000);
		assert.throws(() => t.timestampConvert("not a date"));
	});
	test("text diff", () => {
		assert.equal(t.textDiff("a\nb\nc", "a\nc\nd"), "  a\n- b\n  c\n+ d");
	});
	test("color convert", () => {
		assert.deepEqual(t.colorConvert("#702CFF"), { hex: "#702cff", rgb: "rgb(112, 44, 255)", hsl: "hsl(259, 100%, 59%)" });
		assert.equal(t.colorConvert("#fff").rgb, "rgb(255, 255, 255)");
		assert.throws(() => t.colorConvert("rgb(300,0,0)"));
		assert.throws(() => t.colorConvert("blue"));
	});
	test("registry tools all run", async () => {
		const samples = { regex: "/a/g\nbanana", diff: "x\n===\ny", color: "#000", timestamp: "0", "base64-dec": "aGk=", "url-dec": "a%20b", "json-format": "[1]", "json-minify": "[1]", "json-validate": "[1]", "css-format": "a{b:c}", "sql-format": "select 1" };
		for (const tool of t.TOOLS.filter((x) => !x.runtime)) {
			const out = await tool.run(samples[tool.id] ?? "text");
			assert.equal(typeof out, "string");
		}
	});
	test("empty / invalid / unicode / large inputs fail clearly or work", async () => {
		for (const id of t.TOOLS.map((x) => x.id).filter((x) => x !== "uuid")) {
			const tool = t.TOOLS.find((x) => x.id === id);
			await assert.rejects(t.runTool(tool, "  "), /Enter some input/, `${id} should reject empty input`);
		}
		assert.equal((await t.runTool(t.TOOLS.find((x) => x.id === "uuid"), "")).length, 36);
		await assert.rejects(t.runTool(t.TOOLS[0], "x".repeat(5_000_001)), /too large/);
		const big = "x".repeat(2_000_000);
		assert.equal(t.base64Decode(t.base64Encode(big)).length, big.length);
		assert.equal((await t.hash(big, "SHA-256")).length, 64);
		assert.equal(t.jsonFormat(JSON.stringify({ "নাম": "বাংলা" })).includes("বাংলা"), true);
		assert.throws(() => t.base64Decode("!!!not base64!!!"));
		assert.throws(() => t.urlDecode("%E0%A4%A"));
		assert.throws(() => t.textDiff("a\n".repeat(3000), "b\n".repeat(3000)), /too large/);
	});
});
