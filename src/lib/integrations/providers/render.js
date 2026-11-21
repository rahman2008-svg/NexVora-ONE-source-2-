import { callJson, ProviderError } from "../http.js";
export const RENDER = { id: "render", name: "Render", auth: ["token"], scopeInfo: "API key created in your own Render account settings. Used to list services/deploys and trigger deploys." };
export function createRender({ token, transport, apiBase = "https://api.render.com/v1" }) {
	const call = (path, o = {}) => callJson(transport, { ...o, url: apiBase + path, secrets: [token], headers: { Authorization: `Bearer ${token}` } });
	return {
		async getIdentity() { const { data } = await call("/owners?limit=1"); const o = data?.[0]?.owner; if (!o) throw new ProviderError("No Render workspace found for this API key"); return { id: o.id, login: o.name, name: o.name, email: o.email || null, avatar: null, scopes: [] }; },
		async listServices() { const { data } = await call("/services?limit=100"); return data.map(({ service: s }) => ({ id: s.id, name: s.name, type: s.type, url: s.serviceDetails?.url || null, repo: s.repo || null })); },
		async listDeploys(serviceId, limit = 10) { const { data } = await call(`/services/${encodeURIComponent(serviceId)}/deploys?limit=${limit}`); return data.map(({ deploy: d }) => ({ id: d.id, status: d.status, createdAt: d.createdAt, finishedAt: d.finishedAt || null, commit: d.commit?.id || null })); },
		async triggerDeploy(serviceId, clearCache = false) { const { data } = await call(`/services/${encodeURIComponent(serviceId)}/deploys`, { method: "POST", body: { clearCache: clearCache ? "clear" : "do_not_clear" } }); return { id: data.id, status: data.status }; },
	};
}
