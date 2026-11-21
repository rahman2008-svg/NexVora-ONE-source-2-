import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "vitest";
import { createZip, crc32, readZip, safeEntryPath } from "../../src/lib/projects/zip.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nx-zip-"));
const enc = (s) => new TextEncoder().encode(s);
const py = (code) => execFileSync("python3", ["-c", code], { encoding: "utf8" });

describe("zip", () => {
	test("crc32 known vector", () => assert.equal(crc32(enc("123456789")), 0xcbf43926));
	test("round trip: unicode names, empty files, directories, compressible and incompressible data", async () => {
		const big = enc("hello world ".repeat(5000)); const rnd = new Uint8Array(5000).map((_, i) => (i * 7919) % 251);
		const z = await createZip([{ path: "proj/" }, { path: "proj/বাংলা.txt", data: enc("হ্যালো") }, { path: "proj/empty.txt", data: new Uint8Array(0) }, { path: "proj/big.txt", data: big }, { path: "proj/rnd.bin", data: rnd }]);
		assert.ok(z.length < big.length / 3);
		const r = await readZip(z);
		assert.deepEqual(r.map((e) => e.path), ["proj/", "proj/বাংলা.txt", "proj/empty.txt", "proj/big.txt", "proj/rnd.bin"]);
		assert.equal(new TextDecoder().decode(r[1].data), "হ্যালো"); assert.deepEqual(r[3].data, big); assert.deepEqual(r[4].data, rnd);
	});
	test("our archives are accepted by real unzip and Python zipfile", async () => {
		const z = await createZip([{ path: "a/b.txt", data: enc("x".repeat(1000)) }, { path: "ü.txt", data: enc("ü") }]);
		const f = path.join(tmp, "ours.zip"); fs.writeFileSync(f, z);
		execFileSync("unzip", ["-tq", f]);
		assert.equal(py(`import zipfile;z=zipfile.ZipFile(${JSON.stringify(f)});assert z.testzip() is None;print(z.read('a/b.txt')==b'x'*1000, z.namelist()[1]=='ü.txt')`).trim(), "True True");
	});
	test("reads archives created by other tools (python deflate + stored, directories)", async () => {
		const f = path.join(tmp, "theirs.zip");
		py(`import zipfile;z=zipfile.ZipFile(${JSON.stringify(f)},'w');z.writestr('d/','');z.writestr('d/a.txt','AAAA'*500,zipfile.ZIP_DEFLATED);z.writestr('d/s.txt','stored',zipfile.ZIP_STORED);z.close()`);
		const r = await readZip(new Uint8Array(fs.readFileSync(f)));
		assert.deepEqual(r.map((e) => e.path), ["d/", "d/a.txt", "d/s.txt"]); assert.equal(new TextDecoder().decode(r[2].data), "stored"); assert.equal(r[1].data.length, 2000);
	});
	test("zip-slip: traversal, absolute, backslash, drive and control paths are rejected", async () => {
		for (const bad of ["../evil.txt", "a/../../evil", "/etc/passwd", "C:/x", "a\\b", "a\0b", "..", ""]) assert.throws(() => safeEntryPath(bad), bad);
		assert.equal(safeEntryPath("./a//b/"), "a/b/");
		const f = path.join(tmp, "slip.zip");
		py(`import zipfile;z=zipfile.ZipFile(${JSON.stringify(f)},'w');z.writestr('../../evil.txt','pwn');z.close()`);
		await assert.rejects(readZip(new Uint8Array(fs.readFileSync(f))), /Unsafe path/);
		await assert.rejects(createZip([{ path: "../x", data: enc("x") }]), /Unsafe path/);
	});
	test("zip bomb, too many files, corruption, encryption and non-zip are rejected", async () => {
		const f = path.join(tmp, "bomb.zip"); py(`import zipfile;z=zipfile.ZipFile(${JSON.stringify(f)},'w',zipfile.ZIP_DEFLATED);z.writestr('zeros',b'\\0'*(50*1024*1024));z.close()`);
		await assert.rejects(readZip(new Uint8Array(fs.readFileSync(f))), /compression ratio|too much data|too large/);
		await assert.rejects(readZip(new Uint8Array(fs.readFileSync(f)), { maxRatio: 1e9, maxTotalBytes: 1024 }), /too much data/);
		const many = await createZip(Array.from({ length: 30 }, (_, i) => ({ path: `f${i}`, data: enc("x") })));
		await assert.rejects(readZip(many, { maxFiles: 10 }), /too many files/);
		const ok = await createZip([{ path: "a.txt", data: enc("A".repeat(200)) }]);
		const corrupt = ok.slice(); corrupt[40] ^= 0xff;
		await assert.rejects(readZip(corrupt), /CRC|corrupt|Size mismatch|Corrupt/i);
		await assert.rejects(readZip(enc("not a zip at all, definitely not")), /Not a valid ZIP/);
		await assert.rejects(readZip(new Uint8Array(0)), /Not a valid ZIP/);
		const dup = await createZip([{ path: "a", data: enc("1") }, { path: "A", data: enc("2") }]);
		await assert.rejects(readZip(dup), /duplicate/);
	});
	test("large archive (20 MB) round trips", async () => {
		let x = 12345; const data = new Uint8Array(20 * 2 ** 20); for (let i = 0; i < data.length; i++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; data[i] = x >>> 24; }
		const r = await readZip(await createZip([{ path: "big.bin", data }])); assert.equal(crc32(r[0].data), crc32(data));
	});
});
