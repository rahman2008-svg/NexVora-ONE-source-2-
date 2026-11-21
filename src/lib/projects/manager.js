// Project manager, import/export and backup/restore on top of an abstract file system.
// fs: { exists(p), isDir(p), list(p)->string[], readFile(p)->Uint8Array, writeFile(p,bytes), mkdirp(p), remove(p), move(a,b) }
import { createZip, crc32, readZip } from "./zip.js";
import { templateFiles } from "./templates.js";

const KEY = "nexvora.projects.v1";
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} ._()-]{0,63}$/u;
export function validateProjectName(name) {
	const n = String(name || "").trim();
	if (!NAME_RE.test(n) || n.includes("..") || n.endsWith(".") ) throw new Error("Project name: 1-64 letters, digits, spaces, . _ - ( ) and must start with a letter or digit");
	return n;
}
const join = (a, b) => `${a.replace(/\/+$/, "")}/${b}`;
const hex = (n) => n.toString(16).padStart(8, "0");

export function createProjectManager({ fs, meta, root, now = () => new Date().toISOString() }) {
	const read = () => { try { return JSON.parse(meta.getItem(KEY)) || { projects: [] }; } catch { return { projects: [] }; } };
	const write = (v) => meta.setItem(KEY, JSON.stringify(v));
	const find = (id) => { const p = read().projects.find((x) => x.id === id); if (!p) throw new Error("Unknown project"); return p; };
	const upsert = (p) => { const s = read(); s.projects = [p, ...s.projects.filter((x) => x.id !== p.id)]; write(s); return p; };
	const register = (name, template) => upsert({ id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, path: join(root, name), template: template || null, favorite: false, createdAt: now(), lastOpenedAt: now() });

	async function writeTree(dir, files) { // files: [{path,data}] - never overwrites silently
		for (const f of files) {
			const target = join(dir, f.path.replace(/\/$/, ""));
			if (f.path.endsWith("/")) { await fs.mkdirp(target); continue; }
			await fs.mkdirp(target.slice(0, target.lastIndexOf("/")));
			await fs.writeFile(target, f.data);
		}
	}
	async function collect(dir, base = "", skip = [".git/objects/pack"]) {
		const out = [];
		for (const name of await fs.list(dir)) {
			const p = join(dir, name); const rel = base ? `${base}/${name}` : name;
			if (name === "node_modules" || skip.includes(rel)) continue;
			if (await fs.isDir(p)) { out.push({ path: `${rel}/` }); out.push(...(await collect(p, rel, skip))); }
			else out.push({ path: rel, data: await fs.readFile(p) });
		}
		return out;
	}
	const stripTop = (entries) => {
		const tops = new Set(entries.map((e) => e.path.split("/")[0]));
		const single = tops.size === 1 && entries.some((e) => e.path.includes("/")) && entries.every((e) => e.path.startsWith(`${[...tops][0]}/`));
		return single ? entries.map((e) => ({ ...e, path: e.path.slice([...tops][0].length + 1) })).filter((e) => e.path) : entries;
	};

	return {
		list({ search = "", sort = "recent", favoritesOnly = false } = {}) {
			let l = read().projects.filter((p) => (!favoritesOnly || p.favorite) && p.name.toLowerCase().includes(search.toLowerCase()));
			const by = { recent: (a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt), name: (a, b) => a.name.localeCompare(b.name), created: (a, b) => b.createdAt.localeCompare(a.createdAt) }[sort];
			return l.sort(by);
		},
		get: find,
		recent: (n = 5) => read().projects.sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt)).slice(0, n),
		async create({ name, template = "website" }) {
			const n = validateProjectName(name); const dir = join(root, n);
			if (await fs.exists(dir)) throw new Error(`A folder named "${n}" already exists`);
			await fs.mkdirp(dir);
			await writeTree(dir, Object.entries(templateFiles(template, n)).map(([path, data]) => ({ path, data })));
			return register(n, template);
		},
		/** Creates a project from an explicit file map ({path: string|Uint8Array}); refuses existing folders. */
		async createFromFiles({ name, files, template = null }) {
			const n = validateProjectName(name); const dir = join(root, n);
			if (await fs.exists(dir)) throw new Error(`A folder named "${n}" already exists`);
			await fs.mkdirp(dir);
			await writeTree(dir, Object.entries(files).map(([path, d]) => ({ path, data: typeof d === "string" ? new TextEncoder().encode(d) : d })));
			return register(n, template);
		},
		/** Reads a text file inside a registered project (path must stay inside it). */
		async readText(id, rel) { const p = find(id); if (rel.startsWith("/") || rel.split("/").includes("..")) throw new Error("Invalid path"); return new TextDecoder().decode(await fs.readFile(join(p.path, rel))); },
		async writeText(id, rel, text) { const p = find(id); if (rel.startsWith("/") || rel.split("/").includes("..")) throw new Error("Invalid path"); await fs.writeFile(join(p.path, rel), new TextEncoder().encode(text)); },
		async listFiles(id) { const p = find(id); return (await collect(p.path)).filter((f) => f.data).map((f) => f.path); },
		/** Adds an existing folder to the project list (no files are touched). */
		async open(path, name) { if (!(await fs.isDir(path))) throw new Error("Folder not found"); const s = read(); const ex = s.projects.find((p) => p.path === path); if (ex) { ex.lastOpenedAt = now(); write(s); return ex; } return upsert({ ...register(validateProjectName(name || path.split("/").pop()), null), path }); },
		touch(id) { const p = find(id); p.lastOpenedAt = now(); upsert(p); return p; },
		setFavorite(id, fav) { const p = find(id); p.favorite = !!fav; return upsert(p); },
		async rename(id, newName) {
			const p = find(id); const n = validateProjectName(newName); const dir = join(root, n);
			if (p.path.startsWith(`${root.replace(/\/+$/, "")}/`)) { if (await fs.exists(dir)) throw new Error(`"${n}" already exists`); await fs.move(p.path, dir); p.path = dir; }
			p.name = n; return upsert(p);
		},
		async duplicate(id, newName) {
			const p = find(id); const n = validateProjectName(newName || `${p.name} copy`); const dir = join(root, n);
			if (await fs.exists(dir)) throw new Error(`"${n}" already exists`);
			await fs.mkdirp(dir); await writeTree(dir, await collect(p.path)); return register(n, p.template);
		},
		/** Deleting requires `confirmed: true` (the UI shows a dialog). Files are only deleted with deleteFiles: true. */
		async remove(id, { confirmed = false, deleteFiles = false } = {}) {
			const p = find(id);
			if (!confirmed) { const e = new Error(`Remove "${p.name}"${deleteFiles ? " AND DELETE ITS FILES" : " from the list (files stay on disk)"}?`); e.needsConfirmation = true; throw e; }
			if (deleteFiles) await fs.remove(p.path);
			const s = read(); s.projects = s.projects.filter((x) => x.id !== id); write(s);
		},
		async exportZip(id) { const p = find(id); return createZip(await collect(p.path)); },
		async importZip(bytes, { name, overwrite = false } = {}) {
			const entries = stripTop(await readZip(bytes)); // validates paths, CRCs, bomb limits
			const n = validateProjectName(name); const dir = join(root, n);
			if ((await fs.exists(dir)) && !overwrite) { const e = new Error(`"${n}" already exists. Choose another name or confirm overwrite.`); e.code = "EXISTS"; throw e; }
			await fs.mkdirp(dir); await writeTree(dir, entries);
			const s = read(); const ex = s.projects.find((p) => p.path === dir);
			return ex ? upsert({ ...ex, lastOpenedAt: now() }) : register(n, null);
		},
		async backup(id) {
			const p = find(id); const tree = await collect(p.path); const files = tree.filter((f) => f.data);
			const manifest = { app: "NexVora ONE", format: 1, project: p.name, createdAt: now(), files: files.map((f) => ({ path: f.path, size: f.data.length, crc32: hex(crc32(f.data)) })) };
			return createZip([{ path: "nexvora-backup.json", data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) }, { path: "files/" }, ...tree.map((f) => ({ ...f, path: `files/${f.path}` }))]);
		},
		/** Validates a backup without touching disk. */
		async inspectBackup(bytes) {
			const problems = []; let entries;
			try { entries = await readZip(bytes); } catch (e) { return { valid: false, problems: [e.message] }; }
			const m = entries.find((e) => e.path === "nexvora-backup.json");
			if (!m) return { valid: false, problems: ["Not a NexVora backup (nexvora-backup.json missing)"] };
			let manifest; try { manifest = JSON.parse(new TextDecoder().decode(m.data)); } catch { return { valid: false, problems: ["Backup manifest is corrupt"] }; }
			if (manifest.app !== "NexVora ONE" || manifest.format !== 1 || !Array.isArray(manifest.files)) return { valid: false, problems: ["Unsupported backup format"] };
			const byPath = new Map(entries.filter((e) => !e.isDir).map((e) => [e.path, e]));
			for (const f of manifest.files) { const e = byPath.get(`files/${f.path}`); if (!e) problems.push(`Missing file: ${f.path}`); else if (hex(crc32(e.data)) !== f.crc32 || e.data.length !== f.size) problems.push(`Checksum mismatch: ${f.path}`); }
			return { valid: problems.length === 0, problems, manifest, entries };
		},
		/** Restores into a NEW folder unless overwrite is confirmed; reports conflicts instead of overwriting. */
		async restore(bytes, { name, overwrite = false } = {}) {
			const info = await this.inspectBackup(bytes);
			if (!info.valid) throw new Error(`Backup is not valid: ${info.problems.join("; ")}`);
			const n = validateProjectName(name || info.manifest.project); const dir = join(root, n);
			const files = info.entries.filter((e) => e.path.startsWith("files/") && e.path !== "files/").map((e) => ({ ...e, path: e.path.slice(6) })).filter((e) => e.path);
			const conflicts = [];
			if (await fs.exists(dir)) for (const f of files.filter((x) => !x.isDir)) if (await fs.exists(join(dir, f.path))) conflicts.push(f.path);
			if (conflicts.length && !overwrite) { const e = new Error(`${conflicts.length} existing file(s) would be overwritten. Restore to a new name, or confirm overwrite.`); e.code = "CONFLICTS"; e.conflicts = conflicts; throw e; }
			await fs.mkdirp(dir); await writeTree(dir, files);
			const s = read(); const ex = s.projects.find((p) => p.path === dir);
			return { project: ex ? upsert({ ...ex, lastOpenedAt: now() }) : register(n, null), restored: files.filter((f) => !f.isDir).length, overwritten: conflicts };
		},
		async storageUsage() { // bytes used by all registered projects
			let total = 0; for (const p of read().projects) if (await fs.exists(p.path)) for (const f of await collect(p.path)) total += f.data?.length || 0; return total;
		},
	};
}
