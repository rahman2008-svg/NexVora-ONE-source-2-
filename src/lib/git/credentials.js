// Maps a remote URL to the connected account of the matching provider (the user's own account).
const HOSTS = { "github.com": "github", "gitlab.com": "gitlab", "bitbucket.org": "bitbucket" };

export function providerForUrl(url) {
	const u = String(url || "").trim();
	let host = null;
	const scp = /^[\w.-]+@([\w.-]+):/.exec(u);
	if (scp) host = scp[1];
	else { try { host = new URL(u).hostname; } catch { return null; } }
	return HOSTS[host.toLowerCase()] || null;
}

/** @returns {Promise<{username:string,password:string}|null>} null when the user has no account for that host */
export async function credentialsForRemote(manager, url) {
	const provider = providerForUrl(url);
	if (!provider) return null;
	const adapter = await manager.adapter(provider);
	if (!adapter?.gitCredentials) return null;
	const active = manager.status().find((s) => s.provider === provider)?.active;
	return adapter.gitCredentials(active?.username || active?.login);
}
