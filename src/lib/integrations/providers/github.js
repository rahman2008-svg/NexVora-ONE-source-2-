import { callJson, ProviderError } from "../http.js";

export const GITHUB = {
	id: "github",
	name: "GitHub",
	auth: ["device", "token"],
	deviceUrl: "https://github.com/login/device/code",
	tokenUrl: "https://github.com/login/oauth/access_token",
	// Least privilege: `repo` is required for private clone/push; `workflow` only to dispatch Actions.
	scopes: { minimal: "public_repo", private: "repo", actions: "repo workflow" },
	scopeInfo: "public_repo: public repositories only. repo: private repositories too. workflow: trigger GitHub Actions.",
};

export function createGitHub({ token, transport, apiBase = "https://api.github.com" }) {
	const call = (path, o = {}) =>
		callJson(transport, { ...o, url: path.startsWith("http") ? path : apiBase + path, secrets: [token],
			headers: { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", Accept: "application/vnd.github+json", ...(o.headers || {}) } });
	return {
		async getIdentity() {
			const { data, headers } = await call("/user");
			return { id: String(data.id), login: data.login, name: data.name || data.login, email: data.email || null, avatar: data.avatar_url || null,
				scopes: (headers?.["x-oauth-scopes"] ?? headers?.["X-OAuth-Scopes"] ?? "").split(",").map((s) => s.trim()).filter(Boolean) };
		},
		async listRepos({ maxPages = 5 } = {}) {
			const out = [];
			let url = "/user/repos?per_page=100&sort=updated";
			for (let i = 0; i < maxPages && url; i++) {
				const { data, headers } = await call(url);
				out.push(...data.map((r) => ({ id: r.id, fullName: r.full_name, private: r.private, cloneUrl: r.clone_url, sshUrl: r.ssh_url, defaultBranch: r.default_branch, permissions: r.permissions || {} })));
				const link = headers?.link ?? headers?.Link ?? "";
				url = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1] || null;
			}
			return out;
		},
		async getReadme(fullName) {
			const { data } = await call(`/repos/${fullName}/readme`);
			return new TextDecoder().decode(Uint8Array.from(atob(String(data.content).replace(/\s/g, "")), (c) => c.charCodeAt(0)));
		},
		async createRepo({ name, description = "", private: isPrivate = true }) {
			if (!/^[\w.-]{1,100}$/.test(name || "")) throw new ProviderError("Invalid repository name");
			const { data } = await call("/user/repos", { method: "POST", body: { name, description, private: isPrivate } });
			return { fullName: data.full_name, cloneUrl: data.clone_url, private: data.private };
		},
		async listWorkflowRuns(fullName, { perPage = 10 } = {}) {
			const { data } = await call(`/repos/${fullName}/actions/runs?per_page=${perPage}`);
			return data.workflow_runs.map((r) => ({ id: r.id, name: r.name, status: r.status, conclusion: r.conclusion, branch: r.head_branch, url: r.html_url, createdAt: r.created_at }));
		},
		async listRunJobs(fullName, runId) {
			const { data } = await call(`/repos/${fullName}/actions/runs/${runId}/jobs`);
			return data.jobs.map((j) => ({ id: j.id, name: j.name, status: j.status, conclusion: j.conclusion, steps: (j.steps || []).map((s) => ({ name: s.name, status: s.status, conclusion: s.conclusion })) }));
		},
		async dispatchWorkflow(fullName, workflow, ref, inputs = {}) {
			await call(`/repos/${fullName}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, { method: "POST", body: { ref, inputs } });
			return { dispatched: true }; // GitHub returns 204; run status must be polled via listWorkflowRuns
		},
		/** HTTPS git credentials for this account (never log the result). */
		gitCredentials(login) { return { username: login || "x-access-token", password: token }; },
	};
}
