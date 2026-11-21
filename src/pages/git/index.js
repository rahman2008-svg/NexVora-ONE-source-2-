import Page from "components/page";
import confirm from "dialogs/confirm";
import prompt from "dialogs/prompt";
import actionStack from "lib/actionStack";
import { credentialsForRemote } from "lib/git/credentials";
import { createGit } from "lib/git/git";
import { getAccountManager } from "lib/integrations";

const PATH_KEY = "nexvora.git.repo";

/** Git Studio: real git inside the Alpine Linux environment (needs Linux installed in Terminal settings). */
export default async function openGitStudio() {
	if (!window.Executor) return window.toast("The terminal/Linux plugin is not available on this device.", 4000);
	const git = createGit((cmd) => window.Executor.BackgroundExecutor.execute(cmd, true));
	const mgr = getAccountManager();
	let repo = window.localStorage.getItem(PATH_KEY) || "";

	const $page = Page("Git Studio");
	$page.classList.add("nx-toolbox", "nx-git");
	const $repoLabel = <p className="nx-tb-hint"></p>;
	const $msg = <p className="nx-tb-hint"></p>;
	const $body = <div className="nx-db-out"></div>;
	const $commit = <input className="nx-tb-select" type="text" placeholder="Commit message" />;
	const say = (t, err) => { $msg.textContent = t || ""; $msg.style.color = err ? "#ff526d" : ""; };
	const guard = (fn) => async (...a) => { try { say("Working..."); const r = await fn(...a); say(typeof r === "string" && r ? r.slice(0, 600) : "Done"); } catch (e) { say(e?.message || String(e), true); } };
	const needRepo = () => { if (!repo) throw new Error("Open or clone a repository first"); return repo; };
	const btn = (label, fn) => <button type="button" onclick={guard(fn)}>{label}</button>;
	const row = (text, fn) => <div className="nx-row" onclick={guard(fn)}><span>{text}</span></div>;

	async function setup() {
		say("Checking git...");
		const r = await git.ensureInstalled();
		return `git ready (${r})`;
	}
	async function setRepo(p) { repo = p; window.localStorage.setItem(PATH_KEY, p); $repoLabel.textContent = `Repository: ${p}`; await showStatus(); }
	async function openRepo() {
		const p = await prompt("Repository path inside the Linux environment (e.g. /sdcard/Documents/myproject)", repo, "text");
		if (!p) return;
		if (!(await git.isRepo(p))) { if (!(await confirm("Not a repository", `${p} is not a Git repository. Initialise one here?`))) return; await git.init(p); }
		await setRepo(p);
	}
	async function clone() {
		const url = await prompt("Repository URL (https:// or git@host:path)", "", "url"); if (!url) return;
		const dir = await prompt("Clone into (path inside Linux environment)", `/root/${url.split("/").pop().replace(/\.git$/, "")}`, "text"); if (!dir) return;
		const creds = await credentialsForRemote(mgr, url); // user's own connected account, or null for public repos
		await git.clone(url, dir, creds);
		await setRepo(dir); return "Cloned";
	}
	async function identity() {
		const cur = await git.getIdentity(needRepo());
		const name = await prompt("Your Git name", cur.name, "text"); if (!name) return;
		const email = await prompt("Your Git email", cur.email, "email"); if (!email) return;
		await git.setIdentity(repo, name, email);
	}
	async function showStatus() {
		const s = await git.status(needRepo());
		$body.textContent = "";
		$body.append(<strong>{s.branch}{s.upstream ? ` -> ${s.upstream}` : ""}{s.ahead ? ` ahead ${s.ahead}` : ""}{s.behind ? ` behind ${s.behind}` : ""}</strong>);
		if (!s.files.length) $body.append(<pre className="nx-tb-hint">Working tree clean</pre>);
		for (const f of s.files) {
			const tag = f.untracked ? "??" : `${f.index || " "}${f.worktree || " "}`;
			const $r = <div className="nx-row"><span>{tag} {f.path}</span></div>;
			$r.onclick = guard(async () => { f.staged && !f.worktree ? await git.unstage(repo, [f.path]) : await git.stage(repo, [f.path]); await showStatus(); });
			$r.oncontextmenu = guard(async (e) => { e.preventDefault(); await showDiff(f.path, f.staged); });
			$r.append(<button type="button" onclick={(e) => { e.stopPropagation(); guard(showDiff)(f.path, f.staged); }}>diff</button>);
			$body.append($r);
		}
		return "";
	}
	async function showDiff(path, staged) {
		const d = await git.diff(needRepo(), { path, staged });
		$body.textContent = "";
		if (!d.length) return $body.append(<pre className="nx-tb-hint">No changes to show (untracked files have no diff until staged)</pre>);
		for (const f of d) {
			$body.append(<strong>{f.file}</strong>);
			if (f.binary) { $body.append(<pre className="nx-tb-hint">Binary file</pre>); continue; }
			for (const h of f.hunks) {
				$body.append(<pre className="nx-tb-hint">{h.header}</pre>);
				const $p = <pre className="nx-tb-output"></pre>;
				for (const l of h.lines) $p.append(<div style={{ color: l.t === "+" ? "#20d997" : l.t === "-" ? "#ff526d" : "" }}>{l.t}{l.text}</div>);
				$body.append($p);
			}
		}
		return "";
	}
	async function showLog() {
		const l = await git.log(needRepo(), 50); $body.textContent = "";
		if (!l.length) $body.append(<pre className="nx-tb-hint">No commits yet</pre>);
		for (const c of l) $body.append(<div className="nx-row"><span>{c.short} {c.subject} - {c.author}</span></div>);
		return "";
	}
	async function showBranches() {
		const bs = await git.branches(needRepo()); $body.textContent = "";
		for (const b of bs) $body.append(row(`${b.current ? "* " : ""}${b.name}${b.remote ? " (remote)" : ""}`, async () => { if (!b.current && !b.remote) { await git.switchBranch(repo, b.name); await showBranches(); } }));
		$body.append(btn("New branch", async () => { const n = await prompt("New branch name", "", "text"); if (n) { await git.createBranch(repo, n); await showBranches(); } }));
		$body.append(btn("Merge into current...", async () => { const n = await prompt("Branch to merge", "", "text"); if (n && (await confirm("Merge", `Merge ${n} into the current branch?`))) return git.merge(repo, n); }));
		return "";
	}
	async function showRemotes() {
		const rs = await git.remotes(needRepo()); $body.textContent = "";
		for (const r of rs) $body.append(row(`${r.name}: ${r.fetch}`, async () => { if (await confirm("Remove remote", `Remove ${r.name}?`)) { await git.removeRemote(repo, r.name); await showRemotes(); } }));
		$body.append(btn("Add remote", async () => { const n = await prompt("Remote name", "origin", "text"); const u = n && (await prompt("Remote URL", "", "url")); if (u) { await git.addRemote(repo, n, u); await showRemotes(); } }));
		return "";
	}
	async function remoteUrl(name = "origin") { return (await git.remotes(needRepo())).find((r) => r.name === name)?.fetch || ""; }
	async function doCommit() { await git.commit(needRepo(), $commit.value); $commit.value = ""; await showStatus(); return "Committed"; }
	async function fetchR() { const c = await credentialsForRemote(mgr, await remoteUrl()); return git.fetch(needRepo(), "origin", c); }
	async function pullR() { const c = await credentialsForRemote(mgr, await remoteUrl()); const r = await git.pull(needRepo(), "origin", c); await showStatus(); return r; }
	async function pushR() {
		const s = await git.status(needRepo());
		if (!(await confirm("Push", `Push ${s.branch} to origin?`))) return;
		const c = await credentialsForRemote(mgr, await remoteUrl());
		if (!c && /^https?:/.test(await remoteUrl())) throw new Error("No connected account for this host. Connect one in Settings → Connected accounts (or use SSH).");
		return git.push(repo, "origin", s.branch, c);
	}
	async function sshKey() {
		let pub;
		try { pub = await git.generateSshKey(); } catch { pub = await git.sshPublicKey(); }
		cordova.plugins.clipboard.copy(pub);
		return `Public key copied. Add it to your provider's SSH keys:\n${pub}`;
	}

	$repoLabel.textContent = repo ? `Repository: ${repo}` : "No repository open";
	$page.body = (
		<div className="nx-tb-body scroll">
			{$repoLabel}
			<div className="nx-tb-actions">{btn("Open / init", openRepo)}{btn("Clone", clone)}{btn("Set up git", setup)}</div>
			<div className="nx-tb-actions">{btn("Status", showStatus)}{btn("History", showLog)}{btn("Branches", showBranches)}</div>
			<div className="nx-tb-actions">{btn("Remotes", showRemotes)}{btn("Identity", identity)}{btn("SSH key", sshKey)}</div>
			{$commit}
			<div className="nx-tb-actions">{btn("Stage all", async () => { await git.stageAll(needRepo()); await showStatus(); })}{btn("Commit", doCommit)}</div>
			<div className="nx-tb-actions">{btn("Fetch", fetchR)}{btn("Pull", pullR)}{btn("Push", pushR)}</div>
			{$msg}
			{$body}
		</div>
	);
	actionStack.push({ id: "git-studio", action: $page.hide });
	$page.onhide = () => actionStack.remove("git-studio");
	app.append($page);
	if (repo) guard(showStatus)();
}
