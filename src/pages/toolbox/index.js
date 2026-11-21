import Page from "components/page";
import actionStack from "lib/actionStack";
import fsOperation from "fileSystem";
import { fitSize } from "lib/toolbox/format";
import FileBrowser from "pages/fileBrowser";
import { TOOLS, runTool } from "lib/toolbox/tools";

/** Opens the NexVora Developer Toolbox page. */
export default function openToolbox() {
	const $page = Page("Developer Toolbox");
	$page.classList.add("nx-toolbox");

	const $select = (
		<select className="nx-tb-select">
			{TOOLS.map((t) => (
				<option value={t.id}>{t.name}</option>
			))}
		</select>
	);
	const $hint = <p className="nx-tb-hint"></p>;
	const $input = <textarea className="nx-tb-input" rows="8" spellcheck="false"></textarea>;
	const $output = <pre className="nx-tb-output"></pre>;
	const current = () => TOOLS.find((t) => t.id === $select.value);
	const refreshHint = () => {
		$hint.textContent = current().hint;
	};
	$select.onchange = refreshHint;
	refreshHint();

	const run = async () => {
		$output.classList.remove("error");
		try {
			const res = await runTool(current(), $input.value);
			if (current().kind === "html") $output.innerHTML = res; // already sanitised by DOMPurify
			else $output.textContent = res;
		} catch (e) {
			$output.classList.add("error");
			$output.textContent = e?.message || String(e);
		}
	};
	const clear = () => { $input.value = ""; $output.textContent = ""; $output.classList.remove("error"); };
	const copy = () => {
		if (!$output.textContent) return;
		cordova.plugins.clipboard.copy($output.textContent);
		window.toast("Copied", 1500);
	};

	const $file = <input type="file" accept="image/png,image/jpeg,image/webp" className="nx-tb-select" />;
	const $max = <input type="number" className="nx-tb-select" min="16" max="8192" value="1600" placeholder="Max width/height (px)" />;
	const $q = <input type="number" className="nx-tb-select" min="10" max="100" value="80" placeholder="Quality 10-100" />;
	const $imgOut = <pre className="nx-tb-output"></pre>;
	const optimize = async () => {
		$imgOut.classList.remove("error");
		try {
			const f = $file.files?.[0]; if (!f) throw new Error("Pick an image first");
			if (f.size > 40 * 1024 * 1024) throw new Error("Image is larger than 40 MB");
			const bmp = await createImageBitmap(f); const { width, height } = fitSize(bmp.width, bmp.height, Number($max.value) || 0);
			const c = document.createElement("canvas"); c.width = width; c.height = height; c.getContext("2d").drawImage(bmp, 0, 0, width, height);
			const type = f.type === "image/png" ? "image/webp" : f.type; // PNG -> lossless-ish WebP keeps transparency
			const blob = await new Promise((r) => c.toBlob(r, type, Math.min(100, Math.max(10, Number($q.value) || 80)) / 100));
			if (!blob) throw new Error("This image could not be encoded");
			const save = document.createElement("button"); save.type = "button"; save.textContent = "Save optimized image...";
			save.onclick = async () => { try { const dir = await FileBrowser("folder", "Choose where to save"); const name = `${f.name.replace(/\.[^.]+$/, "")}-optimized.${type.split("/")[1]}`; if (await fsOperation(`${dir.url.replace(/\/$/, "")}/${name}`).exists()) throw new Error(`${name} already exists in that folder`); await fsOperation(dir.url).createFile(name, await blob.arrayBuffer()); window.toast(`Saved ${name}`, 2500); } catch (e) { window.toast(e?.message || String(e), 4000); } };
			$imgOut.textContent = `${bmp.width}x${bmp.height} (${Math.round(f.size / 1024)} KB) -> ${width}x${height} (${Math.round(blob.size / 1024)} KB)${blob.size >= f.size ? " - not smaller; keep the original" : ""}\n`; $imgOut.append(save);
		} catch (e) { $imgOut.classList.add("error"); $imgOut.textContent = e?.message || String(e); }
	};
	const $imgControls = <div className="nx-tb-body" style={{ padding: 0 }}>{$file}{$max}{$q}<div className="nx-tb-actions"><button type="button" onclick={optimize}>Optimize image</button></div></div>;

	$page.body = (
		<div className="nx-tb-body scroll">
			{$select}
			{$hint}
			{$input}
			<div className="nx-tb-actions">
				<button type="button" onclick={run}>Run</button>
				<button type="button" onclick={copy}>Copy output</button>
				<button type="button" onclick={clear}>Clear</button>
			</div>
			{$output}
			<pre className="nx-tb-hint">Image optimizer: pick an image, it is resized and re-encoded on this device (nothing is uploaded).</pre>
			{$imgControls}
			{$imgOut}
		</div>
	);

	actionStack.push({ id: "toolbox", action: $page.hide });
	$page.onhide = () => actionStack.remove("toolbox");
	app.append($page);
}
