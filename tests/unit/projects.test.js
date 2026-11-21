import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, test } from "vitest";
import { createProjectManager, validateProjectName } from "../../src/lib/projects/manager.js";
import { TEMPLATES, templateFiles } from "../../src/lib/projects/templates.js";
import { createZip, readZip } from "../../src/lib/projects/zip.js";

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "nx-proj-"));
const fs = {
	exists: (p) => fsp.access(p).then(() => true, () => false),
	isDir: (p) => fsp.stat(p).then((s) => s.isDirectory(), () => false),
	list: (p) => fsp.readdir(p),
	readFile: async (p) => new Uint8Array(await fsp.readFile(p)),
	writeFile: (p, b) => fsp.writeFile(p, b),
	mkdirp: (p) => fsp.mkdir(p, { recursive: true }),
	remove: (p) => fsp.rm(p, { recursive: true, force: true }),
	move: (a, b) => fsp.rename(a, b),
};
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const root = path.join(tmp, "projects");
afterAll(() => fsp.rm(tmp, { recursive: true, force: true }));
const mk = (meta = mem()) => createProjectManager({ fs, meta, root });
const enc = (s) => new TextEncoder().encode(s);

describe("templates", () => {
	test("every template yields real, valid files", () => {
		for (const id of Object.keys(TEMPLATES)) {
			const files = templateFiles(id, "My App");
			assert.ok(Object.keys(files).length >= 2, id);
			for (const [p, d] of Object.entries(files)) { assert.ok(d.length > 0, `${id}/${p}`); if (p.endsWith(".json")) JSON.parse(new TextDecoder().decode(d)); }
		}
		assert.ok("sw.js" in templateFiles("pwa", "x") && "manifest.json" in templateFiles("pwa", "x"));
		assert.throws(() => templateFiles("nope", "x"), /Unknown template/);
	});
});
describe("project manager", () => {
	test("name validation incl. Bangla; traversal and junk rejected", () => {
		for (const ok of ["App", "my app 2", "প্রজেক্ট", "a.b_c-d(1)"]) assert.equal(validateProjectName(ok), ok);
		for (const bad of ["", "  ", "../x", "a/b", "a\\b", ".hidden", "x..y", "a".repeat(65), "name;rm"]) assert.throws(() => validateProjectName(bad), bad);
	});
	test("create, list/search/sort, favorite, recent, persistence across restart", async () => {
		const meta = mem(); const pm = mk(meta);
		const a = await pm.create({ name: "Alpha", template: "website" }); await pm.create({ name: "Beta", template: "python" });
		assert.equal(await fsp.readFile(path.join(root, "Alpha/index.html"), "utf8").then((t) => t.includes("Alpha")), true);
		await assert.rejects(pm.create({ name: "Alpha" }), /already exists/);
		pm.setFavorite(a.id, true);
		assert.deepEqual(pm.list({ favoritesOnly: true }).map((p) => p.name), ["Alpha"]); assert.deepEqual(pm.list({ search: "bet" }).map((p) => p.name), ["Beta"]); assert.deepEqual(pm.list({ sort: "name" }).map((p) => p.name), ["Alpha", "Beta"]);
		const restarted = mk(meta); assert.equal(restarted.list().length, 2); assert.equal(restarted.get(a.id).favorite, true);
		await new Promise((r) => setTimeout(r, 5)); restarted.touch(a.id); assert.equal(restarted.recent(1)[0].name, "Alpha");
		assert.deepEqual(createProjectManager({ fs, meta: { getItem: () => "{bad", setItem() {} }, root }).list(), []);
	});
	test("rename and duplicate move/copy real files; conflicts refused", async () => {
		const pm = mk(); const p = await pm.create({ name: "Src", template: "website" });
		const d = await pm.duplicate(p.id, "Src copy"); assert.equal(await fs.exists(path.join(root, "Src copy/script.js")), true);
		await assert.rejects(pm.duplicate(p.id, "Src copy"), /already exists/);
		const r = await pm.rename(d.id, "Renamed"); assert.equal(await fs.exists(path.join(root, "Renamed/index.html")), true); assert.equal(await fs.exists(path.join(root, "Src copy")), false);
		await assert.rejects(pm.rename(r.id, "Src"), /already exists/);
	});
	test("delete never happens silently; list-only removal keeps files", async () => {
		const pm = mk(); const p = await pm.create({ name: "Del", template: "python" });
		await assert.rejects(pm.remove(p.id), (e) => e.needsConfirmation === true); assert.equal(pm.list().length, 1);
		await pm.remove(p.id, { confirmed: true }); assert.equal(pm.list().length, 0); assert.equal(await fs.exists(path.join(root, "Del/main.py")), true);
		const q = await pm.create({ name: "Del2", template: "python" }); await pm.remove(q.id, { confirmed: true, deleteFiles: true }); assert.equal(await fs.exists(path.join(root, "Del2")), false);
		assert.throws(() => pm.get("nope"), /Unknown project/);
	});
	test("export then import round-trips a project (unicode file names) and refuses to overwrite", async () => {
		const pm = mk(); const p = await pm.create({ name: "Export me", template: "website" });
		await fsp.writeFile(path.join(root, "Export me/বাংলা.txt"), "হ্যালো"); await fsp.mkdir(path.join(root, "Export me/node_modules/x"), { recursive: true }); await fsp.writeFile(path.join(root, "Export me/node_modules/x/big.js"), "skip");
		const zip = await pm.exportZip(p.id);
		const names = (await readZip(zip)).map((e) => e.path); assert.ok(names.includes("বাংলা.txt")); assert.equal(names.some((n) => n.includes("node_modules")), false);
		const imp = await pm.importZip(zip, { name: "Imported" }); assert.equal(await fsp.readFile(path.join(root, "Imported/বাংলা.txt"), "utf8"), "হ্যালো"); assert.equal(imp.name, "Imported");
		await assert.rejects(pm.importZip(zip, { name: "Imported" }), (e) => e.code === "EXISTS");
		await pm.importZip(zip, { name: "Imported", overwrite: true });
	});
	test("import strips a single top-level folder; malicious archives write nothing", async () => {
		const pm = mk(); const z = await createZip([{ path: "repo-main/" }, { path: "repo-main/a.txt", data: enc("a") }, { path: "repo-main/src/b.txt", data: enc("b") }]);
		await pm.importZip(z, { name: "Stripped" }); assert.equal(await fs.exists(path.join(root, "Stripped/a.txt")), true); assert.equal(await fs.exists(path.join(root, "Stripped/repo-main")), false);
		const evil = await createZip([{ path: "ok.txt", data: enc("x") }]); const bytes = evil.slice();
		const s = Buffer.from(bytes).toString("latin1").replace("ok.txt", "../x.tx"); // corrupt names in both headers -> traversal
		await assert.rejects(pm.importZip(new Uint8Array(Buffer.from(s, "latin1")), { name: "Evil" }), /Unsafe path|CRC|Corrupt/);
		assert.equal(await fs.exists(path.join(root, "Evil")), false); assert.equal(await fs.exists(path.join(tmp, "x.tx")), false);
	});
	test("backup validates, detects tampering, restores to new folder, refuses silent overwrite", async () => {
		const pm = mk(); const p = await pm.create({ name: "Bk", template: "pwa" });
		const bk = await pm.backup(p.id); const info = await pm.inspectBackup(bk); assert.equal(info.valid, true); assert.ok(info.manifest.files.length >= 5);
		const r = await pm.restore(bk, { name: "Bk restored" }); assert.ok(r.restored >= 5); assert.equal(await fs.exists(path.join(root, "Bk restored/sw.js")), true);
		await assert.rejects(pm.restore(bk, { name: "Bk restored" }), (e) => e.code === "CONFLICTS" && e.conflicts.length >= 5);
		await fsp.writeFile(path.join(root, "Bk restored/index.html"), "LOCAL EDIT");
		await assert.rejects(pm.restore(bk, { name: "Bk restored" }), /would be overwritten/); assert.equal(await fsp.readFile(path.join(root, "Bk restored/index.html"), "utf8"), "LOCAL EDIT");
		const ov = await pm.restore(bk, { name: "Bk restored", overwrite: true }); assert.ok(ov.overwritten.includes("index.html")); assert.notEqual(await fsp.readFile(path.join(root, "Bk restored/index.html"), "utf8"), "LOCAL EDIT");
		// tampered backup: rebuild the zip with a modified file but the old manifest
		const entries = await readZip(bk); const t = entries.map((e) => (e.path === "files/index.html" ? { ...e, data: enc("TAMPERED") } : e));
		const bad = await pm.inspectBackup(await createZip(t)); assert.equal(bad.valid, false); assert.match(bad.problems.join(), /Checksum mismatch: index\.html/);
		await assert.rejects(pm.restore(await createZip(t), { name: "Nope" }), /not valid/); assert.equal(await fs.exists(path.join(root, "Nope")), false);
		assert.equal((await pm.inspectBackup(await createZip([{ path: "x.txt", data: enc("x") }]))).valid, false);
		assert.equal((await pm.inspectBackup(enc("junk"))).valid, false);
	});
	test("open existing folder and storage usage", async () => {
		const pm = mk(); const ext = path.join(tmp, "external"); await fsp.mkdir(ext); await fsp.writeFile(path.join(ext, "f.txt"), "12345");
		const o = await pm.open(ext, "External"); assert.equal(o.path, ext); await assert.rejects(pm.open(path.join(tmp, "nope")), /not found/);
		assert.equal(await pm.storageUsage(), 5);
	});
	test("createFromFiles / readText / writeText / listFiles stay inside the project", async () => {
		const pm = mk(); const p = await pm.createFromFiles({ name: "FromFiles", files: { "a/b.txt": "hello", "c.bin": new Uint8Array([1, 2, 3]) } });
		assert.deepEqual((await pm.listFiles(p.id)).sort(), ["a/b.txt", "c.bin"]); assert.equal(await pm.readText(p.id, "a/b.txt"), "hello");
		await pm.writeText(p.id, "a/b.txt", "changed"); assert.equal(await fsp.readFile(path.join(root, "FromFiles/a/b.txt"), "utf8"), "changed");
		await assert.rejects(pm.readText(p.id, "../../etc/passwd"), /Invalid path/); await assert.rejects(pm.writeText(p.id, "/abs", "x"), /Invalid path/);
		await assert.rejects(pm.createFromFiles({ name: "FromFiles", files: {} }), /already exists/);
	});
});
