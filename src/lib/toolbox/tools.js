// NexVora ONE Developer Toolbox - pure, dependency-free utilities.
// Every function performs the real operation and throws Error with a readable message on bad input.

import { formatCss, formatSql } from "./format.js";

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

export function jsonFormat(input, indent = 2) {
	return JSON.stringify(JSON.parse(input), null, indent);
}

export function jsonMinify(input) {
	return JSON.stringify(JSON.parse(input));
}

/** @returns {{valid:boolean, message:string}} */
export function jsonValidate(input) {
	try {
		JSON.parse(input);
		return { valid: true, message: "Valid JSON" };
	} catch (e) {
		return { valid: false, message: e.message };
	}
}

export function base64Encode(text) {
	const bytes = enc.encode(text);
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin);
}

export function base64Decode(b64) {
	const clean = b64.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
	const bin = atob(clean);
	const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
	return dec.decode(bytes);
}

export const urlEncode = (text) => encodeURIComponent(text);
export const urlDecode = (text) => decodeURIComponent(text);

/**
 * @param {string} pattern
 * @param {string} flags
 * @param {string} text
 */
export function regexTest(pattern, flags, text) {
	const re = new RegExp(pattern, flags.includes("g") ? flags : `${flags}g`);
	const matches = [];
	for (const m of text.matchAll(re)) {
		matches.push({ match: m[0], index: m.index, groups: m.slice(1) });
		if (matches.length >= 1000) break;
	}
	return matches;
}

