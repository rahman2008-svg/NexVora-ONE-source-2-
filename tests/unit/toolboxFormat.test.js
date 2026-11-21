import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { fitSize, formatCss, formatSql, tokenizeSql } from "../../src/lib/toolbox/format.js";

describe("formatCss", () => {
	test("formats rules, nested at-rules, multiple selectors", () => {
		assert.equal(formatCss("a,b{color:red;margin:0 auto}"), "a, b {\n  color: red;\n  margin: 0 auto;\n}");
		assert.equal(formatCss("@media (max-width:600px){.x{display:none}}"), "@media (max-width:600px) {\n  .x {\n    display: none;\n  }\n}");
		assert.equal(formatCss("a{}"), "a {\n}");
	});
	test("preserves strings, url(data:...;...) and comments", () => {
		const out = formatCss('a{background:url(data:image/png;base64,AAA=);content:"a;b{c}"} /* keep; me */ b{x:y}');
		assert.match(out, /url\(data:image\/png;base64,AAA=\)/); assert.match(out, /content: "a;b\{c\}";/); assert.match(out, /\/\* keep; me \*\//);
	});
	test("errors: unbalanced, unterminated string/comment; empty input; Bangla content", () => {
		assert.throws(() => formatCss("a{b:c"), /Unbalanced/); assert.throws(() => formatCss("a}"), /Unbalanced/); assert.throws(() => formatCss('a{b:"x}'), /Unterminated string/); assert.throws(() => formatCss("/* x"), /Unterminated comment/);
		assert.equal(formatCss(""), ""); assert.match(formatCss('a{content:"বাংলা"}'), /content: "বাংলা";/);
	});
	test("idempotent", () => { const once = formatCss("a{b:c;d:e}.x>.y{f:g}"); assert.equal(formatCss(once), once); });
});
describe("formatSql", () => {
	test("SELECT with join, and/or, order, limit", () => {
		assert.equal(formatSql("select a,b from t inner join u on t.id=u.id where x=1 and y=2 or z=3 order by a desc limit 5;"),
			"SELECT a,\n  b\nFROM t\nINNER JOIN u ON t.id = u.id\nWHERE x = 1\n  AND y = 2\n  OR z = 3\nORDER BY a DESC\nLIMIT 5;");
	});
	test("keywords inside strings are untouched; BETWEEN..AND stays on one line; functions; multiple statements", () => {
		const out = formatSql("select name, count(*) as n from users where note = 'select from;' and age between 1 and 5 group by name; insert into t(a,b) values (1,'x')");
		assert.match(out, /note = 'select from;'/); assert.match(out, /age BETWEEN 1 AND 5/); assert.match(out, /count\(\*\) AS n/); assert.match(out, /INSERT INTO t\(a, b\)\nVALUES \(1, 'x'\)/);
		assert.equal(out.split("\n").filter((l) => l.startsWith("SELECT")).length, 1);
	});
	test("comments, update/set lists, quoted identifiers, unicode", () => {
		assert.equal(formatSql("-- c\nupdate t set a=1, b=2 where id=3"), "-- c\nUPDATE t\nSET a = 1,\n  b = 2\nWHERE id = 3");
		assert.match(formatSql('select "my col" from `t` where n = \'বাংলা\''), /"my col"/);
		assert.throws(() => formatSql("select 'oops"), /Unterminated/); assert.throws(() => formatSql("/* x"), /Unterminated/); assert.equal(formatSql("   "), "");
		assert.equal(tokenizeSql("a 'b''c'")[1].v, "'b''c'");
	});
	test("formatting is idempotent for already formatted SQL", () => { const once = formatSql("select a,b from t where x=1 and y=2"); assert.equal(formatSql(once), once); });
});
describe("fitSize", () => {
	test("keeps aspect ratio, never upscales, rejects bad sizes", () => {
		assert.deepEqual(fitSize(4000, 3000, 1000), { width: 1000, height: 750 }); assert.deepEqual(fitSize(500, 400, 1000), { width: 500, height: 400 }); assert.deepEqual(fitSize(100, 100, 0), { width: 100, height: 100 });
		assert.deepEqual(fitSize(10000, 1, 100), { width: 100, height: 1 }); assert.throws(() => fitSize(0, 5, 10)); assert.throws(() => fitSize(NaN, 5, 10));
	});
});
