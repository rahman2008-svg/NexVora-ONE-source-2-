import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, test } from "vitest";
import * as G from "../../src/lib/git/git.js";

// Runs commands with the REAL git binary through /bin/sh (stand-in for the Alpine proot shell).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nx-git-"));
const env = { ...process.env, HOME: tmp, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_AUTHOR_DATE: "2024-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2024-01-01T00:00:00Z" };
const execRaw = (cmd) => new Promise((res) => execFile("/bin/sh", ["-c", cmd], { env, maxBuffer: 1 << 26 }, (_e, so, se) => res(`${so}${se}`)));
const git = G.createGit(execRaw);
const repo = path.join(tmp, "work");
const bare = path.join(tmp, "remote.git");
const write = (f, c) => { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), c); };
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("validators", () => {
	test("remote URLs: allowed forms pass, dangerous ones are rejected", () => {
		for (const ok of ["https://github.com/a/b.git", "http://h/x/y", "ssh://git@h/a/b.git", "git@github.com:a/b.git"]) assert.equal(G.validateRemoteUrl(ok), ok);
		for (const bad of ["", "  ", "-u/x", "--upload-pack=touch /tmp/x", "ext::sh -c touch% /tmp/pwn", "fd::17/foo", "file:///etc", "/local/path", "https://h/a b", "javascript:alert(1)"]) assert.throws(() => G.validateRemoteUrl(bad), bad);
	});
	test("branch names and relative paths", () => {
		for (const ok of ["main", "feature/x-1", "v1.0.0", "বাংলা"]) assert.equal(G.validateBranchName(ok), ok);
		for (const bad of ["", "-x", "a b", "a..b", "a;rm -rf /", "x.lock", "/x", "x/", "a@{1}", "a~1", "$(id)"]) assert.throws(() => G.validateBranchName(bad), bad);
		assert.throws(() => G.validateRelPath("../etc/passwd")); assert.throws(() => G.validateRelPath("/abs")); assert.throws(() => G.validateRelPath("-rf"));
	});
	test("shell quoting neutralises metacharacters", () => assert.equal(G.shq("a'b$(x)`y`"), "'a'\\''b$(x)`y`'"));
});

describe("parsers", () => {
	test("status incl. rename, untracked, ahead/behind, no-commits", () => {
		const s = G.parseStatus("## main...origin/main [ahead 2, behind 1]\0R  new.txt\0old.txt\0 M a.txt\0?? b c.txt\0UU conflict.txt\0");
		assert.deepEqual([s.branch, s.upstream, s.ahead, s.behind], ["main", "origin/main", 2, 1]);
		assert.equal(s.files[0].from, "old.txt"); assert.equal(s.files[1].worktree, "M"); assert.equal(s.files[2].untracked, true); assert.equal(s.files[2].path, "b c.txt"); assert.equal(s.files[3].conflicted, true);
		assert.equal(G.parseStatus("## No commits yet on dev\0").branch, "dev");
	});
	test("diff, remotes (credentials stripped), log", () => {
		const d = G.parseDiff("diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n");
		assert.deepEqual(d[0].hunks[0].lines.map((l) => l.t), [" ", "-", "+"]);
		assert.equal(G.parseDiff("diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ")[0].binary, true);
		assert.equal(G.parseRemotes("origin\thttps://user:tok@h.com/a/b.git (fetch)\norigin\thttps://user:tok@h.com/a/b.git (push)\n")[0].fetch, "https://h.com/a/b.git");
		assert.equal(G.parseLog("abc123456789\x1fA\x1fa@x\x1f2024\x1fhi\x1e\ndef\x1fB\x1fb@x\x1f2024\x1fyo\x1e").length, 2);
	});
});

