import Page from "components/page";
import confirm from "dialogs/confirm";
import prompt from "dialogs/prompt";
import fsOperation from "fileSystem";
import actionStack from "lib/actionStack";
import {
	buildMessages, checkServer, chatStream, createConversationStore, createEndpointStore,
	exportConversation, splitCodeBlocks, validateEndpoint,
} from "lib/ai/client";
import { createModelManager, fileNameFromUrl, formatBytes } from "lib/ai/models";
import { createAndroidSecureBackend, createMemoryBackend } from "lib/integrations/credentialStore";
import FileBrowser from "pages/fileBrowser";

const QUICK = {
	"Explain this code": "Explain what this code does, step by step:",
	"Fix bug in my code": "Find and fix the bug in this code. Show the corrected code:",
	"Generate code": "Write code for the following task:",
	"Improve performance": "Suggest performance improvements for this code, with the revised code:",
	"Write documentation": "Write clear documentation comments for this code:",
};

/** AI Studio: chat with YOUR OWN local/OpenAI-compatible server. No cloud account required. */
export default function openAiStudio() {
	const secure = window.cordova?.exec ? createAndroidSecureBackend(window.cordova.exec.bind(window.cordova)) : createMemoryBackend();
	const endpoints = createEndpointStore({ meta: window.localStorage, secure });
	const convos = createConversationStore(window.localStorage);
	const models = window.Executor ? createModelManager((c) => window.Executor.BackgroundExecutor.execute(c, true)) : null;
	let convo = convos.create("New chat");
	let abort = null;
	let cfg = null; // resolved active profile

	const $page = Page("AI Studio");
	$page.classList.add("nx-toolbox", "nx-ai");
	const $status = <p className="nx-tb-hint"></p>;
	const $chat = <div className="nx-ai-chat"></div>;
	const $input = <textarea className="nx-tb-input" rows="3" placeholder="Ask anything about your code..."></textarea>;
	const $panel = <div className="nx-db-out"></div>;
	const say = (t, err) => { $status.textContent = t || ""; $status.style.color = err ? "#ff526d" : ""; };

	const bubble = (m) => {
		const $b = <div className={`nx-ai-msg ${m.role}`}></div>;
		for (const part of splitCodeBlocks(m.content)) {
			if (part.type === "text") $b.append(<p>{part.text}</p>);
			else {
				const $code = <pre className="nx-tb-output">{part.text}</pre>;
				$b.append($code, <button type="button" onclick={() => { cordova.plugins.clipboard.copy(part.text); window.toast("Copied", 1200); }}>Copy code</button>);
			}
		}
		if (m.role === "assistant") $b.append(<button type="button" onclick={() => { cordova.plugins.clipboard.copy(m.content); window.toast("Copied", 1200); }}>Copy</button>);
		return $b;
	};
	const renderChat = () => { $chat.textContent = ""; for (const m of convo.messages) $chat.append(bubble(m)); $chat.scrollTop = $chat.scrollHeight; };

	async function activate() {
		const a = endpoints.active();
		cfg = a ? await endpoints.resolve(a.id) : null;
		if (!cfg) return say("No AI server configured. Open Connection to add your own local server (llama.cpp, Ollama, LM Studio...).", true);
		const r = await checkServer(cfg);
		say(r.ok ? `${r.message}${cfg.model ? ` - using ${cfg.model}` : " - choose a model in Connection"}` : r.message, !r.ok);
	}

	async function send() {
		const text = $input.value.trim();
		if (!text) return;
		if (!cfg) return say("Configure a server first (Connection).", true);
		const history = convo.messages.slice();
		convo.messages.push({ role: "user", content: text });
		if (convo.messages.length === 1) convo.title = text.slice(0, 40);
		const reply = { role: "assistant", content: "" };
		convo.messages.push(reply);
		$input.value = ""; renderChat();
		abort = new AbortController();
		const $live = $chat.lastChild;
		try {
			say("Generating...");
			await chatStream({ ...cfg, signal: abort.signal }, buildMessages({ system: cfg.system, history, user: text, maxTurns: cfg.maxTurns }), (t) => { reply.content += t; $live.firstChild && ($live.firstChild.textContent = reply.content); });
			say("");
		} catch (e) {
			if (!reply.content) convo.messages.pop();
			say(e.message, e.message !== "Stopped");
		} finally { abort = null; convos.save(convo); renderChat(); }
	}

	const selectionText = () => { try { const ed = editorManager.editor; const s = ed.state.sliceDoc(ed.state.selection.main.from, ed.state.selection.main.to); return s || ""; } catch { return ""; } };
	function quick(label) {
		const code = selectionText();
		$input.value = `${QUICK[label]}${code ? `\n\n\`\`\`\n${code}\n\`\`\`` : "\n"}`;
		if (!code) say("Tip: select code in the editor first to include it.");
	}

	function connection() {
		const cur = endpoints.active() || { name: "Local llama.cpp", baseUrl: "http://127.0.0.1:8080", model: "", system: "", temperature: 0.7, maxTurns: 12 };
		const $name = <input className="nx-tb-select" value={cur.name} placeholder="Profile name" />;
		const $url = <input className="nx-tb-select" value={cur.baseUrl} placeholder="http://127.0.0.1:8080 or https://..." />;
		const $key = <input className="nx-tb-select" type="password" placeholder={cur.hasKey ? "API key stored (leave empty to keep)" : "API key (optional)"} autocomplete="off" />;
		const $model = <select className="nx-tb-select"><option value={cur.model || ""}>{cur.model || "(check connection to load models)"}</option></select>;
		const $sys = <textarea className="nx-tb-input" rows="3" placeholder="System prompt">{cur.system}</textarea>;
		const $temp = <input className="nx-tb-select" type="number" step="0.1" min="0" max="2" value={cur.temperature} />;
		const $turns = <input className="nx-tb-select" type="number" min="1" max="50" value={cur.maxTurns} />;
		const probe = async () => { try { const r = await checkServer({ baseUrl: validateEndpoint($url.value), apiKey: $key.value || cfg?.apiKey }); say(r.message, !r.ok); if (r.ok) { $model.textContent = ""; for (const m of r.models) $model.append(<option value={m} selected={m === cur.model}>{m}</option>); } } catch (e) { say(e.message, true); } };
		const save = async () => { try { await endpoints.save({ id: cur.id, name: $name.value, baseUrl: $url.value, model: $model.value, system: $sys.value, temperature: Number($temp.value) || 0.7, maxTurns: Number($turns.value) || 12, hasKey: cur.hasKey }, $key.value || undefined); await activate(); say("Saved"); } catch (e) { say(e.message, true); } };
		const del = async () => { if (cur.id && (await confirm("Delete profile", `Delete ${cur.name} and its stored key?`))) { await endpoints.remove(cur.id); await activate(); $panel.textContent = ""; } };
		$panel.textContent = "";
		$panel.append($name, $url, $key, $model, $sys, $temp, $turns,
			<div className="nx-tb-actions"><button type="button" onclick={probe}>Check connection</button><button type="button" onclick={save}>Save</button><button type="button" onclick={del}>Delete</button></div>);
	}

	async function modelManager() {
		$panel.textContent = "";
		if (!models) return $panel.append(<p className="nx-tb-hint">The Linux plugin is unavailable on this device.</p>);
		const refresh = async () => {
			try {
				const [st, mem, list] = await Promise.all([models.storage(), models.memory(), models.list()]);
				$info.textContent = `Free storage: ${formatBytes(st.freeBytes)} - RAM available: ${formatBytes(mem.availableBytes)} of ${formatBytes(mem.totalBytes)}. A model needs roughly its file size in free RAM.`;
				$list.textContent = "";
				for (const m of list) {
					const $r = <div className="nx-row"><span>{m.name} ({formatBytes(m.sizeBytes)})</span></div>;
					$r.append(<button type="button" onclick={async (e) => { e.stopPropagation(); const v = await models.validate(m.name); say(v.valid ? "Valid GGUF file" : v.reason, !v.valid); }}>Validate</button>,
						<button type="button" onclick={async (e) => { e.stopPropagation(); try { say(await models.startServer(m.name)); } catch (er) { say(er.message, true); } }}>Serve</button>,
						<button type="button" onclick={async (e) => { e.stopPropagation(); if (await confirm("Delete model", `Delete ${m.name} (${formatBytes(m.sizeBytes)})?`)) { await models.remove(m.name); refresh(); } }}>Delete</button>);
					$list.append($r);
				}
				if (!list.length) $list.textContent = "No models downloaded. Paste an https:// link to a .gguf file below.";
			} catch (e) { say(`${e.message} - is the Linux environment installed? (Settings -> Terminal)`, true); }
		};
		const $info = <p className="nx-tb-hint"></p>; const $list = <div className="nx-api-history"></div>;
		const $url = <input className="nx-tb-select" type="url" placeholder="https://huggingface.co/.../model.gguf" />;
		const $prog = <p className="nx-tb-hint"></p>;
		const download = async () => {
			try {
				const url = $url.value.trim(); const total = await models.remoteSize(url);
				const name = fileNameFromUrl(url);
				if (!(await confirm("Download model", `${name}\n${total ? formatBytes(total) : "size unknown"}\nIt is stored in the Linux environment and never uploaded anywhere.`))) return;
				const job = await models.startDownload(url, name, total);
				const timer = setInterval(async () => { const p = await models.progress(job.name, job.totalBytes); $prog.textContent = `${job.name}: ${p.state} ${p.percent ?? ""}% (${formatBytes(p.bytes)}${job.totalBytes ? ` / ${formatBytes(job.totalBytes)}` : ""}) ${p.reason || ""}`; if (p.state !== "downloading") { clearInterval(timer); refresh(); } }, 2000);
			} catch (e) { say(e.message, true); }
		};
		$panel.append($info, $list, $url, <div className="nx-tb-actions"><button type="button" onclick={download}>Download</button></div>, $prog);
		refresh();
	}

	async function exportChat() {
		try {
			const dir = await FileBrowser("folder", "Choose where to save the conversation");
			await fsOperation(dir.url).createFile(`${convo.title.replace(/[^\w-]+/g, "_") || "chat"}.md`, new TextEncoder().encode(exportConversation(convo, "markdown")));
			say("Exported");
		} catch (e) { say(e?.message || String(e), true); }
	}
	function history() {
		$panel.textContent = "";
		for (const c of convos.list()) $panel.append(<div className="nx-row" onclick={() => { convo = convos.get(c.id); renderChat(); $panel.textContent = ""; }}><span>{c.title} - {c.updatedAt.slice(0, 10)}</span></div>);
		$panel.append(<div className="nx-tb-actions"><button type="button" onclick={async () => { if (await confirm("Clear history", "Delete ALL saved conversations?")) { convos.clear(); history(); } }}>Delete all</button></div>);
	}
	const clearChat = async () => { if (convo.messages.length && !(await confirm("Clear", "Clear this conversation?"))) return; convo = convos.create("New chat"); renderChat(); };

	$page.body = (
		<div className="nx-tb-body scroll">
			<div className="nx-tb-actions">
				<button type="button" onclick={connection}>Connection</button>
				<button type="button" onclick={modelManager}>Models</button>
				<button type="button" onclick={history}>History</button>
			</div>
			{$status}
			<div className="nx-tb-actions" style={{ flexWrap: "wrap" }}>{Object.keys(QUICK).map((k) => <button type="button" onclick={() => quick(k)}>{k}</button>)}</div>
			{$chat}{$panel}{$input}
			<div className="nx-tb-actions">
				<button type="button" onclick={send}>Send</button>
				<button type="button" onclick={() => abort?.abort()}>Stop</button>
				<button type="button" onclick={clearChat}>New</button>
				<button type="button" onclick={exportChat}>Export</button>
			</div>
		</div>
	);
	actionStack.push({ id: "ai-studio", action: () => { abort?.abort(); $page.hide(); } });
	$page.onhide = () => actionStack.remove("ai-studio");
	app.append($page);
	renderChat(); activate();
}
