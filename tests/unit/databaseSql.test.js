import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, test } from "vitest";
import * as db from "../../src/lib/database/sql.js";

// Test engine: real SQLite via Node's built-in node:sqlite (same engine contract as the sql.js app engine).
function nodeEngine(file = ":memory:") {
	const d = new DatabaseSync(file);
	return {
		exec(sql, params = []) {
			const st = d.prepare(sql);
			const columns = st.columns().map((c) => c.name);
			if (columns.length) { st.setReturnArrays?.(true); const rows = st.all(...params).map((r) => (Array.isArray(r) ? r : columns.map((c) => r[c]))); return { columns, rows, changes: 0 }; }
			const r = st.run(...params);
			return { columns: [], rows: [], changes: Number(r.changes) };
		},
		export: () => new Uint8Array(),
		close: () => d.close(),
	};
}
const seeded = () => { const e = nodeEngine(); db.runScript(e, "CREATE TABLE notes(id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT); INSERT INTO notes(title,body) VALUES ('এক','প্রথম'),('two','=cmd|calc'),('3','a;b');"); return e; };

describe("database studio", () => {
	test("statement splitting respects strings, comments and trigger bodies", () => {
		assert.deepEqual(db.splitStatements("SELECT 'a;b'; -- c;d\nSELECT 2; /* x; */ SELECT \"q;\""), ["SELECT 'a;b'", "SELECT 2", 'SELECT "q;"']);
		const trig = "CREATE TRIGGER t AFTER INSERT ON n BEGIN UPDATE n SET a=1; DELETE FROM x WHERE 1; END; SELECT 1";
		assert.equal(db.splitStatements(trig).length, 2);
		assert.deepEqual(db.splitStatements("  ;; "), []);
	});
	test("create/insert/select/update/delete with real SQLite and unicode", () => {
		const e = seeded();
		assert.deepEqual(db.listTables(e), [{ name: "notes", type: "table" }]);
		const t = db.browseTable(e, "notes");
		assert.equal(t.total, 3); assert.equal(t.rows[0][1], "এক");
		db.insertRow(e, "notes", { title: "four", body: null });
		assert.equal(db.browseTable(e, "notes").total, 4);
		db.updateRow(e, "notes", 1, { title: "বদল" });
		assert.equal(e.exec("SELECT title FROM notes WHERE id=1").rows[0][0], "বদল");
		db.deleteRow(e, "notes", 1);
		assert.equal(db.browseTable(e, "notes").total, 3);
		assert.throws(() => db.updateRow(e, "notes", 999, { title: "x" }), /No row/);
		assert.throws(() => db.deleteRow(e, "notes", 999), /No row/);
	});
	test("schema viewer and search (LIKE escaping)", () => {
		const e = seeded();
		const sc = db.tableSchema(e, "notes");
		assert.deepEqual(sc.map((c) => [c.name, c.primaryKey, c.notNull]), [["id", true, false], ["title", false, true], ["body", false, false]]);
		assert.equal(db.browseTable(e, "notes", { search: "two" }).total, 1);
		assert.equal(db.browseTable(e, "notes", { search: "%" }).total, 0);
		assert.equal(db.browseTable(e, "notes", { limit: 1, offset: 2 }).rows.length, 1);
		assert.throws(() => db.browseTable(e, "missing"), /No such table/);
	});
	test("SQL injection through identifiers is neutralised", () => {
		const e = seeded();
		assert.equal(db.quoteIdent('a"b'), '"a""b"');
		assert.throws(() => db.browseTable(e, 'notes"; DROP TABLE notes; --'), /No such table/);
		assert.equal(db.listTables(e).length, 1);
		assert.throws(() => db.quoteIdent(""), /Invalid/);
	});
	test("destructive statements need confirmation; confirmed run works", () => {
		const e = seeded();
		for (const sql of ["DROP TABLE notes", "DELETE FROM notes", "UPDATE notes SET title='x'"]) {
			assert.throws(() => db.runScript(e, sql), (err) => err.needsConfirmation === true);
		}
		assert.equal(db.listTables(e).length, 1);
		db.runScript(e, "DELETE FROM notes WHERE id = 2"); // has WHERE: no prompt
		db.runScript(e, "DROP TABLE notes", { confirmed: true });
		assert.equal(db.listTables(e).length, 0);
	});
	test("errors: syntax, constraint, empty, partial script reports statement number and prior results", () => {
		const e = seeded();
		assert.throws(() => db.runScript(e, "SELEC 1"), /Statement 1 failed/);
		assert.throws(() => db.runScript(e, "INSERT INTO notes(title) VALUES (NULL)"), /NOT NULL|constraint/i);
		assert.throws(() => db.runScript(e, "   "), /Nothing to run/);
		try { db.runScript(e, "SELECT 1; SELECT * FROM nope"); assert.fail("should throw"); } catch (err) { assert.match(err.message, /Statement 2 failed/); assert.equal(err.results.length, 1); }
	});
	test("CSV export: quoting, unicode, null, formula guard", () => {
		const e = seeded();
		const csv = db.toCsv(db.browseTable(e, "notes"));
		const lines = csv.split("\r\n");
		assert.equal(lines[0], "id,title,body");
		assert.equal(lines[1], "1,এক,প্রথম");
		assert.equal(lines[2], "2,two,'=cmd|calc");
		assert.equal(db.toCsv({ columns: ["a"], rows: [['x,"y"\nz'], [null]] }), 'a\r\n"x,""y""\nz"\r\n');
		assert.equal(db.toCsv({ columns: ["a"], rows: [["=1"]] }, { safe: false }), "a\r\n=1");
	});
	test("import validation rejects non-SQLite bytes", () => {
		assert.equal(db.looksLikeSqlite(new Uint8Array(10)), false);
		assert.equal(db.looksLikeSqlite(new TextEncoder().encode("hello".repeat(40))), false);
		const bytes = new Uint8Array(200); [...("SQLite format 3\0")].forEach((c, i) => (bytes[i] = c.charCodeAt(0)));
		assert.equal(db.looksLikeSqlite(bytes), true);
	});
	test("large insert and query performance sanity", () => {
		const e = nodeEngine(); db.runScript(e, "CREATE TABLE big(a INTEGER, b TEXT)");
		db.runScript(e, "BEGIN"); for (let i = 0; i < 20000; i++) e.exec("INSERT INTO big VALUES (?, ?)", [i, `row ${i}`]); db.runScript(e, "COMMIT");
		assert.equal(db.browseTable(e, "big", { search: "row 19999" }).total, 1);
		assert.equal(db.browseTable(e, "big", { limit: 50 }).rows.length, 50);
	});
	test("query history persists, dedupes and caps", () => {
		const mem = new Map(); const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
		const h = db.createHistory(st, "k", 3);
		for (const q of ["a", "b", "a", "c", "d"]) h.add(q);
		assert.deepEqual(db.createHistory(st, "k").list().map((x) => x.sql), ["d", "c", "a"]);
		h.clear(); assert.deepEqual(h.list(), []);
		assert.deepEqual(db.createHistory({ getItem: () => "{bad", setItem() {} }).list(), []);
	});
});
