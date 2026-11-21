// Minimal, dependency-free ZIP reader/writer (stored + deflate) with zip-slip and zip-bomb protection.
// Uses CompressionStream/DecompressionStream('deflate-raw') (Chromium WebView 80+, Node 18+).

const te = new TextEncoder();
const td = new TextDecoder("utf-8");
let CRC_TABLE;
export function crc32(bytes) {
	if (!CRC_TABLE) { CRC_TABLE = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; } }
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

async function pipe(stream, bytes) {
	const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
	return new Uint8Array(await out.arrayBuffer());
}
const deflate = (b) => pipe(new CompressionStream("deflate-raw"), b);
const inflate = (b) => pipe(new DecompressionStream("deflate-raw"), b);

/** Normalises an archive path; throws for traversal, absolute, drive-letter, backslash or control characters. */
export function safeEntryPath(raw) {
	const p = String(raw);
	if (!p || p.includes("\0") || /[\u0001-\u001f]/.test(p)) throw new Error(`Unsafe path in archive: ${JSON.stringify(p)}`);
	if (p.startsWith("/") || p.includes("\\") || /^[A-Za-z]:/.test(p)) throw new Error(`Unsafe path in archive: ${p}`);
	const parts = p.split("/").filter((x) => x !== "" && x !== ".");
	if (!parts.length || parts.includes("..")) throw new Error(`Unsafe path in archive: ${p}`);
	return parts.join("/") + (p.endsWith("/") ? "/" : "");
}

/** @param {{path:string, data?:Uint8Array}[]} entries  (path ending in "/" = directory) */
export async function createZip(entries, { compress = true } = {}) {
	const chunks = []; const central = []; let offset = 0; const now = new Date();
	const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
	const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
	const u16 = (v, n) => v.setUint16(n.o, n.v, true);
	for (const e of entries) {
		const path = safeEntryPath(e.path); const isDir = path.endsWith("/");
		const data = isDir ? new Uint8Array(0) : e.data || new Uint8Array(0);
		let body = data; let method = 0;
		if (compress && !isDir && data.length > 64) { const d = await deflate(data); if (d.length < data.length) { body = d; method = 8; } }
		const name = te.encode(path); const crc = crc32(data);
		const lh = new DataView(new ArrayBuffer(30));
		lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
		lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
		chunks.push(new Uint8Array(lh.buffer), name, body);
		const ch = new DataView(new ArrayBuffer(46));
		ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true);
		ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
		ch.setUint32(38, isDir ? 0x10 : 0, true); ch.setUint32(42, offset, true);
		central.push(new Uint8Array(ch.buffer), name);
		offset += 30 + name.length + body.length;
	}
	const cdSize = central.reduce((a, c) => a + c.length, 0);
	const end = new DataView(new ArrayBuffer(22));
	end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
	const all = [...chunks, ...central, new Uint8Array(end.buffer)];
	const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0)); let o = 0;
	for (const c of all) { out.set(c, o); o += c.length; }
	return out;
}

/**
 * Reads and VALIDATES an archive. Limits protect against zip bombs; CRCs are verified.
 * @returns {Promise<{path:string,isDir:boolean,data:Uint8Array}[]>}
 */
export async function readZip(bytes, { maxFiles = 20000, maxTotalBytes = 500 * 2 ** 20, maxFileBytes = 200 * 2 ** 20, maxRatio = 200 } = {}) {
	const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let eocd = -1;
	for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
	if (eocd < 0) throw new Error("Not a valid ZIP file");
	const count = v.getUint16(eocd + 10, true); let p = v.getUint32(eocd + 16, true);
	if (count > maxFiles) throw new Error(`Archive has too many files (${count})`);
	const out = []; let total = 0;
	for (let n = 0; n < count; n++) {
		if (p + 46 > bytes.length || v.getUint32(p, true) !== 0x02014b50) throw new Error("Corrupt ZIP directory");
		const flags = v.getUint16(p + 8, true); const method = v.getUint16(p + 10, true); const crc = v.getUint32(p + 16, true);
		const csize = v.getUint32(p + 20, true); const usize = v.getUint32(p + 24, true);
		const nlen = v.getUint16(p + 28, true); const xlen = v.getUint16(p + 30, true); const clen = v.getUint16(p + 32, true); const lho = v.getUint32(p + 42, true);
		const rawName = bytes.subarray(p + 46, p + 46 + nlen);
		const name = flags & 0x0800 ? td.decode(rawName) : new TextDecoder("latin1").decode(rawName);
		p += 46 + nlen + xlen + clen;
		if (flags & 1) throw new Error("Encrypted archives are not supported");
		if (csize === 0xffffffff || usize === 0xffffffff) throw new Error("ZIP64 archives are not supported");
		const path = safeEntryPath(name); const isDir = path.endsWith("/");
		if (isDir) { out.push({ path, isDir, data: new Uint8Array(0) }); continue; }
		if (usize > maxFileBytes) throw new Error(`File too large in archive: ${path}`);
		total += usize; if (total > maxTotalBytes) throw new Error("Archive expands to too much data");
		if (csize > 0 && usize / csize > maxRatio && usize > 1 << 20) throw new Error(`Suspicious compression ratio: ${path}`);
		if (lho + 30 > bytes.length || v.getUint32(lho, true) !== 0x04034b50) throw new Error("Corrupt ZIP entry");
		const start = lho + 30 + v.getUint16(lho + 26, true) + v.getUint16(lho + 28, true);
		const comp = bytes.subarray(start, start + csize);
		let data;
		if (method === 0) data = comp;
		else if (method === 8) { try { data = await inflate(comp); } catch { throw new Error(`Corrupt compressed data for ${path}`); } }
		else throw new Error(`Unsupported compression method ${method}`);
		if (data.length !== usize) throw new Error(`Size mismatch for ${path}`);
		if (crc32(data) !== crc) throw new Error(`CRC mismatch for ${path} - archive is corrupt`);
		out.push({ path, isDir, data });
	}
	if (new Set(out.map((e) => e.path.toLowerCase())).size !== out.length) throw new Error("Archive contains duplicate paths");
	return out;
}
