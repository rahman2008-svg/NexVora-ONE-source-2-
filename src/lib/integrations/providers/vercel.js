import { callJson, ProviderError } from "../http.js";
export const VERCEL = { id: "vercel", name: "Vercel", auth: ["token"], scopeInfo: "Access token created in your own Vercel account settings (full-account scope; Vercel has no narrower personal tokens). Used to list projects/deployments and trigger redeploys." };
export function createVercel({ token, transport, apiBase = "https://api.vercel.com" }) {
	const call = (path, o = {}) => callJson(transport, { ...o, url: apiBase + path, secrets: [token], headers: { Authorization: `Bearer ${token}` } });
	return {
		async getIdentity() { const { data } = await call("/v2/user"); const u = data.user || data; return { id: u.id || u.uid, login: u.username, name: u.name || u.username, email: u.email || null, avatar: null, scopes: [] }; },
		async listProjects() { const { data } = await call("/v9/projects?limit=100"); return data.projects.map((p) => ({ id: p.id, name: p.name, framework: p.framework || null })); },
		async listDeployments(projectId, limit = 10) { const { data } = await call(`/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=${limit}`); return data.deployments.map((d) => ({ id: d.uid, url: d.url ? `https://${d.url}` : null, state: d.state || d.readyState, createdAt: d.created || d.createdAt, target: d.target || null })); },
		/** Redeploys an existing deployment of the user's own project. */
		async redeploy({ name, deploymentId, target = "production" }) {
			if (!name || !deploymentId) throw new ProviderError("name and deploymentId are required");
			const { data } = await call("/v13/deployments?forceNew=1", { method: "POST", body: { name, deploymentId, target } });
			return { id: data.id || data.uid, url: data.url ? `https://${data.url}` : null, state: data.readyState || data.status || "QUEUED" };
		},
	};
}
