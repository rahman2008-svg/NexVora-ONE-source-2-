// NexVora ONE Git Studio: drives the REAL git binary inside the Alpine Linux environment.
// `execRaw(cmd)` must run cmd in a POSIX shell and resolve with its output (stdout+stderr), e.g.
// Executor.execute(cmd, true). Exit codes are recovered with a trailer so failures are never hidden.

export const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const TRAILER = "__NXEXIT:";
export const scrub = (text, secrets) => secrets.filter(Boolean).reduce((t, s) => t.split(s).join("[redacted]"), String(text));

export function makeRunner(execRaw) {
	return async function run(cmd, { env = {}, secrets = [] } = {}) {
		const envs = Object.entries(env).map(([k, v]) => `${k}=${shq(v)}`).join(" ");
		const wrapped = `( ${envs ? `export ${envs}; ` : ""}${cmd} ) 2>&1; echo "${TRAILER}$?"`;
		let raw;
		try {
			raw = await execRaw(wrapped);
		} catch (e) {
			raw = `${e?.message || e}\n${TRAILER}255`;
		}
		const i = String(raw).lastIndexOf(TRAILER);
		const out = scrub(i < 0 ? String(raw) : String(raw).slice(0, i), secrets).replace(/\s+$/, "");
		const code = i < 0 ? 255 : Number.parseInt(String(raw).slice(i + TRAILER.length), 10);
		return { code, out };
	};
}

