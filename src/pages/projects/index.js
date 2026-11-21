import Page from "components/page";
import confirm from "dialogs/confirm";
import prompt from "dialogs/prompt";
import select from "dialogs/select";
import fsOperation from "fileSystem";
import actionStack from "lib/actionStack";
import openFolder from "lib/openFolder";
import { createAppFs } from "lib/projects/appFs";
import { createProjectManager } from "lib/projects/manager";
import { TEMPLATES } from "lib/projects/templates";
import FileBrowser from "pages/fileBrowser";

const bytesOf = async (url) => new Uint8Array(await fsOperation(url).readFile());
const fmt = (n) => (n > 2 ** 20 ? `${(n / 2 ** 20).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Projects: create, open, import/export ZIP, duplicate, rename, favorite, backup & restore. */
export default function openProjects() {
	const base = window.cordova?.file?.externalDataDirectory || window.cordova?.file?.dataDirectory;
	if (!base) return window.toast("Storage is unavailable on this device.", 3500);
	const pm = createProjectManager({ fs: createAppFs(fsOperation), meta: window.localStorage, root: `${base}projects` });
	const $page = Page("Projects");
	$page.classList.add("nx-toolbox", "nx-projects");
	const $msg = <p className="nx-tb-hint"></p>;
	const $search = <input className="nx-tb-select" type="search" placeholder="Search projects" />;
	const $list = <div className="nx-api-history"></div>;
	const say = (t, err) => { $msg.textContent = t || ""; $msg.style.color = err ? "#ff526d" : ""; };
	const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { if (!e?.needsConfirmation) say(e?.message || String(e), true); } };

	function render() {
		$list.textContent = "";
		const items = pm.list({ search: $search.value });
		if (!items.length) $list.textContent = "No projects yet. Create one, import a ZIP, or add an existing folder.";
		for (const p of items) $list.append(<div className="nx-row" onclick={guard(() => menu(p))}><span>{p.favorite ? "★ " : ""}{p.name}</span></div>);
		pm.storageUsage().then((n) => { $msg.textContent ||= `${items.length} project(s), ${fmt(n)} used`; }).catch(() => {});
	}
	async function menu(p) {
		const act = await select(p.name, [["open", "Open in editor"], ["fav", p.favorite ? "Remove favorite" : "Add to favorites"], ["rename", "Rename"], ["dup", "Duplicate"], ["zip", "Export as ZIP"], ["bk", "Backup (verified ZIP)"], ["rm", "Remove"]]);
		if (act === "open") { pm.touch(p.id); openFolder(p.path, { name: p.name }); $page.hide(); }
		if (act === "fav") pm.setFavorite(p.id, !p.favorite);
		if (act === "rename") { const n = await prompt("New name", p.name, "text"); if (n) await pm.rename(p.id, n); }
		if (act === "dup") { const n = await prompt("Name for the copy", `${p.name} copy`, "text"); if (n) { await pm.duplicate(p.id, n); say("Duplicated"); } }
		if (act === "zip" || act === "bk") {
			const bytes = await (act === "zip" ? pm.exportZip(p.id) : pm.backup(p.id));
			const dir = await FileBrowser("folder", "Choose where to save");
			const name = `${p.name}${act === "bk" ? ".nexvora-backup" : ""}.zip`;
			const target = `${dir.url.replace(/\/$/, "")}/${name}`;
			if ((await fsOperation(target).exists()) && !(await confirm("Overwrite", `${name} exists. Overwrite?`))) return;
			await ((await fsOperation(target).exists()) ? fsOperation(target).writeFile(bytes.buffer) : fsOperation(dir.url).createFile(name, bytes.buffer));
			say(`Saved ${name} (${fmt(bytes.length)})`);
		}
		if (act === "rm") {
			if (!(await confirm("Remove project", `Remove "${p.name}" from the list? Files stay on the device.`))) return;
			const del = await confirm("Delete files too?", `Also permanently delete the files of "${p.name}"? This cannot be undone.`);
			await pm.remove(p.id, { confirmed: true, deleteFiles: del });
		}
		render();
	}
	async function create() {
		const tpl = await select("Template", Object.entries(TEMPLATES).map(([id, t]) => [id, t.label]));
		const name = tpl && (await prompt("Project name", "", "text")); if (!name) return;
		const p = await pm.create({ name, template: tpl }); say(`Created ${p.name}`); render();
	}
	async function importZip() {
		const f = await FileBrowser("file", "Select a ZIP file");
		const bytes = await bytesOf(f.url);
		const name = await prompt("Project name", f.name.replace(/\.zip$/i, ""), "text"); if (!name) return;
		try { await pm.importZip(bytes, { name }); }
		catch (e) { if (e.code === "EXISTS" && (await confirm("Overwrite", `"${name}" exists. Merge/overwrite files from the ZIP into it?`))) await pm.importZip(bytes, { name, overwrite: true }); else throw e; }
		say("Imported"); render();
	}
	async function restore() {
		const f = await FileBrowser("file", "Select a NexVora backup (.zip)");
		const bytes = await bytesOf(f.url); const info = await pm.inspectBackup(bytes);
		if (!info.valid) return say(`Invalid backup: ${info.problems.slice(0, 3).join("; ")}`, true);
		const name = await prompt(`Restore "${info.manifest.project}" as`, info.manifest.project, "text"); if (!name) return;
		try { const r = await pm.restore(bytes, { name }); say(`Restored ${r.restored} files`); }
		catch (e) { if (e.code === "CONFLICTS" && (await confirm("Overwrite files?", `${e.conflicts.length} existing file(s) will be overwritten, e.g.\n${e.conflicts.slice(0, 5).join("\n")}`))) { const r = await pm.restore(bytes, { name, overwrite: true }); say(`Restored ${r.restored} files (${r.overwritten.length} overwritten)`); } else throw e; }
		render();
	}
	async function addFolder() { const d = await FileBrowser("folder", "Select an existing project folder"); await pm.open(d.url, d.name); render(); }

	$search.oninput = render;
	render();
	const btn = (t, fn) => <button type="button" onclick={guard(fn)}>{t}</button>;
	$page.body = (
		<div className="nx-tb-body scroll">
			<div className="nx-tb-actions">{btn("New", create)}{btn("Import ZIP", importZip)}{btn("Add folder", addFolder)}</div>
			<div className="nx-tb-actions">{btn("Restore backup", restore)}</div>
			{$search}{$msg}{$list}
		</div>
	);
	actionStack.push({ id: "projects", action: $page.hide });
	$page.onhide = () => actionStack.remove("projects");
	app.append($page);
}
