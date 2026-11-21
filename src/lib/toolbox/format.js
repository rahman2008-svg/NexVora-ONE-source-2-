// Pure formatters (CSS, SQL) and image sizing helper. HTML/JS formatting uses Prettier at runtime (see tools.js).

/** CSS beautifier: strings, comments and (...) groups such as url(data:...;base64,...) are preserved verbatim. */
export function formatCss(src, indent = "  ") {
	const s = String(src);
	let out = ""; let cur = ""; let depth = 0; let paren = 0; let i = 0;
	const pad = () => indent.repeat(depth);
	const flushDecl = (end) => { const t = cur.trim().replace(/\s+/g, " "); cur = ""; if (!t) return; out += `${pad()}${t.replace(/\s*:\s*/, ": ")}${end}\n`; };
	while (i < s.length) {
		const c = s[i]; const two = s.slice(i, i + 2);
		if (c === '"' || c === "'") { let j = i + 1; while (j < s.length && s[j] !== c) { if (s[j] === "\\") j++; j++; } if (j >= s.length) throw new Error("Unterminated string"); cur += s.slice(i, j + 1); i = j + 1; continue; }
		if (two === "/*") { const j = s.indexOf("*/", i + 2); if (j < 0) throw new Error("Unterminated comment"); if (cur.trim()) flushDecl(""); out += `${pad()}${s.slice(i, j + 2)}\n`; i = j + 2; continue; }
		if (c === "(") paren++; if (c === ")") paren = Math.max(0, paren - 1);
		if (paren === 0 && c === "{") { const sel = cur.trim().replace(/\s+/g, " ").replace(/\s*,\s*/g, ", "); cur = ""; out += `${pad()}${sel} {\n`; depth++; i++; continue; }
		if (paren === 0 && c === ";") { flushDecl(";"); i++; continue; }
		if (paren === 0 && c === "}") { if (cur.trim()) flushDecl(";"); depth--; if (depth < 0) throw new Error("Unbalanced }"); out += `${pad()}}\n`; i++; continue; }
		cur += c; i++;
	}
	if (depth !== 0) throw new Error("Unbalanced { }");
	if (cur.trim()) flushDecl("");
	return out.replace(/\n(\s*[^{}\n]+ \{)/g, (m, g, off, str) => (str[off - 1] === "{" || off === 0 ? m : `\n${g}`)).trim();
}

const KEYWORDS = new Set("SELECT FROM WHERE GROUP BY ORDER HAVING LIMIT OFFSET JOIN INNER LEFT RIGHT FULL OUTER CROSS ON AS AND OR NOT IN IS NULL LIKE BETWEEN EXISTS UNION ALL DISTINCT INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE ALTER DROP INDEX VIEW PRIMARY KEY FOREIGN REFERENCES DEFAULT CASE WHEN THEN ELSE END ASC DESC WITH IF UNIQUE CHECK CONSTRAINT AUTOINCREMENT INTEGER TEXT REAL BLOB".split(" "));
const NEWLINE_BEFORE = new Set(["SELECT", "FROM", "WHERE", "HAVING", "LIMIT", "OFFSET", "UNION", "VALUES", "SET", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS"]);

export function tokenizeSql(src) {
	const toks = []; const s = String(src); let i = 0;
	while (i < s.length) {
		const c = s[i];
		if (/\s/.test(c)) { i++; continue; }
		if (c === "'" || c === '"' || c === "`") { let j = i + 1; while (j < s.length) { if (s[j] === c) { if (s[j + 1] === c) { j += 2; continue; } break; } j++; } if (j >= s.length) throw new Error("Unterminated quoted text"); toks.push({ t: "str", v: s.slice(i, j + 1) }); i = j + 1; continue; }
		if (s.startsWith("--", i)) { const j = s.indexOf("\n", i); const e = j < 0 ? s.length : j; toks.push({ t: "comment", v: s.slice(i, e) }); i = e; continue; }
		if (s.startsWith("/*", i)) { const j = s.indexOf("*/", i + 2); if (j < 0) throw new Error("Unterminated comment"); toks.push({ t: "comment", v: s.slice(i, j + 2) }); i = j + 2; continue; }
		const w = /^[\p{L}\p{N}_$.@:]+/u.exec(s.slice(i)); if (w) { toks.push({ t: "word", v: w[0] }); i += w[0].length; continue; }
		toks.push({ t: "punct", v: c }); i++;
	}
	return toks;
}

export function formatSql(src, indent = "  ") {
	const toks = tokenizeSql(src); let out = ""; let depth = 0; let lineStart = true; let prev = null; let clause = ""; let between = false;
	const nl = (extra = 0) => { out = out.replace(/ +$/, ""); out += `\n${indent.repeat(depth + extra)}`; lineStart = true; };
	const put = (v, space = true) => { if (!lineStart && space && !out.endsWith("(")) out += " "; out += v; lineStart = false; };
	for (const [n, tk] of toks.entries()) {
		const up = tk.t === "word" ? tk.v.toUpperCase() : "";
		const isKw = tk.t === "word" && KEYWORDS.has(up);
		if (tk.t === "comment") { put(tk.v); if (tk.v.startsWith("--")) nl(); prev = tk; continue; }
		if (isKw && NEWLINE_BEFORE.has(up) && out.trim() && !(up === "JOIN" && prev && ["INNER", "LEFT", "RIGHT", "FULL", "CROSS", "OUTER"].includes(prev.u)) && !(up === "SET" && prev?.u === "ON") ) { if (!(prev && prev.u === "UNION" && up === "SELECT") ) nl(); }
		if (isKw && up === "AND" && between) between = false;
		else if (isKw && (up === "AND" || up === "OR") && out.trim()) { nl(1); }
		if (isKw && up === "BETWEEN") between = true;
		if (isKw && up === "BY" && prev && (prev.u === "GROUP" || prev.u === "ORDER")) { put("BY"); prev = { ...tk, u: up }; continue; }
		if (isKw && (up === "GROUP" || up === "ORDER")) nl();
		if (tk.t === "punct") {
			if (tk.v === "(") { put("(", !(prev && prev.t === "word" && !KEYWORDS.has(prev.u))); depth++; }
			else if (tk.v === ")") { depth = Math.max(0, depth - 1); out = out.replace(/ +$/, ""); put(")", false); }
			else if (tk.v === ",") { out = out.replace(/ +$/, ""); out += ","; lineStart = false; if (["SELECT", "SET"].includes(clause) || clause === "GROUP" || clause === "ORDER") nl(1); }
			else if (tk.v === ";") { out = out.replace(/ +$/, ""); out += ";\n"; depth = 0; lineStart = true; clause = ""; }
			else if (tk.v === "." ) put(".", false);
			else put(tk.v, !(["=", "<", ">", "+", "-", "*", "/", "%"].includes(tk.v) && false));
		} else put(isKw ? up : tk.v);
		if (isKw && ["SELECT", "FROM", "WHERE", "SET", "GROUP", "ORDER", "HAVING", "VALUES", "ON"].includes(up)) clause = up;
		prev = { ...tk, u: up };
	}
	return out.trim().replace(/\n{3,}/g, "\n\n");
}

/** Fits (w,h) inside maxEdge keeping aspect ratio; never upscales. */
export function fitSize(w, h, maxEdge) {
	if (!(w > 0 && h > 0)) throw new Error("Invalid image size");
	if (!maxEdge || Math.max(w, h) <= maxEdge) return { width: w, height: h };
	const k = maxEdge / Math.max(w, h);
	return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}
