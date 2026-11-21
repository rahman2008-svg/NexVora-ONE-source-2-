import Page from "components/page";
import prompt from "dialogs/prompt";
import select from "dialogs/select";
import fsOperation from "fileSystem";
import actionStack from "lib/actionStack";
import { checkXml, describeStructure, generateAndroidProject, readGradleValues, setGradleValue, validateManifest } from "lib/appstudio/android";
import openFolder from "lib/openFolder";
import { createAppFs } from "lib/projects/appFs";
import { createProjectManager } from "lib/projects/manager";

/** App Studio: create/inspect/edit Android (Gradle) projects. APKs are built by GitHub Actions, not on the phone. */
export default function openAppStudio() {
	const base = window.cordova?.file?.externalDataDirectory || window.cordova?.file?.dataDirectory;
	if (!base) return window.toast("Storage is unavailable on this device.", 3500);
	const pm = createProjectManager({ fs: createAppFs(fsOperation), meta: window.localStorage, root: `${base}projects` });
	let current = null;
	const $page = Page("App Studio");
	$page.classList.add("nx-toolbox", "nx-appstudio");
	const $msg = <p className="nx-tb-hint"></p>;
	const $out = <div className="nx-db-out"></div>;
	const say = (t, err) => { $msg.textContent = t || ""; $msg.style.color = err ? "#ff526d" : ""; };
	const guard = (fn) => async () => { try { await fn(); } catch (e) { say(e?.message || String(e), true); } };
	const btn = (t, fn) => <button type="button" onclick={guard(fn)}>{t}</button>;
	const need = () => { if (!current) throw new Error("Create or choose an Android project first"); return current; };

	async function create() {
		const appName = await prompt("App name", "My App", "text"); if (!appName) return;
		const packageName = await prompt("Package name (e.g. com.yourname.myapp)", "com.example.myapp", "text"); if (!packageName) return;
		const language = await select("Language", [["kotlin", "Kotlin"], ["java", "Java"]]); if (!language) return;
		const files = generateAndroidProject({ appName, packageName, language });
		current = await pm.createFromFiles({ name: appName.replace(/[^\p{L}\p{M}\p{N} ._()-]/gu, "").trim() || "Android app", files, template: "android" });
		say(`Created ${current.name}. Push it to GitHub (Git Studio) - the included workflow builds the APK.`); await structure();
	}
	async function pick() {
		const items = pm.list().filter((p) => p.template === "android" || true).map((p) => [p.id, p.name]);
		if (!items.length) throw new Error("No projects yet");
		const id = await select("Choose project", items); if (!id) return; current = pm.get(id); say(`Using ${current.name}`); await structure();
	}
	async function structure() {
		const p = need(); const s = describeStructure(await pm.listFiles(p.id));
		$out.textContent = "";
		$out.append(<strong>{p.name}</strong>);
		const section = (title, files) => { $out.append(<pre className="nx-tb-hint">{title}</pre>); for (const f of files) $out.append(<div className="nx-row" onclick={guard(() => view(f))}><span>{f}</span></div>); };
		if (s.manifest) section("Manifest", [s.manifest]); section("Gradle", s.gradle); section("Sources", s.sources);
		for (const [type, files] of Object.entries(s.resources)) section(`res/${type}`, files);
		if (!s.manifest && !s.gradle.length) $out.append(<pre className="nx-tb-hint">This does not look like an Android project.</pre>);
	}
	async function view(rel) {
		const text = await pm.readText(need().id, rel);
		const $ta = <textarea className="nx-tb-input" rows="16" spellcheck="false">{text}</textarea>;
		$out.textContent = ""; $out.append(<strong>{rel}</strong>, $ta);
		$out.append(<div className="nx-tb-actions">{btn("Save", async () => {
			if (rel.endsWith(".xml")) { const r = rel.endsWith("AndroidManifest.xml") ? validateManifest($ta.value) : (checkXml($ta.value).ok ? [] : [checkXml($ta.value).error]); if (r.length) throw new Error(`Not saved: ${r.join("; ")}`); }
			await pm.writeText(current.id, rel, $ta.value); say("Saved");
		})}{btn("Back", structure)}</div>);
	}
	async function check() {
		const p = need(); const files = await pm.listFiles(p.id); const mf = files.find((f) => f.endsWith("AndroidManifest.xml")); if (!mf) throw new Error("No AndroidManifest.xml found");
		const problems = validateManifest(await pm.readText(p.id, mf));
		say(problems.length ? `Manifest problems:\n- ${problems.join("\n- ")}` : "Manifest looks valid (static check only - a real build is the final test).", problems.length > 0);
	}
	async function version() {
		const p = need(); const g = (await pm.listFiles(p.id)).find((f) => f.endsWith("app/build.gradle.kts")); if (!g) throw new Error("app/build.gradle.kts not found (only Kotlin-DSL Gradle files are supported)");
		let text = await pm.readText(p.id, g); const v = readGradleValues(text);
		const name = await prompt(`versionName (now ${v.versionName})`, v.versionName || "1.0.0", "text"); if (!name) return;
		const code = await prompt(`versionCode (now ${v.versionCode})`, String((Number(v.versionCode) || 0) + 1), "number"); if (!code) return;
		text = setGradleValue(setGradleValue(text, "versionName", name), "versionCode", String(code)); await pm.writeText(p.id, g, text); say(`Updated to ${name} (${code})`);
	}
	$page.body = (
		<div className="nx-tb-body scroll">
			<p className="nx-tb-hint">Android projects are built in GitHub Actions on your own repository; building an APK directly on the phone is not supported.</p>
			<div className="nx-tb-actions">{btn("New project", create)}{btn("Choose", pick)}</div>
			<div className="nx-tb-actions">{btn("Structure", structure)}{btn("Check manifest", check)}{btn("Version", version)}</div>
			<div className="nx-tb-actions">{btn("Open in editor", async () => { const p = need(); pm.touch(p.id); openFolder(p.path, { name: p.name }); $page.hide(); })}{btn("Git Studio", async () => (await import("pages/git")).default())}{btn("Deploy / builds", async () => (await import("pages/deploy")).default())}</div>
			{$msg}{$out}
		</div>
	);
	actionStack.push({ id: "app-studio", action: $page.hide });
	$page.onhide = () => actionStack.remove("app-studio");
	app.append($page);
}
