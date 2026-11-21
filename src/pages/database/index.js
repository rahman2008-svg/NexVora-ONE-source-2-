import Page from "components/page";
import confirm from "dialogs/confirm";
import prompt from "dialogs/prompt";
import fsOperation from "fileSystem";
import actionStack from "lib/actionStack";
import {
	browseTable, createHistory, deleteRow, insertRow, listTables, looksLikeSqlite,
	quoteIdent, runScript, tableSchema, toCsv,
} from "lib/database/sql";
import FileBrowser from "pages/fileBrowser";

const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

/** Database Studio: real SQLite (sql.js/WASM) with import/export. */
export default async function openDatabaseStudio() {
	const { createEmptyDatabase, openDatabaseBytes } = await import("lib/database/sqljsEngine");
	const history = createHistory(window.localStorage);
	let engine = await createEmptyDatabase();
	let dbName = "untitled.db";
	let dirty = false;
	let current = null; // table currently browsed
	let pageIndex = 0;
	const PAGE = 50;

	const $page = Page("Database Studio");
	$page.classList.add("nx-toolbox", "nx-db");
	const $title = <p className="nx-tb-hint"></p>;
	const $tables = <div className="nx-api-history"></div>;
	const $sql = <textarea className="nx-tb-input" rows="5" spellcheck="false" placeholder="SQL (CREATE, SELECT, INSERT, UPDATE, DELETE...)"></textarea>;
	const $search = <input className="nx-tb-select" type="search" placeholder="Search rows in the open table" />;
	const $out = <div className="nx-db-out"></div>;
	const $msg = <p className="nx-tb-hint"></p>;
	const say = (t, err) => { $msg.textContent = t || ""; $msg.style.color = err ? "#ff526d" : ""; };

	const table = (columns, rows, onRow) => {
		const $t = <table className="nx-db-table"></table>;
		const $h = <tr></tr>;
		for (const c of columns) $h.append(<th>{c}</th>);
		$t.append($h);
		for (const r of rows) {
			const $r = <tr></tr>;
			for (const v of r) $r.append(<td>{v === null ? "NULL" : v instanceof Uint8Array ? `[blob ${v.length}B]` : String(v)}</td>);
			if (onRow) $r.onclick = () => onRow(r);
			$t.append($r);
		}
		const $wrap = <div className="nx-db-scroll"></div>;
		$wrap.append($t);
		return $wrap;
	};

	function refreshTables() {
		$title.textContent = `${dbName}${dirty ? " (unsaved changes)" : ""}`;
		$tables.textContent = "";
		const ts = listTables(engine);
		if (!ts.length) $tables.textContent = "No tables. Create one with SQL below.";
		for (const t of ts) $tables.append(<div className="nx-row" onclick={() => openTable(t.name)}><span>{t.type === "view" ? "view" : "table"}: {t.name}</span></div>);
	}

	function openTable(name) {
		current = name; pageIndex = 0; renderTable();
	}
	function renderTable() {
		if (!current) return;
		try {
			const info = browseTable(engine, current, { limit: PAGE, offset: pageIndex * PAGE, search: $search.value });
			$out.textContent = "";
			$out.append(<strong>{current} - {info.total} row(s)</strong>);
			$out.append(table(info.columns, info.rows, (r) => rowMenu(r)));
			const $nav = <div className="nx-tb-actions"></div>;
			$nav.append(<button type="button" onclick={() => { if (pageIndex > 0) { pageIndex--; renderTable(); } }}>Prev</button>);
			$nav.append(<button type="button" onclick={() => { if ((pageIndex + 1) * PAGE < info.total) { pageIndex++; renderTable(); } }}>Next</button>);
			$nav.append(<button type="button" onclick={addRow}>Add row</button>);
			$nav.append(<button type="button" onclick={exportCsv}>CSV</button>);
			$out.append($nav);
			const schema = tableSchema(engine, current);
			$out.append(<pre className="nx-tb-hint">{schema.map((c) => `${c.name} ${c.type}${c.primaryKey ? " PK" : ""}${c.notNull ? " NOT NULL" : ""}`).join("\n")}</pre>);
		} catch (e) { say(e.message, true); }
	}

	async function addRow() {
		const values = {};
		for (const c of tableSchema(engine, current)) {
			const v = await prompt(`${c.name} (${c.type || "any"}) - leave empty for NULL/default`, "", "text");
			if (v === null) return; // cancelled
			if (v !== "") values[c.name] = v;
		}
		try { insertRow(engine, current, values); dirty = true; say("Row added"); refreshTables(); renderTable(); } catch (e) { say(e.message, true); }
	}
	async function rowMenu(row) {
		if (!(await confirm("Delete row", `Delete this row from ${current}?\n${row.join(" | ")}`))) return;
		try {
			const cols = tableSchema(engine, current).map((c) => quoteIdent(c.name));
			const rid = engine.exec(`SELECT rowid FROM ${quoteIdent(current)} WHERE ${cols.map((c) => `${c} IS ?`).join(" AND ")} LIMIT 1`, row.map((v) => (v === undefined ? null : v))).rows[0]?.[0];
			if (rid === undefined) return say("Row not found (it may contain a BLOB)", true);
			deleteRow(engine, current, rid); dirty = true; renderTable();
		} catch (e) { say(e.message, true); }
	}

	async function runSql(confirmed = false) {
		const sql = $sql.value;
		try {
			const results = runScript(engine, sql, { confirmed });
			history.add(sql);
			dirty = dirty || results.some((r) => r.changes || !r.columns.length);
			$out.textContent = "";
			for (const r of results) {
				if (r.columns.length) { $out.append(<strong>{r.rows.length} row(s)</strong>); $out.append(table(r.columns, r.rows)); }
				else $out.append(<pre className="nx-tb-hint">OK - {r.changes} row(s) changed</pre>);
			}
			say(`Ran ${results.length} statement(s)`); refreshTables();
		} catch (e) {
			if (e.needsConfirmation) { if (await confirm("Confirm destructive statement", e.message)) return runSql(true); return say("Cancelled"); }
			say(e.message, true);
		}
	}

	async function newDb() {
		if (dirty && !(await confirm("Discard changes", "The open database has unsaved changes. Continue?"))) return;
		engine.close(); engine = await createEmptyDatabase(); dbName = "untitled.db"; dirty = false; current = null; $out.textContent = ""; refreshTables();
	}
	async function importDb() {
		if (dirty && !(await confirm("Discard changes", "The open database has unsaved changes. Continue?"))) return;
		try {
			const f = await FileBrowser("file", "Select a SQLite database");
			const buf = new Uint8Array(await fsOperation(f.url).readFile());
			if (buf.length > MAX_IMPORT_BYTES) throw new Error("File is too large to open on device (limit 100 MB)");
			if (!looksLikeSqlite(buf)) throw new Error("This file is not a SQLite 3 database");
			const next = await openDatabaseBytes(buf);
			engine.close(); engine = next; dbName = f.name; dirty = false; current = null; $out.textContent = ""; refreshTables(); say("Database opened");
		} catch (e) { say(e?.message || String(e), true); }
	}
	async function exportDb() {
		try {
			const dir = await FileBrowser("folder", "Choose where to save the database");
			let name = await prompt("File name", dbName.endsWith(".db") ? dbName : `${dbName}.db`, "filename");
			if (!name) return;
			const exists = await fsOperation(`${dir.url.replace(/\/$/, "")}/${name}`).exists?.();
			if (exists && !(await confirm("Overwrite", `${name} already exists. Overwrite it?`))) return;
			await (exists ? fsOperation(`${dir.url.replace(/\/$/, "")}/${name}`).writeFile(engine.export()) : fsOperation(dir.url).createFile(name, engine.export()));
			dbName = name; dirty = false; refreshTables(); say(`Saved ${name}`);
		} catch (e) { say(e?.message || String(e), true); }
	}
	async function exportCsv() {
		try {
			const info = browseTable(engine, current, { limit: 1_000_000 });
			const dir = await FileBrowser("folder", "Choose where to save the CSV");
			const name = `${current}.csv`;
			await fsOperation(dir.url).createFile(name, new TextEncoder().encode(toCsv(info)));
			say(`Saved ${name}`);
		} catch (e) { say(e?.message || String(e), true); }
	}
	function showHistory() {
		$out.textContent = "";
		for (const h of history.list()) $out.append(<div className="nx-row" onclick={() => { $sql.value = h.sql; }}><span>{h.sql}</span></div>);
		if (!history.list().length) $out.textContent = "No queries yet.";
	}

	$search.oninput = () => { pageIndex = 0; renderTable(); };
	refreshTables();
	$page.body = (
		<div className="nx-tb-body scroll">
			{$title}
			<div className="nx-tb-actions">
				<button type="button" onclick={newDb}>New</button>
				<button type="button" onclick={importDb}>Open</button>
				<button type="button" onclick={exportDb}>Save as</button>
			</div>
			{$tables}
			{$sql}
			<div className="nx-tb-actions">
				<button type="button" onclick={() => runSql(false)}>Run SQL</button>
				<button type="button" onclick={showHistory}>History</button>
			</div>
			{$search}
			{$msg}
			{$out}
		</div>
	);
	const close = async () => {
		if (dirty && !(await confirm("Unsaved changes", "Close without saving the database?"))) return;
		engine.close(); $page.hide();
	};
	actionStack.push({ id: "database-studio", action: close });
	$page.onhide = () => actionStack.remove("database-studio");
	app.append($page);
}
