import Page from "components/page";
import confirm from "dialogs/confirm";
import prompt from "dialogs/prompt";
import actionStack from "lib/actionStack";
import { getAccountManager } from "lib/integrations";

const CLIENT_ID_KEY = "nexvora.github.clientId"; // an OAuth client ID is public, not a secret

/** Settings → Connected Accounts */
export default function openAccounts() {
	const mgr = getAccountManager();
	const $page = Page("Connected accounts");
	$page.classList.add("nx-toolbox", "nx-accounts");
	const $list = <div className="nx-acc-list"></div>;
	const $msg = <p className="nx-tb-hint"></p>;
	const say = (t, err) => {
		$msg.textContent = t || "";
		$msg.style.color = err ? "#ff526d" : "";
	};
	const fail = (e) => say(e?.message || String(e), true);

	function card(s) {
		const $c = <div className="nx-acc-card"></div>;
		const info = mgr.providers().find((p) => p.id === s.provider);
		$c.append(<strong>{s.name}</strong>);
		$c.append(<small>{s.connected ? `Connected as ${s.active.login}${s.active.name && s.active.name !== s.active.login ? ` (${s.active.name})` : ""}` : "Not connected"}</small>);
		if (s.connected && s.active.scopes?.length) $c.append(<small>Permissions: {s.active.scopes.join(", ")}</small>);
		$c.append(<small>{info.scopeInfo}</small>);
		if (!s.securePersistent) $c.append(<small style={{ color: "#ff526d" }}>Secure storage is unavailable: credentials are kept in memory only and will be lost on restart.</small>);

		const $actions = <div className="nx-tb-actions"></div>;
		const btn = (label, fn) => $actions.append(<button type="button" onclick={fn}>{label}</button>);

		if (s.accounts.length > 1) {
			const $sel = (
				<select className="nx-tb-select" onchange={() => { mgr.switchAccount(s.provider, $sel.value); render(); }}>
					{s.accounts.map((a) => <option value={a.id} selected={a.id === s.active?.id}>{a.login}</option>)}
				</select>
			);
			$c.append($sel);
		}
		if (s.connected) {
			btn("Disconnect", async () => {
				if (!(await confirmBox(`Disconnect ${s.active.login}? The stored token is deleted from this device.`))) return;
				try { await mgr.disconnect(s.active.id); say(""); } catch (e) { fail(e); }
				render();
			});
		}
		btn(s.connected ? "Add / reconnect" : "Connect", () => connect(s.provider, info));
		$c.append($actions);
		return $c;
	}

	async function connect(provider, info) {
		say("");
		const wantsDevice = info.auth.includes("device");
		if (wantsDevice) {
			const saved = window.localStorage.getItem(CLIENT_ID_KEY) || "";
			const clientId = await promptBox("GitHub OAuth client ID (from your own OAuth App with Device Flow enabled). Leave blank to use a token instead.", saved);
			if (clientId) {
				window.localStorage.setItem(CLIENT_ID_KEY, clientId);
				try {
					const flow = await mgr.startDeviceFlow(provider, { clientId });
					say(`Open ${flow.verificationUri} and enter code ${flow.userCode}`);
					system.openInBrowser(flow.verificationUri);
					await flow.wait();
					say("Connected.");
				} catch (e) { fail(e); }
				return render();
			}
		}
		const username = provider === "bitbucket" ? await promptBox("Bitbucket username") : undefined;
		const token = await promptBox(`${info.name} access token (stored encrypted on this device only)`, "", "password");
		if (!token) return;
		try {
			await mgr.connectWithToken(provider, { token, username });
			say("Connected.");
		} catch (e) { fail(e); }
		render();
	}

	function render() {
		$list.textContent = "";
		for (const s of mgr.status()) $list.append(card(s));
	}

	const confirmBox = (m) => confirm("Confirm", m);
	const promptBox = async (m, v = "", type = "text") => ((await prompt(m, v, type)) || "").toString().trim();

	render();
	$page.body = (
		<div className="nx-tb-body scroll">
			<p className="nx-tb-hint">Connect your own accounts. NexVora ONE never ships with developer credentials, and tokens are stored encrypted in the Android Keystore.</p>
			{$msg}
			{$list}
		</div>
	);
	actionStack.push({ id: "accounts", action: $page.hide });
	$page.onhide = () => actionStack.remove("accounts");
	app.append($page);
}
