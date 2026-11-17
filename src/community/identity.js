import { readLocalStorage, writeLocalStorage } from "../utils/BrowserStorage.js";

/**
 * The anonymous community ID and the on/off switch live in this browser's localStorage
 * (and travel with the data backup). JMComic-Next keeps its own version of this file
 * that stores them on its server instead.
 */
const KEY = "jm_community";

const randomId = () => {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

class CommunityIdentity {
    #read() {
        let data = null;
        try { data = JSON.parse(readLocalStorage(KEY) || "null"); } catch { /* replaced below */ }
        const state = {
            clientId: typeof data?.clientId === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(data.clientId) ? data.clientId : randomId(),
            enabled: data?.enabled !== false,
        };
        if (state.clientId !== data?.clientId || state.enabled !== data?.enabled) writeLocalStorage(KEY, JSON.stringify(state));
        return state;
    }

    async get() { return this.#read(); }

    async setEnabled(enabled) {
        const state = { ...this.#read(), enabled: Boolean(enabled) };
        if (!writeLocalStorage(KEY, JSON.stringify(state))) throw new Error("浏览器不允许保存设置");
        window.dispatchEvent(new CustomEvent("jm-community-change", { detail: state }));
        return state;
    }
}

export const communityIdentity = new CommunityIdentity();
