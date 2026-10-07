import { setting } from "../core/Setting.js";
import { readCache, writeCache } from "../utils/BrowserCache.js";
import { readLocalStorage, removeLocalStorage, writeLocalStorage } from "../utils/BrowserStorage.js";
import { crypto, parseJsonText } from "./Crypto.js";
import { listingApiOrder, listingCategoryPath, normalizeListingFilters } from "../utils/ListingFilters.js";

/** Browser client for the public (anonymous) JM mobile API. */
class JmcomicApi {
    accessToken = null;
    currentKey = null;
    servers = [];
    initPromise = null;
    albumRequests = new Map();
    chapterRequests = new Map();
    albumMemoryLimit = 500;
    chapterMemoryLimit = 120;
    bootstrapFromCache = false;
    bootstrapMaxAge = 6 * 60 * 60 * 1000;
    bootstrapStorageKey = "jm_api_bootstrap_v1";

    imgServers = [
        "cdn-msp.jmapiproxy1.cc",
        "cdn-msp.jmapiproxy2.cc",
        "cdn-msp2.jmapiproxy2.cc",
        "cdn-msp3.jmapiproxy2.cc",
        "cdn-msp.jmapinodeudzn.net",
        "cdn-msp3.jmapinodeudzn.net",
    ];

    normalizeServers(value) {
        return (Array.isArray(value) ? value : [])
            .map((server) => String(server || "").trim().toLowerCase())
            .filter((server, index, all) => /^[a-z0-9.-]+$/.test(server) && server.includes(".") && all.indexOf(server) === index)
            .slice(0, 12);
    }

    readBrowserBootstrap() {
        try {
            const cached = JSON.parse(readLocalStorage(this.bootstrapStorageKey, "null"));
            if (Date.now() - Number(cached?.savedAt || 0) > this.bootstrapMaxAge) return [];
            return this.normalizeServers(cached?.servers);
        } catch {
            return [];
        }
    }

    saveBootstrap(servers) {
        const normalized = this.normalizeServers(servers);
        if (!normalized.length) return;
        writeLocalStorage(this.bootstrapStorageKey, JSON.stringify({ savedAt: Date.now(), servers: normalized }));
        writeCache("bootstrap", "servers", normalized);
    }