/** @param {"SHA-1"|"SHA-256"|"SHA-384"|"SHA-512"} algo */
export async function hash(text, algo = "SHA-256") {
	const digest = await crypto.subtle.digest(algo, enc.encode(text));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function uuidv4() {
	if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
	const b = crypto.getRandomValues(new Uint8Array(16));
	b[6] = (b[6] & 0x0f) | 0x40;
	b[8] = (b[8] & 0x3f) | 0x80;
	const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Accepts unix seconds, unix milliseconds, or any Date-parsable string.
 * @returns {{unixSeconds:number, unixMillis:number, iso:string, local:string}}
 */
export function timestampConvert(input) {
	const s = String(input).trim();
	let date;
	if (/^-?\d+(\.\d+)?$/.test(s)) {
		const n = Number(s);
		date = new Date(Math.abs(n) < 1e11 ? n * 1000 : n);
	} else {
		date = new Date(s);
	}
	if (Number.isNaN(date.getTime())) throw new Error("Unrecognised date or timestamp");
	return {
		unixSeconds: Math.floor(date.getTime() / 1000),
		unixMillis: date.getTime(),
		iso: date.toISOString(),
		local: date.toString(),
	};
}

/** Line diff via longest common subsequence. Prefixes: "  " same, "- " removed, "+ " added. */
export function textDiff(a, b) {
	const x = a.split("\n");
	const y = b.split("\n");
	const n = x.length;
	const m = y.length;
	if (n * m > 4_000_000) throw new Error("Inputs too large to diff on device");
	const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
	for (let i = n - 1; i >= 0; i--)
		for (let j = m - 1; j >= 0; j--)
			dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
	const out = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (x[i] === y[j]) { out.push(`  ${x[i]}`); i++; j++; }
		else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(`- ${x[i++]}`);
		else out.push(`+ ${y[j++]}`);
	}
	while (i < n) out.push(`- ${x[i++]}`);
	while (j < m) out.push(`+ ${y[j++]}`);
	return out.join("\n");
}

/** Parses #rgb, #rrggbb or rgb(r,g,b) and returns all common forms. */
export function colorConvert(input) {
	const s = input.trim().toLowerCase();
	let r;
	let g;
	let b;
	let m = /^#([0-9a-f]{3})$/.exec(s);
	if (m) [r, g, b] = [...m[1]].map((c) => Number.parseInt(c + c, 16));
	else if ((m = /^#([0-9a-f]{6})$/.exec(s)))
		[r, g, b] = [0, 2, 4].map((k) => Number.parseInt(m[1].slice(k, k + 2), 16));
	else if ((m = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(s)))
		[r, g, b] = [m[1], m[2], m[3]].map(Number);
	else throw new Error("Use #rgb, #rrggbb or rgb(r, g, b)");
	if ([r, g, b].some((v) => v > 255)) throw new Error("RGB values must be 0-255");
	const [rn, gn, bn] = [r / 255, g / 255, b / 255];
	const max = Math.max(rn, gn, bn);
	const min = Math.min(rn, gn, bn);
	const l = (max + min) / 2;
	const d = max - min;
	let h = 0;
	let sat = 0;
	if (d) {
		sat = d / (1 - Math.abs(2 * l - 1));
		if (max === rn) h = ((gn - bn) / d) % 6;
		else if (max === gn) h = (bn - rn) / d + 2;
		else h = (rn - gn) / d + 4;
		h = Math.round(h * 60);
		if (h < 0) h += 360;
	}
	const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
	return {
		hex,
		rgb: `rgb(${r}, ${g}, ${b})`,
		hsl: `hsl(${h}, ${Math.round(sat * 100)}%, ${Math.round(l * 100)}%)`,
	};
}

async function prettierFormat(code, parser) {
	const [prettier, babel, estree, html, postcss] = await Promise.all([
		import("prettier/standalone"), import("prettier/plugins/babel"), import("prettier/plugins/estree"), import("prettier/plugins/html"), import("prettier/plugins/postcss"),
	]);
	return (await (prettier.default || prettier).format(code, { parser, plugins: [babel.default || babel, estree.default || estree, html.default || html, postcss.default || postcss], tabWidth: 2 })).trimEnd();
}

/** Renders Markdown to SANITISED html (kind: "html" outputs are inserted as markup by the UI). */
export async function markdownToSafeHtml(md) {
	const [{ default: MarkdownIt }, { default: DOMPurify }] = await Promise.all([import("markdown-it"), import("dompurify")]);
	return DOMPurify.sanitize(new MarkdownIt({ html: false, linkify: true, breaks: false }).render(md), { USE_PROFILES: { html: true } });
}

/** Registry used by the UI. run() returns a string. `runtime: true` tools need browser/bundled libraries. */
export const TOOLS = [
	{ id: "json-format", name: "JSON Formatter", hint: "Paste JSON", run: (i) => jsonFormat(i) },
	{ id: "json-minify", name: "JSON Minifier", hint: "Paste JSON", run: (i) => jsonMinify(i) },
	{ id: "json-validate", name: "JSON Validator", hint: "Paste JSON", run: (i) => jsonValidate(i).message },
	{ id: "base64-enc", name: "Base64 Encode", hint: "Text", run: base64Encode },
	{ id: "base64-dec", name: "Base64 Decode", hint: "Base64 text", run: base64Decode },
	{ id: "url-enc", name: "URL Encode", hint: "Text", run: urlEncode },
	{ id: "url-dec", name: "URL Decode", hint: "Encoded text", run: urlDecode },
	{
		id: "regex",
		name: "Regex Tester",
		hint: "Line 1: /pattern/flags - remaining lines: test text",
		run: (i) => {
			const [first, ...rest] = i.split("\n");
			const m = /^\/(.*)\/([a-z]*)$/s.exec(first.trim());
			if (!m) throw new Error("First line must look like /pattern/flags");
			const res = regexTest(m[1], m[2], rest.join("\n"));
			return res.length
				? res.map((r, k) => `#${k + 1} @${r.index}: ${JSON.stringify(r.match)}${r.groups.length ? ` groups=${JSON.stringify(r.groups)}` : ""}`).join("\n")
				: "No matches";
		},
	},
	{
		id: "hash",
		name: "Hash Generator",
		hint: "Text (SHA-1/256/384/512 shown)",
		run: async (i) =>
			(await Promise.all(["SHA-1", "SHA-256", "SHA-384", "SHA-512"].map(async (a) => `${a}: ${await hash(i, a)}`))).join("\n"),
	},
	{ id: "uuid", name: "UUID Generator", hint: "Input ignored", run: () => uuidv4() },
	{
		id: "timestamp",
		name: "Timestamp Converter",
		hint: "Unix seconds/ms or a date",
		run: (i) => {
			const t = timestampConvert(i);
			return `unix s: ${t.unixSeconds}\nunix ms: ${t.unixMillis}\nISO: ${t.iso}\nlocal: ${t.local}`;
		},
	},
	{
		id: "diff",
		name: "Text Diff",
		hint: "Text A, a line containing only ===, then Text B",
		run: (i) => {
			const parts = i.split(/\n===\n/);
			if (parts.length !== 2) throw new Error("Separate the two texts with a line containing only ===");
			return textDiff(parts[0], parts[1]);
		},
	},
	{
		id: "color",
		name: "Color Converter",
		hint: "#rrggbb or rgb(r, g, b)",
		run: (i) => {
			const c = colorConvert(i);
			return `${c.hex}\n${c.rgb}\n${c.hsl}`;
		},
	},
	{ id: "css-format", name: "CSS Formatter", hint: "Paste CSS", run: (i) => formatCss(i) },
	{ id: "sql-format", name: "SQL Formatter", hint: "Paste SQL", run: (i) => formatSql(i) },
	{ id: "html-format", name: "HTML Formatter", hint: "Paste HTML", runtime: true, run: (i) => prettierFormat(i, "html") },
	{ id: "js-format", name: "JavaScript Formatter", hint: "Paste JavaScript", runtime: true, run: (i) => prettierFormat(i, "babel") },
	{ id: "markdown", name: "Markdown Preview", hint: "Paste Markdown - raw HTML in it is not rendered", runtime: true, kind: "html", run: (i) => markdownToSafeHtml(i) },
];

/** Single entry point for the UI: validates empty input (uuid needs none) then runs the tool. */
export async function runTool(tool, input) {
	if (tool.id !== "uuid" && !String(input ?? "").trim()) throw new Error("Enter some input first");
	if (String(input).length > 5_000_000) throw new Error("Input is too large for this tool (limit 5 MB)");
	return tool.run(input);
}
