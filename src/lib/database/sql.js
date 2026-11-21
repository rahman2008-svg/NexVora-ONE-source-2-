// NexVora ONE Database Studio - engine-independent SQL helpers.
// An "engine" is: { exec(sql, params?) -> {columns:string[], rows:any[][], changes:number},
//                   export() -> Uint8Array, close() }.

export const quoteIdent = (name) => {
	if (typeof name !== "string" || !name || name.includes("\0")) throw new Error("Invalid identifier");
	return `"${name.replace(/"/g, '""')}"`;
};

/** Splits a script into statements, respecting quotes, comments and BEGIN..END blocks. */
export function splitStatements(script) {
	const out = [];
	let cur = "";
	let i = 0;
	let depth = 0;
	const n = script.length;
	while (i < n) {
		const c = script[i];
		const two = script.slice(i, i + 2);
		if (c === "'" || c === '"' || c === "`") {
			let j = i + 1;
			while (j < n) {
				if (script[j] === c) { if (script[j + 1] === c) { j += 2; continue; } break; }
				j++;
			}
			cur += script.slice(i, j + 1); i = j + 1; continue;
		}
		if (two === "--") { const j = script.indexOf("\n", i); const e = j < 0 ? n : j; i = e; continue; }
		if (two === "/*") { const j = script.indexOf("*/", i + 2); i = j < 0 ? n : j + 2; continue; }
		if (c === ";" && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ""; i++; continue; }
		cur += c; i++;
		if (/[A-Za-z]/.test(c) && !/[A-Za-z0-9_]/.test(script[i - 2] || " ")) {
			const m = /^[A-Za-z_]+/.exec(script.slice(i - 1));
			const w = m[0].toUpperCase();
			if (w === "BEGIN" || w === "CASE") depth++;
			else if (w === "END" && depth > 0) depth--;
		}
	}
	if (cur.trim()) out.push(cur.trim());
	return out;
}

const firstWord = (sql) => (/^\s*([A-Za-z]+)/.exec(sql.replace(/^(\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/))*/, ""))?.[1] || "").toUpperCase();

/** Statements that remove data or schema require explicit user confirmation in the UI. */
export function riskOf(sql) {
	const w = firstWord(sql);
	if (w === "DROP") return "DROP removes a table, index or view permanently.";
	if (w === "DELETE" && !/\bWHERE\b/i.test(sql)) return "DELETE without WHERE removes every row.";
	if (w === "UPDATE" && !/\bWHERE\b/i.test(sql)) return "UPDATE without WHERE changes every row.";
	if (w === "TRUNCATE") return "TRUNCATE removes every row.";
	return null;
}

/** Runs a script statement by statement; stops at the first error. */
export function runScript(engine, script, { confirmed = false } = {}) {
	const stmts = splitStatements(script);
	if (!stmts.length) throw new Error("Nothing to run");
	if (!confirmed) {
		const risky = stmts.map(riskOf).find(Boolean);
		if (risky) { const e = new Error(risky); e.needsConfirmation = true; throw e; }
	}
	const results = [];
	for (const [idx, s] of stmts.entries()) {
		try {
			const r = engine.exec(s);
			results.push({ sql: s, ...r });
		} catch (e) {
			const err = new Error(`Statement ${idx + 1} failed: ${e.message}`);
			err.results = results;
			throw err;
		}
	}
	return results;
}

export function listTables(engine) {
	return engine.exec("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").rows.map(([name, type]) => ({ name, type }));
}

export function tableSchema(engine, table) {
	return engine.exec(`PRAGMA table_info(${quoteIdent(table)})`).rows.map(([cid, name, type, notnull, dflt, pk]) => ({ cid, name, type, notNull: !!notnull, default: dflt, primaryKey: pk > 0 }));
}

export function browseTable(engine, table, { limit = 100, offset = 0, search = "" } = {}) {
	const cols = tableSchema(engine, table).map((c) => c.name);
	if (!cols.length) throw new Error(`No such table: ${table}`);
	let where = "";
	const params = [];
	if (search) {
		where = ` WHERE ${cols.map((c) => `CAST(${quoteIdent(c)} AS TEXT) LIKE ? ESCAPE '\\'`).join(" OR ")}`;
		const like = `%${search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
		for (let i = 0; i < cols.length; i++) params.push(like);
	}
	const total = engine.exec(`SELECT COUNT(*) FROM ${quoteIdent(table)}${where}`, params).rows[0][0];
	const page = engine.exec(`SELECT * FROM ${quoteIdent(table)}${where} LIMIT ${Number(limit) | 0} OFFSET ${Number(offset) | 0}`, params);
	return { columns: page.columns, rows: page.rows, total };
}

export function insertRow(engine, table, values) {
	const keys = Object.keys(values);
	if (!keys.length) throw new Error("No values to insert");
	return engine.exec(`INSERT INTO ${quoteIdent(table)} (${keys.map(quoteIdent).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, keys.map((k) => values[k]));
}

/** Update/delete by primary key or rowid. */
export function updateRow(engine, table, rowid, values) {
	const keys = Object.keys(values);
	if (!keys.length) throw new Error("No values to update");
	const r = engine.exec(`UPDATE ${quoteIdent(table)} SET ${keys.map((k) => `${quoteIdent(k)} = ?`).join(", ")} WHERE rowid = ?`, [...keys.map((k) => values[k]), rowid]);
	if (!r.changes) throw new Error("No row was updated");
	return r;
}
export function deleteRow(engine, table, rowid) {
	const r = engine.exec(`DELETE FROM ${quoteIdent(table)} WHERE rowid = ?`, [rowid]);
	if (!r.changes) throw new Error("No row was deleted");
	return r;
}

/** RFC 4180 CSV (CRLF). With `safe`, text starting with = + - @ is prefixed to defuse spreadsheet formulas. */
export function toCsv({ columns, rows }, { safe = true } = {}) {
	const cell = (v, isHeader = false) => {
		if (v === null || v === undefined) return "";
		let t = v instanceof Uint8Array ? `[blob ${v.length} bytes]` : String(v);
		if (safe && !isHeader && typeof v === "string" && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
		return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
	};
	return [columns.map((c) => cell(c, true)).join(","), ...rows.map((r) => r.map((v) => cell(v)).join(","))].join("\r\n");
}

/** Cheap validity check for an imported file before opening it as a database. */
export function looksLikeSqlite(bytes) {
	const magic = "SQLite format 3\0";
	if (bytes.length < 100) return false;
	for (let i = 0; i < magic.length; i++) if (bytes[i] !== magic.charCodeAt(i)) return false;
	return true;
}

export function createHistory(storage, key = "nexvora.sql.history", max = 100) {
	const read = () => { try { return JSON.parse(storage.getItem(key)) || []; } catch { return []; } };
	return { list: read, add(sql) { const h = [{ sql, at: new Date().toISOString() }, ...read().filter((x) => x.sql !== sql)].slice(0, max); storage.setItem(key, JSON.stringify(h)); }, clear() { storage.setItem(key, "[]"); } };
}
