// Provider-independent integration layer: provider metadata + AccountManager.
import { GITHUB, createGitHub } from "./providers/github.js";
import { GITLAB, createGitLab } from "./providers/gitlab.js";
import { BITBUCKET, createBitbucket } from "./providers/bitbucket.js";
import { VERCEL, createVercel } from "./providers/vercel.js";
import { RENDER, createRender } from "./providers/render.js";
import { requestDeviceCode, pollDeviceToken } from "./oauth.js";
import { ProviderError } from "./http.js";

export const PROVIDERS = {
	github: { meta: GITHUB, kind: "git", create: createGitHub },
	gitlab: { meta: GITLAB, kind: "git", create: createGitLab },
	bitbucket: { meta: BITBUCKET, kind: "git", create: createBitbucket },
	vercel: { meta: VERCEL, kind: "deploy", create: createVercel },
	render: { meta: RENDER, kind: "deploy", create: createRender },
};

export function createAccountManager({ store, transport, apiBases = {}, sleepFn, now }) {
	const adapterFor = (provider, token, extra = {}) => {
		const p = PROVIDERS[provider];
		if (!p) throw new ProviderError(`Unknown provider ${provider}`);
		return p.create({ token, transport, ...(apiBases[provider] ? { apiBase: apiBases[provider] } : {}), ...extra });
	};
	async function register(provider, token, extra = {}) {
		const adapter = adapterFor(provider, token, extra);
		const who = await adapter.getIdentity(); // validates the credential against the provider
		const account = { id: `${provider}:${who.id}`, provider, login: who.login, name: who.name, email: who.email, avatar: who.avatar, scopes: who.scopes || [], username: extra.username };
		await store.add(account, token);
		return account;
	}
	return {
		providers: () => Object.values(PROVIDERS).map((p) => ({ id: p.meta.id, name: p.meta.name, kind: p.kind, auth: p.meta.auth, scopeInfo: p.meta.scopeInfo })),
		/** Status per provider for the Connected Accounts UI. */
		status() {
			return Object.values(PROVIDERS).map((p) => {
				const accounts = store.list(p.meta.id);
				const active = accounts.find((a) => a.id === store.activeId(p.meta.id)) || null;
				return { provider: p.meta.id, name: p.meta.name, connected: !!active, active, accounts, securePersistent: store.persistent };
			});
		},
		connectWithToken: async (provider, { token, username }) => {
			if (!token?.trim()) throw new ProviderError("Token is empty");
			if (provider === "bitbucket" && !username?.trim()) throw new ProviderError("Bitbucket needs your username");
			return register(provider, token.trim(), { username: username?.trim() });
		},
		/** GitHub device flow with the user's own OAuth app client ID. No secret is involved. */
		async startDeviceFlow(provider, { clientId, scope }) {
			const meta = PROVIDERS[provider]?.meta;
			if (!meta?.deviceUrl) throw new ProviderError(`${provider} does not support device sign-in here; use a token`);
			const dc = await requestDeviceCode(transport, { deviceUrl: meta.deviceUrl, clientId, scope: scope || meta.scopes.minimal });
			const ctl = new AbortController();
			return {
				userCode: dc.userCode,
				verificationUri: dc.verificationUri,
				cancel: () => ctl.abort(),
				wait: async () => {
					const tok = await pollDeviceToken(transport, { tokenUrl: meta.tokenUrl, clientId, deviceCode: dc.deviceCode, interval: dc.interval, expiresIn: dc.expiresIn }, { signal: ctl.signal, sleepFn, now });
					return register(provider, tok.accessToken);
				},
			};
		},
		switchAccount: (provider, id) => store.switchActive(provider, id),
		disconnect: (id) => store.remove(id),
		/** Adapter bound to the ACTIVE account of a provider, or null if not connected. */
		async adapter(provider) {
			const id = store.activeId(provider);
			if (!id) return null;
			const token = await store.token(id);
			if (!token) return null;
			const acc = store.list(provider).find((a) => a.id === id);
			return adapterFor(provider, token, { username: acc?.username });
		},
	};
}
