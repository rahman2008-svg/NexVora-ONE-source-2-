import Page from "components/page";
import confirm from "dialogs/confirm";
import prompt from "dialogs/prompt";
import fsOperation from "fileSystem";
import actionStack from "lib/actionStack";
import { androidBuildWorkflow, githubPagesWorkflow, normalizeGithubRun, normalizeRender, normalizeVercel, pollUntilDone, renderYaml, vercelJson } from "lib/deploy/deploy";
import { getAccountManager } from "lib/integrations";
import FileBrowser from "pages/fileBrowser";

const ICON = { success: "OK", failed: "FAILED", building: "building", queued: "queued", canceled: "canceled", unknown: "unknown" };

/** Deploy Studio: operates on YOUR connected GitHub / Vercel / Render accounts only. */
export default function openDeployStudio() {
	const mgr = getAccountManager();
	const $page = Page("Deploy Studio");
	$page.classList.add("nx-toolbox", "nx-deploy");
	const $msg = <p className="nx-tb-hint"></p>;
	const $out = <div className="nx-db-out"></div>;
	const say = (t, err) => { $msg.textContent = t || ""; $msg.style.color = err ? "#ff526d" : ""; };
	const guard = (fn) => async (...a) => { try { say("Working..."); await fn(...a); say(""); } catch (e) { say(e?.message || String(e), true); } };
	const need = async (p, label) => { const a = await mgr.adapter(p); if (!a) throw new Error(`${label} is not connected. Connect your own account in Settings → Connected accounts.`); return a; };
	const row = (text, fn) => <div className="nx-row" onclick={guard(fn)}><span>{text}</span></div>;
	const btn = (t, fn) => <button type="button" onclick={guard(fn)}>{t}</button>;

	async function githubActions() {
		const gh = await need("github", "GitHub");
		const repos = await gh.listRepos({ maxPages: 2 });
		$out.textContent = ""; $out.append(<strong>Pick a repository</strong>);
		for (const r of repos) $out.append(row(`${r.fullName}${r.private ? " (private)" : ""}`, () => repoRuns(gh, r)));
	}
	async function repoRuns(gh, r) {
		const runs = await gh.listWorkflowRuns(r.fullName, { perPage: 15 });
		$out.textContent = ""; $out.append(<strong>{r.fullName} - Actions</strong>);
		$out.append(btn("Run workflow...", async () => {
			const wf = await prompt("Workflow file name (e.g. android-build.yml)", "android-build.yml", "text"); if (!wf) return;
			const ref = await prompt("Branch or tag", r.defaultBranch || "main", "text"); if (!ref) return;
			if (!(await confirm("Run workflow", `Dispatch ${wf} on ${ref} in ${r.fullName}? This runs in YOUR GitHub account.`))) return;
			await gh.dispatchWorkflow(r.fullName, wf, ref);
			say("Dispatched. GitHub has not run it yet - refresh to see the real run status.");
		}), btn("Refresh", () => repoRuns(gh, r)));
		if (!runs.length) $out.append(<pre className="nx-tb-hint">No workflow runs found</pre>);
		for (const run of runs) $out.append(row(`[${ICON[normalizeGithubRun(run)]}] ${run.name} (${run.branch})`, async () => {
			const jobs = await gh.listRunJobs(r.fullName, run.id);
			$out.textContent = ""; $out.append(<strong>{run.name} - {ICON[normalizeGithubRun(run)]}</strong>);
			for (const j of jobs) { $out.append(<pre className="nx-tb-output">{`${j.name}: ${j.conclusion || j.status}\n${j.steps.map((s) => `  ${s.conclusion === "success" ? "ok " : s.conclusion ? "!! " : ".. "}${s.name}`).join("\n")}`}</pre>); }
			$out.append(btn("Back", () => repoRuns(gh, r)), <a href={run.url} onclick={(e) => { e.preventDefault(); system.openInBrowser(run.url); }}>Open full logs on GitHub</a>);
		}));
	}
	async function vercel() {
		const v = await need("vercel", "Vercel");
		const ps = await v.listProjects();
		$out.textContent = ""; $out.append(<strong>Your Vercel projects</strong>);
		if (!ps.length) $out.append(<pre className="nx-tb-hint">No projects in this account</pre>);
		for (const p of ps) $out.append(row(`${p.name}${p.framework ? ` (${p.framework})` : ""}`, async () => {
			const ds = await v.listDeployments(p.id);
			$out.textContent = ""; $out.append(<strong>{p.name}</strong>);
			$out.append(btn("Redeploy latest", async () => {
				const last = ds[0]; if (!last) throw new Error("No previous deployment to redeploy");
				if (!(await confirm("Redeploy", `Redeploy ${p.name} (production) in YOUR Vercel account?`))) return;
				const r = await v.redeploy({ name: p.name, deploymentId: last.id });
				say(`Vercel accepted the request (${r.state}). Check the list for the real status.`);
			}), btn("Back", vercel));
			for (const d of ds) $out.append(row(`[${ICON[normalizeVercel(d.state)]}] ${d.url || d.id}`, async () => { if (d.url) system.openInBrowser(d.url); }));
		}));
	}
	async function render() {
		const r = await need("render", "Render");
		const ss = await r.listServices();
		$out.textContent = ""; $out.append(<strong>Your Render services</strong>);
		if (!ss.length) $out.append(<pre className="nx-tb-hint">No services in this account</pre>);
		for (const s of ss) $out.append(row(`${s.name} (${s.type})`, async () => {
			const ds = await r.listDeploys(s.id);
			$out.textContent = ""; $out.append(<strong>{s.name}</strong>);
			$out.append(btn("Trigger deploy", async () => {
				if (!(await confirm("Deploy", `Trigger a deploy of ${s.name} in YOUR Render account?`))) return;
				const d = await r.triggerDeploy(s.id);
				const final = await pollUntilDone(async () => normalizeRender((await r.listDeploys(s.id, 1))[0]?.status), { onUpdate: (st) => say(`Render: ${ICON[st]}`) });
				say(final.state === "success" ? "Render reports the deploy is live." : `Render result: ${final.state}${final.reason ? ` (${final.reason})` : ""}`, final.state !== "success");
			}), btn("Back", render));
			for (const d of ds) $out.append(<div className="nx-row"><span>[{ICON[normalizeRender(d.status)]}] {d.status} {d.commit ? d.commit.slice(0, 7) : ""}</span></div>);
		}));
	}
	async function configFiles() {
		const kinds = { "GitHub Pages workflow (.github/workflows/pages.yml)": () => ["pages.yml", githubPagesWorkflow({ publishDir: "." })], "Vercel (vercel.json)": () => ["vercel.json", vercelJson({ outputDirectory: "." })], "Render static site (render.yaml)": async () => ["render.yaml", renderYaml({ name: (await prompt("Service name (lowercase, dashes)", "my-site", "text")) || "my-site" })], "Android debug APK workflow": () => ["android-build.yml", androidBuildWorkflow()] };
		$out.textContent = ""; $out.append(<strong>Generate deployment config</strong>);
		for (const [label, make] of Object.entries(kinds)) $out.append(row(label, async () => {
			const [name, text] = await make();
			const dir = await FileBrowser("folder", `Save ${name} into your project folder`);
			const target = `${dir.url.replace(/\/$/, "")}/${name}`;
			const exists = await fsOperation(target).exists?.();
			if (exists && !(await confirm("Overwrite", `${name} already exists. Overwrite?`))) return;
			await (exists ? fsOperation(target).writeFile(text) : fsOperation(dir.url).createFile(name, text));
			say(`Saved ${name}. For GitHub workflows, move it to .github/workflows/ in your repo.`);
		}));
	}

	$page.body = (
		<div className="nx-tb-body scroll">
			<p className="nx-tb-hint">Deployments run in your own accounts. A deployment is shown as successful only when the provider says so.</p>
			<div className="nx-tb-actions">{btn("GitHub Actions", githubActions)}{btn("Vercel", vercel)}{btn("Render", render)}</div>
			<div className="nx-tb-actions">{btn("Config files", configFiles)}</div>
			{$msg}{$out}
		</div>
	);
	actionStack.push({ id: "deploy-studio", action: $page.hide });
	$page.onhide = () => actionStack.remove("deploy-studio");
	app.append($page);
}
