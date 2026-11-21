import { callJson } from "../http.js";
const b64 = (s) => { let x = ""; for (const b of new TextEncoder().encode(s)) x += String.fromCharCode(b); return btoa(x); };
export const BITBUCKET = { id: "bitbucket", name: "Bitbucket", auth: ["basic"], scopeInfo: "Username + app password/API token with repositories:read (and write to push)." };
export function createBitbucket({ username, token, transport, apiBase = "https://api.bitbucket.org/2.0" }) {
	const call = (path, o = {}) => callJson(transport, { ...o, url: path.startsWith("http") ? path : apiBase + path, secrets: [token], headers: { Authorization: `Basic ${b64(`${username}:${token}`)}` } });
	return {
		async getIdentity() { const { data } = await call("/user"); return { id: data.account_id || data.uuid, login: data.username || username, name: data.display_name, email: null, avatar: data.links?.avatar?.href || null, scopes: [] }; },
		async listRepos() {
			const out = []; let url = "/repositories?role=member&pagelen=100";
			for (let i = 0; i < 5 && url; i++) { const { data } = await call(url); out.push(...data.values.map((r) => ({ id: r.uuid, fullName: r.full_name, private: r.is_private, cloneUrl: r.links?.clone?.find((c) => c.name === "https")?.href, sshUrl: r.links?.clone?.find((c) => c.name === "ssh")?.href, defaultBranch: r.mainbranch?.name, permissions: {} }))); url = data.next || null; }
			return out;
		},
		gitCredentials(login) { return { username: login || username, password: token }; },
	};
}