    async init(force = false) {
        if (force) {
            this.servers = [];
            this.bootstrapFromCache = false;
            removeLocalStorage(this.bootstrapStorageKey);
        }
        if (this.servers.length) return this.servers;
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            if (!force) {
                const browserCached = this.readBrowserBootstrap();
                if (browserCached.length) {
                    this.bootstrapFromCache = true;
                    this.servers = browserCached;
                    return this.servers;
                }
                const fileCached = this.normalizeServers(await readCache("bootstrap", "servers", 6 * 60 * 60));
                if (fileCached.length) {
                    this.bootstrapFromCache = true;
                    this.servers = fileCached;
                    this.saveBootstrap(fileCached);
                    return this.servers;
                }
            }
            const body = await this.retryFetch(
                "https://rup4a04-c02.tos-cn-hongkong.bytepluses.com/newsvr-2025.txt",
                {},
                2,
                (response) => response.text(),
            );
            const text = body.replace(/^\uFEFF/, "").trim();
            this.servers = this.normalizeServers(crypto.decryptCurrentApi(text).Server);
            if (!this.servers.length) throw new Error("未获取到可用 API 线路");
            this.bootstrapFromCache = false;
            this.saveBootstrap(this.servers);
            return this.servers;
        })();

        try {
            return await this.initPromise;
        } finally {
            this.initPromise = null;
        }
    }

    async #fetchWithTimeout(url, init = {}, timeoutMs = 12000, readBody = null) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, { ...init, signal: controller.signal });
            // Keep the timeout active until the response body finishes arriving.
            return readBody ? await readBody(response) : response;
        } finally {
            clearTimeout(timer);
        }
    }

    #createRequestAuth() {
        const key = Math.floor(Date.now() / 1000);
        const accessToken = {
            token: crypto.calculateMD5(key + "185Hcomic3PAPP7R"),
            tokenParam: `${key},3.2.0`,
        };
        this.currentKey = key;
        this.accessToken = accessToken;
        return { key, accessToken };
    }

    async retryFetch(getUrl, init = {}, count = 1, readBody = null) {
        if (typeof init === "number") {
            count = init;
            init = {};
        }
        const urlFactory = typeof getUrl === "function" ? getUrl : () => getUrl;
        let lastError;
        for (let attempt = 0; attempt < Math.max(1, count); attempt++) {
            try {
                return await this.#fetchWithTimeout(urlFactory(attempt), init, 12000, async (response) => {
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    return readBody ? await readBody(response) : response;
                });
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError || new Error("网络请求失败");
    }

    async #requestApi(path, {
        method = "GET",
        data = null,
        validate = null,
        retryBootstrap = true,
        maxServers = 5,
        timeoutMs = 12000,
    } = {}) {
        await this.init();
        const candidates = this.servers.slice(0, Math.max(1, Math.min(5, Number(maxServers) || 5)));
        let lastError;
        const readResponse = async (response) => {
            let payload;
            try {
                payload = typeof response.text === "function"
                    ? parseJsonText(await response.text())
                    : await response.json();
            } catch (error) {
                if (error?.name === "AbortError") throw error;
                if (response.ok) throw new Error("当前 API 线路返回了无效数据");
                payload = {};
            }
            if (!response.ok) {
                const detail = payload?.error || payload?.msg || payload?.message;
                throw new Error(`HTTP ${response.status}${typeof detail === "string" ? `：${detail}` : ""}`);
            }
            return { response, payload };
        };

        for (const server of candidates) {
            const { key, accessToken } = this.#createRequestAuth();
            const headers = { token: accessToken.token, tokenParam: accessToken.tokenParam };
            const options = {
                method,
                headers,
                credentials: "include",
                redirect: "follow",
            };
            if (data) {
                headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
                options.body = new URLSearchParams(data).toString();
            }

            try {
                const { response, payload } = await this.#fetchWithTimeout(`https://${server}${path}`, options, timeoutMs, readResponse);
                const result = typeof payload.data === "string"
                    ? crypto.decryptData(key, payload.data)
                    : (payload.data ?? payload);
                if (validate && !validate(result)) {
                    throw new Error("当前 API 线路返回了空数据");
                }
                let responseServer = server;
                if (response.url) {
                    try { responseServer = new URL(response.url).hostname || server; } catch {}
                }
                if (responseServer) {
                    const index = this.servers.indexOf(responseServer);
                    if (index > 0) {
                        this.servers.splice(index, 1);
                        this.servers.unshift(responseServer);
                        this.saveBootstrap(this.servers);
                    }
                }
                return { result, server: responseServer, payload };
            } catch (error) {
                lastError = error;
            }
        }
        if (retryBootstrap && this.bootstrapFromCache) {
            await this.init(true);
            return this.#requestApi(path, { method, data, validate, retryBootstrap: false, maxServers, timeoutMs });
        }
        throw lastError || new Error("所有 API 线路均请求失败");
    }

    async getSearchResults(searchQuery, page, {
        order = "mv",
        time = "a",
        category = "0",
        mainTag = "0",
    } = {}) {
        const effectiveOrder = listingApiOrder({ order, time });
        const query = new URLSearchParams({
            search_query: searchQuery,
            o: effectiveOrder,
            t: time,
            c: category,
            main_tag: mainTag,
            page,
        });
        return (await this.#requestApi(`/search?${query}`)).result;
    }

    async getFilteredComics(searchQuery, page, filters = {}) {
        const normalized = normalizeListingFilters(filters);
        const keyword = String(searchQuery || "").trim();
        if (keyword) return this.getSearchResults(keyword, page, normalized);
        return this.getCategoriesFilter(
            listingCategoryPath(normalized),
            page,
            listingApiOrder(normalized),
        );
    }

    async getLatestContent(page) {
        return (await this.#requestApi(`/latest?page=${page}`)).result;
    }

    async getPromotionContent() {
        const cached = await readCache("promotion", "home", 24 * 60 * 60);
        if (Array.isArray(cached)) return cached;
        const data = (await this.#requestApi("/promote?page=1")).result;
        writeCache("promotion", "home", data);
        return data;
    }

    #rememberRequest(cache, key, request, limit) {
        cache.set(key, request);
        while (cache.size > limit) {
            const oldestKey = cache.keys().next().value;
            cache.delete(oldestKey);
        }
        request.catch(() => {
            if (cache.get(key) === request) cache.delete(key);
        });
        return request;
    }

    async getComicAlbum(comicId, { refresh = false, maxServers = 5, timeoutMs = 12000 } = {}) {
        const id = String(comicId ?? "").trim();
        if (!id) throw new Error("漫画 ID 无效");
        const requestKey = Number(maxServers) === 5 && Number(timeoutMs) === 12000
            ? id
            : `${id}|${maxServers}|${timeoutMs}`;
        if (refresh) {
            this.albumRequests.delete(id);
            this.albumRequests.delete(requestKey);
        }
        if (!this.albumRequests.has(requestKey)) {
            const request = (async () => {
                if (!refresh) {
                    const cached = await readCache("album", id, 7 * 24 * 60 * 60);
                    if (cached && !Array.isArray(cached) && cached.id != null) {
                        return cached;
                    }
                }
                const { result } = await this.#requestApi(`/album?id=${encodeURIComponent(id)}`, {
                    validate: (value) => Boolean(
                        value
                        && !Array.isArray(value)
                        && typeof value === "object"
                        && value.id != null,
                    ),
                    maxServers,
                    timeoutMs,
                });
                writeCache("album", id, result);
                return result;
            })();
            this.#rememberRequest(this.albumRequests, requestKey, request, this.albumMemoryLimit);
        }
        return this.albumRequests.get(requestKey);
    }

    async getComicChapter(comicId) {
        const id = String(comicId ?? "").trim();
        if (!id) throw new Error("章节 ID 无效");
        if (!this.chapterRequests.has(id)) {
            const request = (async () => {
                const cached = await readCache("chapter", id, 3 * 24 * 60 * 60);
                if (cached && !Array.isArray(cached) && cached.id != null) return cached;
                const { result } = await this.#requestApi(`/chapter?id=${encodeURIComponent(id)}`, {
                    validate: (value) => Boolean(
                        value
                        && !Array.isArray(value)
                        && typeof value === "object"
                        && value.id != null,
                    ),
                });
                writeCache("chapter", id, result);
                return result;
            })();
            this.#rememberRequest(this.chapterRequests, id, request, this.chapterMemoryLimit);
        }
        return this.chapterRequests.get(id);
    }

    async getComicComments(subjectId, page = 1) {
        const id = String(subjectId ?? "").trim();
        if (!id) throw new Error("评论对象 ID 无效");
        const query = new URLSearchParams({ page: Math.max(1, Number(page) || 1), mode: "all", aid: id });
        const data = (await this.#requestApi(`/forum?${query}`)).result;
        return {
            list: Array.isArray(data?.list) ? data.list : [],
            total: Math.max(0, Number(data?.total) || 0),
        };
    }

    async getCategories() {
        const cached = await readCache("categories", "all", 24 * 60 * 60);
        if (cached?.categories) return cached;
        const data = (await this.#requestApi("/categories")).result;
        writeCache("categories", "all", data);
        return data;
    }

    async getCategoriesFilter(category, page, order) {
        const query = new URLSearchParams({ page, c: category, o: order || "" });
        return (await this.#requestApi(`/categories/filter?${query}`)).result;
    }


    getCoverImageURL(id) {
        return `https://${this.imgServers[Number(id) % 5]}/media/albums/${id}_3x4.jpg`;
    }

    getChapterImageServers() {
        const selected = Number(setting.using_imgserver_index);
        const startIndex = Number.isInteger(selected) && selected >= 0 && selected < this.imgServers.length ? selected : 0;
        return [...this.imgServers.slice(startIndex), ...this.imgServers.slice(0, startIndex)];
    }

    getChapterImageURLs(id, pathName) {
        const servers = this.getChapterImageServers();
        const safePath = String(pathName).split("/").map(encodeURIComponent).join("/");
        return servers.map((server) => `https://${server}/media/photos/${encodeURIComponent(id)}/${safePath}`);
    }

}

export const jmApi = new JmcomicApi();