describe("real git workflow", () => {
	beforeAll(async () => { await execRaw(`git init -q --bare -b main ${G.shq(bare)}`); });
	test("version, init, identity validation, status, stage, commit", async () => {
		assert.match(await git.version(), /^git version/);
		await git.init(repo); assert.equal(await git.isRepo(repo), true);
		await assert.rejects(git.setIdentity(repo, "", "a@b.c"), /required/); await assert.rejects(git.setIdentity(repo, "A", "not-an-email"), /valid email/);
		write("a.txt", "one\n"); write("dir/sp ace's.txt", "x\n");
		let s = await git.status(repo); assert.equal(s.branch, "main"); assert.equal(s.files.filter((f) => f.untracked).length, 2);
		await assert.rejects(git.commit(repo, "msg"), /name and email/); // identity not set
		await git.setIdentity(repo, "Alice বাংলা", "alice@example.com");
		await git.stage(repo, ["a.txt", "dir/sp ace's.txt"]);
		s = await git.status(repo); assert.equal(s.files.every((f) => f.staged), true);
		await assert.rejects(git.commit(repo, "   "), /empty/);
		await git.commit(repo, "প্রথম commit with 'quotes' and $(touch /tmp/PWNED) `id`\nsecond line");
		assert.equal(fs.existsSync("/tmp/PWNED"), false);
		const log = await git.log(repo); assert.equal(log.length, 1); assert.match(log[0].subject, /^প্রথম commit with 'quotes'/);
		assert.deepEqual(await git.getIdentity(repo), { name: "Alice বাংলা", email: "alice@example.com" });
	});
	test("log on empty repo is [], failures surface real git errors", async () => {
		const empty = path.join(tmp, "empty"); await git.init(empty); assert.deepEqual(await git.log(empty), []);
		await assert.rejects(git.switchBranch(repo, "nope"), /nope|invalid reference/i);
		assert.equal(await git.isRepo(path.join(tmp, "not-a-repo")), false);
	});
	test("diff unstaged/staged, unstage, stageAll", async () => {
		write("a.txt", "one\ntwo\n");
		const d = await git.diff(repo, { path: "a.txt" }); assert.equal(d[0].hunks[0].lines.some((l) => l.t === "+" && l.text === "two"), true);
		await git.stage(repo, ["a.txt"]);
		assert.equal((await git.diff(repo, { path: "a.txt" })).length, 0);
		assert.equal((await git.diff(repo, { path: "a.txt", staged: true }))[0].file, "a.txt");
		await git.unstage(repo, ["a.txt"]); assert.equal((await git.status(repo)).files[0].staged, false);
		await git.stageAll(repo); await git.commit(repo, "second");
		assert.equal((await git.log(repo)).length, 2);
		await assert.rejects(git.stage(repo, ["../outside"]), /Invalid path/);
	});
	test("branches: create, switch, commit, merge (fast-forward), injection rejected", async () => {
		await git.createBranch(repo, "feature/x");
		write("f.txt", "f\n"); await git.stageAll(repo); await git.commit(repo, "feat");
		await git.switchBranch(repo, "main");
		let b = await git.branches(repo); assert.deepEqual(b.filter((x) => x.current).map((x) => x.name), ["main"]); assert.equal(b.some((x) => x.name === "feature/x"), true);
		await git.merge(repo, "feature/x"); assert.equal(fs.existsSync(path.join(repo, "f.txt")), true);
		await assert.rejects(git.createBranch(repo, "x; touch /tmp/PWNED2"), /Invalid branch/); assert.equal(fs.existsSync("/tmp/PWNED2"), false);
	});
	test("remotes, push, fetch, pull, ahead/behind against a real bare remote", async () => {
		await git.run(`git -C ${G.shq(repo)} remote add origin ${G.shq(bare)}`); // local path: allowed for the test harness only
		assert.equal((await git.remotes(repo))[0].name, "origin");
		await git.push(repo, "origin", "main");
		let s = await git.status(repo); assert.equal(s.upstream, "origin/main"); assert.equal(s.ahead, 0);
		// second clone pushes a commit
		const other = path.join(tmp, "other");
		await git.run(`git clone -q ${G.shq(bare)} ${G.shq(other)}`);
		await git.setIdentity(other, "Bob", "bob@example.com");
		fs.writeFileSync(path.join(other, "b.txt"), "b\n"); await git.stageAll(other); await git.commit(other, "from bob"); await git.push(other, "origin", "main");
		await git.fetch(repo, "origin"); s = await git.status(repo); assert.equal(s.behind, 1);
		await git.pull(repo, "origin"); assert.equal(fs.existsSync(path.join(repo, "b.txt")), true);
		write("c.txt", "c\n"); await git.stageAll(repo); await git.commit(repo, "local"); s = await git.status(repo); assert.equal(s.ahead, 1);
	});
	test("remote management validates URLs; add/remove works", async () => {
		await assert.rejects(git.addRemote(repo, "evil", "ext::sh -c id"), /Invalid repository URL|Use an https/);
		await git.addRemote(repo, "gh", "https://github.com/me/repo.git"); assert.equal((await git.remotes(repo)).some((r) => r.name === "gh"), true);
		await git.removeRemote(repo, "gh"); assert.equal((await git.remotes(repo)).some((r) => r.name === "gh"), false);
	});
	test("clone rejects bad URLs; failed authenticated clone never leaks the password", async () => {
		await assert.rejects(git.clone("--upload-pack=x", path.join(tmp, "c1")), /Invalid repository URL/);
		await assert.rejects(git.clone("file:///tmp/x", path.join(tmp, "c1")), /Use an https/);
		await assert.rejects(git.clone("https://127.0.0.1:1/a/b.git", path.join(tmp, "c2"), { username: "u", password: "SUPER-SECRET-PW" }), (e) => !e.message.includes("SUPER-SECRET-PW"));
	});
	test("askpass helper returns username/password from the environment only", async () => {
		await git.fetch(repo, "origin", { username: "alice", password: "PW123" });
		const out = await git.run('/tmp/nexvora-askpass.sh "Username for x:"; printf "|"; /tmp/nexvora-askpass.sh "Password for x:"', { env: { NEXVORA_GIT_USER: "alice", NEXVORA_GIT_PASS: "PW123" } });
		assert.equal(out.out, "alice|PW123");
		assert.equal(fs.readFileSync("/tmp/nexvora-askpass.sh", "utf8").includes("PW123"), false);
	});
	test("SSH key generation exposes only the public key", async (ctx) => {
		const has = (await git.run("command -v ssh-keygen")).code === 0;
		if (!has) { console.log("SKIP ssh-keygen not installed in this sandbox"); return; }
		const pub = await git.generateSshKey("test");
		assert.match(pub, /^ssh-ed25519 /); assert.equal(pub.includes("PRIVATE"), false);
		assert.equal((await git.run(`stat -c %a ${path.join(tmp, ".ssh/nexvora_ed25519")}`)).out, "600");
	});
});
