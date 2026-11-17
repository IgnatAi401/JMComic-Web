import { readLocalStorage } from "../utils/BrowserStorage.js";
import { communityIdentity } from "./identity.js";

/*
 * JMComic Community: anonymous online counter and shared recommendation list.
 * The server (separate public repo JMComic-Community) only ever receives a random ID,
 * never account names. Requests go straight from the browser, cross-origin.
 * Bodies are sent as text/plain so the browser skips the CORS preflight.
 */
const DEFAULT_ENDPOINT = "https://api.ignat.ai/jm/api";
const TIMEOUT_MS = 8000;
const UNREACHABLE = "暂时无法连接服务器，请稍后再试";

const endpoint = () => (readLocalStorage("jm_community_endpoint") || DEFAULT_ENDPOINT).replace(/\/+$/, "");

class CommunityApi {
    async request(path, { method = "GET", body = null, client = false } = {}) {
        const identity = await communityIdentity.get();
        if (!identity.enabled) throw Object.assign(new Error("社区功能已关闭"), { disabled: true });
        let url = `${endpoint()}${path}`;
        if (client && method === "GET") url += `${url.includes("?") ? "&" : "?"}client=${encodeURIComponent(identity.clientId)}`;
        const payload = body ? JSON.stringify({ ...body, client: identity.clientId }) : undefined;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        let response;
        try {
            response = await fetch(url, {
                method,
                body: payload,
                headers: payload ? { "Content-Type": "text/plain;charset=UTF-8" } : undefined,
                cache: "no-store",
                credentials: "omit",
                signal: controller.signal,
            });
        } catch {
            throw new Error(UNREACHABLE);
        } finally {
            clearTimeout(timer);
        }
        let data = {};
        try { data = await response.json(); } catch { /* handled below */ }
        if (!response.ok) throw Object.assign(new Error(data.error === "not recommended" ? "这本还没有人推荐" : response.status >= 500 ? UNREACHABLE : `社区服务错误 ${response.status}`), { status: response.status });
        return data;
    }

    heartbeat() { return this.request("/heartbeat", { method: "POST", body: {} }); }

    /** Tell the server this page went away. sendBeacon survives page unload; plain fetch may not. */
    async leave() {
        const identity = await communityIdentity.get().catch(() => null);
        if (!identity?.enabled) return;
        const body = JSON.stringify({ client: identity.clientId, leaving: true });
        const url = `${endpoint()}/heartbeat`;
        if (navigator.sendBeacon?.(url, new Blob([body], { type: "text/plain;charset=UTF-8" }))) return;
        fetch(url, { method: "POST", body, keepalive: true, credentials: "omit", headers: { "Content-Type": "text/plain;charset=UTF-8" } }).catch(() => {});
    }

    stats(hours = 24 * 7) { return this.request(`/stats?hours=${hours}`); }

    /** `sort` is "hot", "new" or "top"; every item carries `mine` for this client. */
    list(sort = "hot", page = 1) {
        return this.request(`/recommendations?sort=${encodeURIComponent(sort)}&page=${page}`, { client: true });
    }

    comic(id) { return this.request(`/comic/${encodeURIComponent(id)}`, { client: true }); }

    recommend(id) { return this.request("/recommend", { method: "POST", body: { comic: String(id) } }); }

    /** `vote` is "good", "bad" or null. */
    vote(id, vote) { return this.request("/vote", { method: "POST", body: { comic: String(id), vote } }); }

    /** Add (`on`) or remove one emoji reaction by its key. */
    react(id, reaction, on) { return this.request("/react", { method: "POST", body: { comic: String(id), reaction, on: Boolean(on) } }); }
}

export const communityApi = new CommunityApi();
