import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { credentialsForRemote, providerForUrl } from "../../src/lib/git/credentials.js";
import { createCredentialStore, createMemoryBackend } from "../../src/lib/integrations/credentialStore.js";
import { createAccountManager } from "../../src/lib/integrations/registry.js";

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
describe("git credentials", () => {
	test("provider detection for https, ssh and scp forms; unknown hosts give null", () => {
		assert.equal(providerForUrl("https://github.com/a/b.git"), "github");
		assert.equal(providerForUrl("git@gitlab.com:a/b.git"), "gitlab");
		assert.equal(providerForUrl("ssh://git@bitbucket.org/a/b.git"), "bitbucket");
		assert.equal(providerForUrl("https://example.com/a/b"), null);
		assert.equal(providerForUrl("garbage"), null);
		assert.equal(providerForUrl(""), null);
	});
	test("credentials come only from the connected user's own account", async () => {
		const store = createCredentialStore({ meta: mem(), secure: createMemoryBackend() });
		const mgr = createAccountManager({ store, transport: async () => ({ status: 200, headers: {}, body: "{}" }) });
		assert.equal(await credentialsForRemote(mgr, "https://github.com/a/b.git"), null); // not connected
		await store.add({ id: "github:1", provider: "github", login: "alice" }, "ghp_ALICE");
		assert.deepEqual(await credentialsForRemote(mgr, "https://github.com/a/b.git"), { username: "alice", password: "ghp_ALICE" });
		assert.equal(await credentialsForRemote(mgr, "https://gitlab.com/a/b.git"), null); // no cross-provider reuse
		assert.equal(await credentialsForRemote(mgr, "https://evil.example/a/b.git"), null); // never sent to unknown hosts
	});
});