/** Only these remote forms are accepted. `ext::`/`fd::`-style transports and option injection are rejected. */
export function validateRemoteUrl(url) {
	const u = String(url || "").trim();
	if (!u || u.startsWith("-") || /[\s\0]/.test(u)) throw new Error("Invalid repository URL");
	if (/^https?:\/\/[^\s/]+\/.+/i.test(u)) return u;
	if (/^ssh:\/\/[^\s/]+\/.+/i.test(u)) return u;
	if (/^[\w.-]+@[\w.-]+:[^\s]+$/.test(u)) return u; // scp-like git@host:owner/repo.git
	throw new Error("Use an https://, ssh:// or git@host:path URL");
}
export function validateBranchName(name) {
	const n = String(name || "");
	if (!n || n.startsWith("-") || n.startsWith("/") || n.endsWith("/") || n.endsWith(".") || n.endsWith(".lock") || /[\s~^:?*[\\\0$`;|&<>()'"!#{}]|\.\.|@\{|\/\/|^\.|\/\./.test(n) || n === "@") throw new Error(`Invalid branch name: ${n || "(empty)"}`);
	return n;
}
export function validateRelPath(p) {
	const s = String(p || "");
	if (!s || s.startsWith("/") || s.startsWith("-") || s.split("/").includes("..") || s.includes("\0")) throw new Error(`Invalid path: ${s}`);
	return s;
}

// ---- parsers (pure) --------------------------------------------------------------------------
export function parseStatus(out) {
	const parts = out.split("\0").filter(Boolean);
	const res = { branch: null, upstream: null, ahead: 0, behind: 0, files: [] };
	for (let i = 0; i < parts.length; i++) {
		const e = parts[i];
		if (e.startsWith("## ")) {
			let s = e.slice(3).replace(/^(No commits yet on|Initial commit on) /, "");
			const track = /\s\[([^\]]*)\]$/.exec(s);
			if (track) s = s.slice(0, track.index);
			const [branch, upstream] = s.split("...");
			res.branch = branch; res.upstream = upstream || null;
			const a = /ahead (\d+)/.exec(track?.[1] || ""); const b = /behind (\d+)/.exec(track?.[1] || "");
			res.ahead = a ? +a[1] : 0; res.behind = b ? +b[1] : 0;
			continue;
		}
		const x = e[0]; const y = e[1]; const path = e.slice(3);
		let from = null;
		if (x === "R" || x === "C") from = parts[++i];
		res.files.push({ path, from, index: x === " " || x === "?" ? null : x, worktree: y === " " ? null : y, staged: x !== " " && x !== "?", untracked: x === "?", conflicted: x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D") });
	}
	return res;
}
export function parseLog(out) {
	return out.split("\x1e").map((r) => r.replace(/^\n/, "")).filter((r) => r.trim()).map((r) => {
		const [hash, author, email, date, subject] = r.split("\x1f");
		return { hash, short: hash.slice(0, 7), author, email, date, subject };
	});
}
export function parseBranches(out) {
	return out.split("\n").filter(Boolean).map((l) => {
		const [head, name, upstream, ref] = l.split("\x1f");
		return { name, current: head === "*", upstream: upstream || null, remote: ref.startsWith("refs/remotes/") };
	}).filter((b) => !b.name.endsWith("/HEAD") && !(b.remote && !b.name.includes("/")));
}
export function parseRemotes(out) {
	const map = new Map();
	for (const l of out.split("\n").filter(Boolean)) {
		const m = /^(\S+)\t(\S+) \((fetch|push)\)$/.exec(l);
		if (!m) continue;
		const r = map.get(m[1]) || { name: m[1], fetch: null, push: null };
		r[m[3]] = m[2].replace(/\/\/[^/@]+@/, "//"); // never surface credentials embedded in URLs
		map.set(m[1], r);
	}
	return [...map.values()];
}
export function parseDiff(out) {
	const files = [];
	let f = null; let h = null;
	for (const line of out.split("\n")) {
		if (line.startsWith("diff --git ")) { f = { header: line, file: (/ b\/(.*)$/.exec(line) || [])[1] || "", binary: false, hunks: [] }; files.push(f); h = null; }
		else if (!f) continue;
		else if (line.startsWith("Binary files") || line.startsWith("GIT binary patch")) f.binary = true;
		else if (line.startsWith("@@")) { h = { header: line, lines: [] }; f.hunks.push(h); }
		else if (h && /^[ +\-\\]/.test(line)) h.lines.push({ t: line[0], text: line.slice(1) });
	}
	return files;
}

// ---- service ---------------------------------------------------------------------------------
const ASKPASS = "/tmp/nexvora-askpass.sh";

export function createGit(execRaw) {
	const run = makeRunner(execRaw);
	const must = async (cmd, opts) => { const r = await run(cmd, opts); if (r.code !== 0) throw new Error(r.out || `git failed (exit ${r.code})`); return r.out; };
	const g = (cwd) => `git -c protocol.ext.allow=never -c core.quotepath=false -C ${shq(cwd)}`;
	/** HTTPS auth: static askpass helper reads the secret from the environment; nothing is written to disk or the URL. */
	const authEnv = (c) => (c ? { GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: ASKPASS, NEXVORA_GIT_USER: c.username, NEXVORA_GIT_PASS: c.password } : { GIT_TERMINAL_PROMPT: "0" });
	const secretsOf = (c) => (c ? [c.password] : []);
	const ensureAskpass = () => must(`printf '%s\\n' '#!/bin/sh' 'case "$1" in *sername*) printf "%s" "$NEXVORA_GIT_USER";; *) printf "%s" "$NEXVORA_GIT_PASS";; esac' > ${ASKPASS} && chmod 700 ${ASKPASS}`);
	const sshEnv = (keyPath) => ({ GIT_SSH_COMMAND: `ssh -i ${shq(keyPath)} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes` });

	return {
		run,
		/** Installs git + openssh in Alpine if missing (needs network). */
		async ensureInstalled() {
			if ((await run("command -v git >/dev/null && command -v ssh >/dev/null")).code === 0) return "already installed";
			return must("apk add --no-cache git openssh-client");
		},
		version: () => must("git --version"),
		async isRepo(cwd) { return (await run(`${g(cwd)} rev-parse --is-inside-work-tree`)).out === "true"; },
		init: async (cwd, branch = "main") => must(`mkdir -p ${shq(cwd)} && git init -b ${shq(validateBranchName(branch))} ${shq(cwd)}`),
		async clone(url, dir, creds) {
			validateRemoteUrl(url);
			await ensureAskpass();
			return must(`git -c protocol.ext.allow=never clone --progress -- ${shq(url)} ${shq(dir)}`, { env: authEnv(creds), secrets: secretsOf(creds) });
		},
		async setIdentity(cwd, name, email) {
			if (!name?.trim() || !/^[^@\s]+@[^@\s]+$/.test(email || "")) throw new Error("A name and a valid email are required");
			await must(`${g(cwd)} config user.name ${shq(name.trim())}`);
			await must(`${g(cwd)} config user.email ${shq(email.trim())}`);
		},
		async getIdentity(cwd) {
			const v = async (k) => (await run(`${g(cwd)} config --get ${k}`)).out;
			return { name: await v("user.name"), email: await v("user.email") };
		},
		async status(cwd) { return parseStatus(await must(`${g(cwd)} status --porcelain=v1 -b -z --untracked-files=all`)); },
		stage: async (cwd, paths) => must(`${g(cwd)} add -- ${paths.map((p) => shq(validateRelPath(p))).join(" ")}`),
		stageAll: (cwd) => must(`${g(cwd)} add -A`),
		async unstage(cwd, paths) {
			const files = paths.map((p) => shq(validateRelPath(p))).join(" ");
			const hasHead = (await run(`${g(cwd)} rev-parse --verify -q HEAD`)).code === 0;
			return must(hasHead ? `${g(cwd)} reset -q HEAD -- ${files}` : `${g(cwd)} rm --cached -q -r -- ${files}`);
		},
		async commit(cwd, message) {
			if (!message?.trim()) throw new Error("Commit message is empty");
			const id = await this.getIdentity(cwd);
			if (!id.name || !id.email) throw new Error("Set your Git name and email first");
			return must(`${g(cwd)} commit -m ${shq(message)}`);
		},
		async log(cwd, limit = 50) {
			const r = await run(`${g(cwd)} log --max-count=${Number(limit) | 0} --format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e`);
			if (r.code !== 0) { if (/does not have any commits/.test(r.out)) return []; throw new Error(r.out); }
			return parseLog(r.out);
		},
		async diff(cwd, { path, staged = false } = {}) {
			return parseDiff(await must(`${g(cwd)} diff --no-color --no-ext-diff -U3 ${staged ? "--cached " : ""}${path ? `-- ${shq(validateRelPath(path))}` : ""}`));
		},
		async branches(cwd) { return parseBranches(await must(`${g(cwd)} for-each-ref --format='%(HEAD)%1f%(refname:short)%1f%(upstream:short)%1f%(refname)' refs/heads refs/remotes`)); },
		createBranch: async (cwd, name, { checkout = true } = {}) => must(`${g(cwd)} ${checkout ? "checkout -b" : "branch"} ${shq(validateBranchName(name))}`),
		switchBranch: async (cwd, name) => must(`${g(cwd)} switch ${shq(validateBranchName(name))}`),
		merge: async (cwd, name) => must(`${g(cwd)} merge --no-edit ${shq(validateBranchName(name))}`),
		async remotes(cwd) { return parseRemotes(await must(`${g(cwd)} remote -v`)); },
		addRemote: async (cwd, name, url) => must(`${g(cwd)} remote add ${shq(validateBranchName(name))} ${shq(validateRemoteUrl(url))}`),
		removeRemote: async (cwd, name) => must(`${g(cwd)} remote remove ${shq(validateBranchName(name))}`),
		async fetch(cwd, remote = "origin", creds) { await ensureAskpass(); return must(`${g(cwd)} fetch --prune ${shq(remote)}`, { env: authEnv(creds), secrets: secretsOf(creds) }); },
		async pull(cwd, remote = "origin", creds) { await ensureAskpass(); return must(`${g(cwd)} pull --ff-only ${shq(remote)}`, { env: authEnv(creds), secrets: secretsOf(creds) }); },
		async push(cwd, remote = "origin", branch, creds) {
			await ensureAskpass();
			const b = branch ? validateBranchName(branch) : "HEAD";
			return must(`${g(cwd)} push -u ${shq(remote)} ${b === "HEAD" ? "HEAD" : shq(b)}`, { env: authEnv(creds), secrets: secretsOf(creds) });
		},
		// SSH: the private key stays in the Linux env (~/.ssh); only the PUBLIC key is ever shown.
		async generateSshKey(comment = "nexvora-one", path = "$HOME/.ssh/nexvora_ed25519") {
			await must(`mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh" && [ ! -e ${path} ] && ssh-keygen -t ed25519 -N '' -C ${shq(comment)} -f ${path} >/dev/null`);
			return must(`cat ${path}.pub`);
		},
		sshPublicKey: (path = "$HOME/.ssh/nexvora_ed25519") => must(`cat ${path}.pub`),
		async pushSsh(cwd, remote, branch, keyPath = "$HOME/.ssh/nexvora_ed25519") {
			const key = (await must(`printf %s ${keyPath}`)).trim();
			return must(`${g(cwd)} push -u ${shq(remote)} ${shq(validateBranchName(branch))}`, { env: sshEnv(key) });
		},
	};
}
