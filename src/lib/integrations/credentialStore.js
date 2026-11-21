// Account metadata lives in plain storage; secrets live ONLY in a secure backend.
// Backend contract: { persistent: boolean, get(key), set(key,value), remove(key) } (async).

export function createMemoryBackend() {
	const m = new Map();
	return { persistent: false, async get(k) { return m.get(k) ?? null; }, async set(k, v) { m.set(k, v); }, async remove(k) { m.delete(k); } };
}

/** Android Keystore-backed EncryptedSharedPreferences via the SecureStore Cordova plugin. */
export function createAndroidSecureBackend(cordovaExec) {
	const call = (action, args) => new Promise((ok, fail) => cordovaExec(ok, fail, "SecureStore", action, args));
	return {
		persistent: true,
		get: async (k) => (await call("get", [k])) || null,
		set: (k, v) => call("set", [k, v]),
		remove: (k) => call("remove", [k]),
	};
}

export function createCredentialStore({ meta, secure }) {
	const KEY = "nexvora.accounts.v1";
	const read = () => {
		try { return JSON.parse(meta.getItem(KEY)) || { accounts: [], active: {} }; } catch { return { accounts: [], active: {} }; }
	};
	const write = (v) => meta.setItem(KEY, JSON.stringify(v));
	return {
		persistent: secure.persistent,
		list: (provider) => read().accounts.filter((a) => !provider || a.provider === provider),
		activeId: (provider) => read().active[provider] || null,
		async add(account, token) {
			if (!token) throw new Error("Empty credential");
			await secure.set(`token:${account.id}`, token);
			const s = read();
			s.accounts = [...s.accounts.filter((a) => a.id !== account.id), { ...account, addedAt: new Date().toISOString() }];
			s.active[account.provider] = account.id;
			write(s);
		},
		async token(id) { return secure.get(`token:${id}`); },
		switchActive(provider, id) {
			const s = read();
			if (!s.accounts.some((a) => a.id === id && a.provider === provider)) throw new Error("Unknown account");
			s.active[provider] = id;
			write(s);
		},
		async remove(id) {
			await secure.remove(`token:${id}`);
			const s = read();
			const acc = s.accounts.find((a) => a.id === id);
			s.accounts = s.accounts.filter((a) => a.id !== id);
			if (acc && s.active[acc.provider] === id) {
				const next = s.accounts.find((a) => a.provider === acc.provider);
				if (next) s.active[acc.provider] = next.id; else delete s.active[acc.provider];
			}
			write(s);
		},
	};
}
