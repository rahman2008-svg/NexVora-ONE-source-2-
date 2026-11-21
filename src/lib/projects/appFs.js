// Adapter from Acode's fsOperation (file:// URLs) to the abstract fs used by the project manager.
const dirname = (p) => p.replace(/\/+$/, "").replace(/\/[^/]*$/, "");
const basename = (p) => p.replace(/\/+$/, "").split("/").pop();
export function createAppFs(fsOperation) {
	const fs = {
		exists: async (p) => { try { return !!(await fsOperation(p).exists()); } catch { return false; } },
		isDir: async (p) => { try { return !!(await fsOperation(p).stat()).isDirectory; } catch { return false; } },
		list: async (p) => (await fsOperation(p).lsDir()).map((f) => f.name),
		readFile: async (p) => new Uint8Array(await fsOperation(p).readFile()),
		async writeFile(p, bytes) {
			const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
			if (await fs.exists(p)) return fsOperation(p).writeFile(buf);
			return fsOperation(dirname(p)).createFile(basename(p), buf);
		},
		async mkdirp(p) {
			if (await fs.exists(p)) return;
			const parent = dirname(p);
			if (!parent || parent === p) throw new Error(`Cannot create ${p}`);
			await fs.mkdirp(parent);
			await fsOperation(parent).createDirectory(basename(p));
		},
		remove: (p) => fsOperation(p).delete(),
		async move(a, b) {
			if (dirname(a) !== dirname(b)) throw new Error("Moving between folders is not supported by this storage");
			return fsOperation(a).renameTo(basename(b));
		},
	};
	return fs;
}
