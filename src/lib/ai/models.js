// Local model manager: GGUF files live in the Linux environment (~/models). Uses the real shell
// (curl/stat/df/rm) through the same runner as Git Studio. Nothing is bundled in the APK.
import { makeRunner, shq } from "lib/git/git";

const MODELS_DIR = "$HOME/models";
const safeName = (n) => {
	const s = String(n || "");
	if (!/^[\w][\w.\-]{0,150}\.gguf$/i.test(s)) throw new Error("Model file name must end in .gguf and contain only letters, digits, . _ -");
	return s;
};
export function validateModelUrl(url) {
	let u;
	try { u = new URL(String(url).trim()); } catch { throw new Error("Invalid URL"); }
	if (u.protocol !== "https:") throw new Error("Model downloads must use https");
	return u.toString();
}
export const fileNameFromUrl = (url) => decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
export const formatBytes = (n) => (n >= 2 ** 30 ? `${(n / 2 ** 30).toFixed(2)} GB` : n >= 2 ** 20 ? `${(n / 2 ** 20).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

export function createModelManager(execRaw) {
	const run = makeRunner(execRaw);
	const must = async (cmd) => { const r = await run(cmd); if (r.code !== 0) throw new Error(r.out || `command failed (${r.code})`); return r.out; };
	const dir = async () => { await must(`mkdir -p ${MODELS_DIR}`); return (await must(`cd ${MODELS_DIR} && pwd`)).trim(); };
	return {
		run,
		async storage() { // free space where models are stored
			await dir();
			const [, total, , free] = (await must(`df -Pk ${MODELS_DIR} | tail -1`)).trim().split(/\s+/);
			return { totalBytes: +total * 1024, freeBytes: +free * 1024 };
		},
		async memory() { // RAM info from /proc/meminfo (kB)
			const t = await must("grep -E '^(MemTotal|MemAvailable):' /proc/meminfo");
			const get = (k) => +new RegExp(`${k}:\\s+(\\d+)`).exec(t)?.[1] * 1024;
			return { totalBytes: get("MemTotal"), availableBytes: get("MemAvailable") };
		},
		async list() {
			await dir();
			const out = await must(`cd ${MODELS_DIR} && for f in *.gguf; do [ -f "$f" ] && printf '%s\\t%s\\n' "$f" "$(stat -c %s "$f")"; done; true`);
			return out.split("\n").filter(Boolean).map((l) => { const [name, size] = l.split("\t"); return { name, sizeBytes: +size }; });
		},
		/** A real GGUF file starts with the ASCII magic "GGUF". */
		async validate(name) {
			const n = safeName(name);
			const magic = (await run(`head -c 4 ${MODELS_DIR}/${shq(n)}`)).out;
			const size = +(await must(`stat -c %s ${MODELS_DIR}/${shq(n)}`));
			if (magic !== "GGUF") return { valid: false, reason: "Not a GGUF file (bad magic header) - the download may be an error page or incomplete" };
			if (size < 1024 * 1024) return { valid: false, reason: "File is suspiciously small" };
			return { valid: true, sizeBytes: size };
		},
		/** Expected size from the server (HEAD / redirect-following). */
		async remoteSize(url) {
			const u = validateModelUrl(url);
			const out = await must(`curl -sIL --max-time 20 ${shq(u)} | grep -i '^content-length:' | tail -1 | tr -dc '0-9'`);
			return out ? +out : null;
		},
		/** Starts a resumable background download; poll progress(). Refuses when free space is insufficient. */
		async startDownload(url, name = fileNameFromUrl(url), expectedBytes = null) {
			const u = validateModelUrl(url); const n = safeName(name);
			const st = await this.storage();
			const need = expectedBytes ?? (await this.remoteSize(u)) ?? 0;
			if (need && st.freeBytes < need * 1.05) throw new Error(`Not enough storage: need ${formatBytes(need)}, free ${formatBytes(st.freeBytes)}`);
			await must(`cd ${MODELS_DIR} && ( nohup sh -c ${shq(`curl -fL --retry 3 -C - -o ${shq(`${n}.part`)} ${shq(u)} && mv ${shq(`${n}.part`)} ${shq(n)}; echo $? > ${shq(`${n}.done`)}`)} >/dev/null 2>&1 & ) ; true`);
			return { name: n, totalBytes: need };
		},
		async progress(name, totalBytes = 0) {
			const n = safeName(name);
			const done = (await run(`cat ${MODELS_DIR}/${shq(`${n}.done`)} 2>/dev/null`)).out.trim();
			const part = +((await run(`stat -c %s ${MODELS_DIR}/${shq(`${n}.part`)} 2>/dev/null || stat -c %s ${MODELS_DIR}/${shq(n)} 2>/dev/null`)).out || 0);
			if (done === "0") { const v = await this.validate(n); await run(`rm -f ${MODELS_DIR}/${shq(`${n}.done`)}`); return { state: v.valid ? "complete" : "invalid", bytes: part, totalBytes, percent: 100, reason: v.reason }; }
			if (done) { await run(`rm -f ${MODELS_DIR}/${shq(`${n}.done`)}`); return { state: "failed", bytes: part, totalBytes, percent: 0, reason: `Download failed (curl exit ${done}). Partial data is kept so it can resume.` }; }
			return { state: "downloading", bytes: part, totalBytes, percent: totalBytes ? Math.min(99, Math.floor((part / totalBytes) * 100)) : null };
		},
		async cancelDownload(name) { const n = safeName(name); await run(`pkill -f ${shq(`${n}.part`)}`); await run(`rm -f ${MODELS_DIR}/${shq(`${n}.part`)} ${MODELS_DIR}/${shq(`${n}.done`)}`); },
		async remove(name) { const n = safeName(name); await must(`rm -f -- ${MODELS_DIR}/${shq(n)}`); },
		async serverAvailable() { return (await run("command -v llama-server")).code === 0; },
		/** Command the user (or the Terminal tab) runs to serve a model on localhost. */
		serverCommand(name, { port = 8080, ctx = 2048, threads = 4 } = {}) {
			const n = safeName(name);
			return `llama-server -m "$HOME/models/${n}" --host 127.0.0.1 --port ${Number(port) | 0} -c ${Number(ctx) | 0} -t ${Number(threads) | 0}`;
		},
		async startServer(name, opts) {
			if (!(await this.serverAvailable())) throw new Error("llama-server is not installed in the Linux environment. Install llama.cpp there first (see BUILD.md → Local AI).");
			await must(`nohup ${this.serverCommand(name, opts)} >"$HOME/llama-server.log" 2>&1 &`);
			return "Server starting - give it a few seconds, then press Check connection.";
		},
	};
}
