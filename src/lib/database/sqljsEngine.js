// sql.js (SQLite compiled to WebAssembly) engine. Real SQLite; database lives in memory and is
// persisted by exporting its bytes to a file the user chooses / the app sandbox.
import initSqlJs from "sql.js/dist/sql-wasm.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm";

let sqlPromise;
const loadSql = () => (sqlPromise ||= initSqlJs({ locateFile: () => wasmUrl }));

function wrap(db) {
	return {
		exec(sql, params = []) {
			const stmt = db.prepare(sql);
			try {
				if (params.length) stmt.bind(params);
				const columns = stmt.getColumnNames();
				const rows = [];
				while (stmt.step()) rows.push(stmt.get());
				return { columns, rows, changes: db.getRowsModified() };
			} finally {
				stmt.free();
			}
		},
		export: () => db.export(),
		close: () => db.close(),
	};
}
export async function createEmptyDatabase() { const SQL = await loadSql(); return wrap(new SQL.Database()); }
export async function openDatabaseBytes(bytes) { const SQL = await loadSql(); return wrap(new SQL.Database(bytes)); }
