import { callJson } from "../http.js";
export const GITLAB = { id: "gitlab", name: "GitLab", auth: ["token"], scopeInfo: "Personal access token with read_api, read_repository, write_repository." };
export function createGitLab({ token, transport, apiBase = "https://gitlab.com/api/v4" }) {
	const call = (path, o = {}) => callJson(transport, { ...o, url: apiBase + path, secrets: [token], headers: { "PRIVATE-TOKEN": token } });
	return {
		async getIdentity() { const { data } = await call("/user"); return { id: String(data.id), login: data.username, name: data.name || data.username, email: data.email || null, avatar: data.avatar_url || null, scopes: [] }; },
		async listRepos() { const { data } = await call("/projects?membership=true&per_page=100&order_by=last_activity_at"); return data.map((p) => ({ id: p.id, fullName: p.path_with_namespace, private: p.visibility !== "public", cloneUrl: p.http_url_to_repo, sshUrl: p.ssh_url_to_repo, defaultBranch: p.default_branch, permissions: {} })); },
		gitCredentials(login) { return { username: login || "oauth2", password: token }; },
	};
}
