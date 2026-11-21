import Page from "components/page";
import actionStack from "lib/actionStack";
import {
	METHODS,
	cordovaTransport,
	createStore,
	fetchTransport,
	sendRequest,
} from "lib/apiStudio/request";

/** Opens NexVora API Studio. */
export default function openApiStudio() {
	const store = createStore(window.localStorage);
	const transport = window.cordova?.plugin?.http
		? cordovaTransport(window.cordova.plugin.http)
		: fetchTransport;

	const $page = Page("API Studio");
	$page.classList.add("nx-toolbox", "nx-api");

	const $method = (
		<select className="nx-tb-select">
			{METHODS.map((m) => (
				<option value={m}>{m}</option>
			))}
		</select>
	);
	const $url = <input className="nx-tb-select" type="url" placeholder="https://api.example.com/items" />;
	const $params = <textarea className="nx-tb-input" rows="3" placeholder="Query params, one per line: key=value" spellcheck="false"></textarea>;
	const $headers = <textarea className="nx-tb-input" rows="3" placeholder="Headers, one per line: Key: value" spellcheck="false"></textarea>;
	const $body = <textarea className="nx-tb-input" rows="5" placeholder="Request body (JSON or raw text)" spellcheck="false"></textarea>;
	const $authType = (
		<select className="nx-tb-select">
			<option value="none">No auth</option>
			<option value="bearer">Bearer token</option>
			<option value="basic">Basic auth</option>
		</select>
	);
	const $token = <input className="nx-tb-select" type="password" placeholder="Token (never saved or logged)" autocomplete="off" />;
	const $user = <input className="nx-tb-select" type="text" placeholder="Username" autocomplete="off" />;
	const $pass = <input className="nx-tb-select" type="password" placeholder="Password (never saved or logged)" autocomplete="off" />;
	const $status = <p className="nx-tb-hint"></p>;
	const $respHeaders = <pre className="nx-tb-output"></pre>;
	const $respBody = <pre className="nx-tb-output"></pre>;
	const $history = <div className="nx-api-history"></div>;
	const $saveName = <input className="nx-tb-select" type="text" placeholder="Name to save this request" />;

	const refreshAuth = () => {
		$token.style.display = $authType.value === "bearer" ? "" : "none";
		$user.style.display = $pass.style.display = $authType.value === "basic" ? "" : "none";
	};
	$authType.onchange = refreshAuth;
	refreshAuth();

	const spec = () => ({
		method: $method.value,
		url: $url.value,
		params: $params.value,
		headers: $headers.value,
		body: $body.value,
		auth: { type: $authType.value, token: $token.value, username: $user.value, password: $pass.value },
	});

	const loadSpec = (s) => {
		$method.value = s.method || "GET";
		$url.value = s.url || "";
		$params.value = s.params || "";
		$headers.value = s.headers || "";
		$body.value = s.body || "";
		$authType.value = s.auth?.type || "none";
		refreshAuth();
	};

	const renderHistory = () => {
		const { history, saved } = store.list();
		$history.textContent = "";
		const add = (label, onTap) => {
			const $row = <div className="nx-row" onclick={onTap}><span>{label}</span></div>;
			$history.append($row);
		};
		for (const s of saved) add(`★ ${s.name} - ${s.spec.method} ${s.spec.url}`, () => loadSpec(s.spec));
		for (const h of history.slice(0, 10))
			add(`${h.status} ${h.request.method} ${h.request.url}`, () =>
				loadSpec({ method: h.request.method, url: h.request.url, body: h.request.body }),
			);
		if (!saved.length && !history.length) $history.textContent = "No requests yet.";
	};

	const send = async () => {
		$respBody.classList.remove("error");
		$status.textContent = "Sending...";
		$respHeaders.textContent = "";
		$respBody.textContent = "";
		try {
			const r = await sendRequest(spec(), { transport });
			$status.textContent = `${r.status} - ${r.timeMs} ms - ${r.sizeBytes} bytes`;
			$respHeaders.textContent = Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`).join("\n");
			$respBody.textContent = r.body;
			store.addHistory({ request: r.request, status: r.status });
			renderHistory();
		} catch (e) {
			$status.textContent = "Failed";
			$respBody.classList.add("error");
			$respBody.textContent = e?.message || String(e);
		}
	};
	const copy = () => {
		if (!$respBody.textContent) return window.toast("Nothing to copy", 1500);
		cordova.plugins.clipboard.copy($respBody.textContent);
		window.toast("Copied", 1500);
	};
	const save = () => {
		const name = $saveName.value.trim();
		if (!name) return window.toast("Enter a name first", 2000);
		store.saveRequest(name, spec());
		renderHistory();
		window.toast("Saved (credentials are not stored)", 2500);
	};
	const clearHistory = () => {
		store.clearHistory();
		renderHistory();
	};

	renderHistory();
	$page.body = (
		<div className="nx-tb-body scroll">
			{$method}
			{$url}
			{$params}
			{$headers}
			{$authType}
			{$token}
			{$user}
			{$pass}
			{$body}
			<div className="nx-tb-actions">
				<button type="button" onclick={send}>Send</button>
				<button type="button" onclick={copy}>Copy response</button>
			</div>
			{$status}
			<pre className="nx-tb-hint">Response headers</pre>
			{$respHeaders}
			<pre className="nx-tb-hint">Response body</pre>
			{$respBody}
			{$saveName}
			<div className="nx-tb-actions">
				<button type="button" onclick={save}>Save request</button>
				<button type="button" onclick={clearHistory}>Clear history</button>
			</div>
			{$history}
		</div>
	);

	actionStack.push({ id: "api-studio", action: $page.hide });
	$page.onhide = () => actionStack.remove("api-studio");
	app.append($page);
}
