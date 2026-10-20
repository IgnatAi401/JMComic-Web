import { setting } from "../core/Setting.js";
import { readCache, writeCache } from "../utils/BrowserCache.js";
import { readLocalStorage, removeLocalStorage, writeLocalStorage } from "../utils/BrowserStorage.js";
import { crypto, parseJsonText } from "./Crypto.js";
import { listingApiOrder, listingCategoryPath, normalizeListingFilters } from "../utils/ListingFilters.js";

// Check-in rewards appear as "Jcoin:10 EXP:10" or "[EXP:10] [COIN:2]".
const DAILY_REWARD_PATTERN = /\[?\s*(J?COINS?|EXP)\s*[:：]\s*(\d+)\s*\]?/gi;
/* JM, or Cloudflare in front of an API line, refused the request before handling it. */
const isRefusedStatus = (status) => status === 403 || status === 429;

/** Browser client for the JM mobile API. Account calls pass the login session explicitly. */
class JmcomicApi {
    accessToken = null;
    currentKey = null;
    servers = [];
    initPromise = null;
    albumRequests = new Map();
    chapterRequests = new Map();
    dailyCheckInPromise = null;
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

    /**
     * `session` is the JM login session (PHP session `AVS`). The browser cannot send JM's
     * cookie cross-site, so it goes in the query string; cookies are omitted so a stale
     * `AVS` cookie can not take precedence. `form` sends multipart fields instead of `data`.
     * `failFast` stops at the first HTTP error instead of trying other API lines, except
     * when that line refused the request (403/429) or failed (5xx) before handling it.
     * `refusedOnly` tries the next API line only after a 403/429, for writes that must not repeat.
     */
    async #requestApi(path, {
        method = "GET",
        data = null,
        form = null,
        session = "",
        omitCredentials = false,
        failFast = false,
        refusedOnly = false,
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
                const detail = payload?.errorMsg || payload?.error || payload?.msg || payload?.message;
                throw Object.assign(
                    new Error(`HTTP ${response.status}${typeof detail === "string" && detail ? `：${detail}` : ""}`),
                    { httpStatus: response.status, detail: typeof detail === "string" ? detail : "" },
                );
            }
            return { response, payload };
        };

        for (const server of candidates) {
            const { key, accessToken } = this.#createRequestAuth();
            const headers = { token: accessToken.token, tokenParam: accessToken.tokenParam };
            const options = {
                method,
                headers,
                credentials: session || omitCredentials ? "omit" : "include",
                redirect: "follow",
            };
            if (form) {
                const body = new FormData();
                Object.entries(form).forEach(([name, value]) => body.append(name, String(value)));
                options.body = body;
            } else if (data) {
                headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
                options.body = new URLSearchParams(data).toString();
            }
            const url = session
                ? `https://${server}${path}${path.includes("?") ? "&" : "?"}AVS=${encodeURIComponent(session)}`
                : `https://${server}${path}`;

            try {
                const { response, payload } = await this.#fetchWithTimeout(url, options, timeoutMs, readResponse);
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
                if (failFast && error?.httpStatus && !isRefusedStatus(error.httpStatus) && error.httpStatus < 500) throw error;
                if (refusedOnly && !isRefusedStatus(error?.httpStatus)) throw error;
            }
        }
        if (retryBootstrap && this.bootstrapFromCache) {
            await this.init(true);
            return this.#requestApi(path, {
                method, data, form, session, omitCredentials, failFast, refusedOnly, validate, retryBootstrap: false, maxServers, timeoutMs,
            });
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
        const result = {
            list: Array.isArray(data?.list) ? data.list : [],
            total: Math.max(0, Number(data?.total) || 0),
        };
        // The first page is reused by the reader so its comments show without another request.
        if (Number(page) <= 1) writeCache("comments", id, result);
        return result;
    }

    async getCachedComicComments(subjectId, maxAgeSeconds = 6 * 60 * 60) {
        const id = String(subjectId ?? "").trim();
        if (!id) return null;
        const cached = await readCache("comments", id, maxAgeSeconds);
        return cached && Array.isArray(cached.list) ? cached : null;
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

    /** Log in; resolves to the JM profile, whose `s` is the session to pass to account calls. */
    async login(username, password) {
        let profile;
        try {
            // A rejected password is final: do not repeat it on every API line.
            profile = (await this.#requestApi("/login", {
                method: "POST",
                data: { username, password },
                omitCredentials: true,
                failFast: true,
            })).result;
        } catch (error) {
            if (error?.httpStatus) {
                throw Object.assign(new Error(error.detail || `登录失败（HTTP ${error.httpStatus}）`), { httpStatus: error.httpStatus });
            }
            throw new Error(`登录失败：${this.#dailyErrorDetail(error)}`);
        }
        if (!profile || typeof profile !== "object" || !profile.uid || !profile.s) {
            throw new Error(this.#dailyMessage(profile) || "账号或密码错误");
        }
        return profile;
    }

    /**
     * Check in for `account` ({ uid, session }). `relogin` is called once when JM shows the
     * session is dead, and must resolve to a fresh { uid, session } for the same account.
     */
    async dailyCheckIn(account, { relogin } = {}) {
        if (!/^\d+$/.test(String(account?.uid ?? "")) || !account?.session) throw new Error("请先登录账号");
        if (this.dailyCheckInPromise) return this.dailyCheckInPromise;
        this.dailyCheckInPromise = this.#performDailyCheckIn(account, relogin).finally(() => {
            this.dailyCheckInPromise = null;
        });
        return this.dailyCheckInPromise;
    }

    async getDailyCheckInStatus({ uid, session }) {
        const query = new URLSearchParams({ user_id: uid });
        const { result, payload } = await this.#requestApi(`/daily?${query}`, { session });
        this.#assertDailyCheckInEnvelope(payload);
        if (this.#isEmptyDailyResult(result) && !this.#dailyMessage(payload)) {
            throw Object.assign(new Error("未取得签到活动信息，请稍后重试"), { emptyDailyResponse: true });
        }
        if (!result || typeof result !== "object" || Array.isArray(result)) {
            throw new Error("未取得签到活动信息，请稍后重试");
        }
        const dailyId = String(result.daily_id ?? "").trim();
        if (!/^\d+$/.test(dailyId) || Number(dailyId) <= 0) {
            throw new Error(String(result.msg ?? result.message ?? "未取得签到活动 ID，请稍后重试").trim());
        }
        return { ...result, dailyId };
    }

    #dailyMessage(value) {
        if (typeof value === "string") return value.trim();
        return [value?.msg, value?.message, value?.error, value?.errorMsg]
            .filter((item) => typeof item === "string" && item.trim())
            .map((item) => item.trim()).join("；");
    }

    #dailyError(message, cause) {
        return Object.assign(new Error(message), { httpStatus: cause?.httpStatus });
    }

    #dailyErrorDetail(error) {
        if (isRefusedStatus(error?.httpStatus)) {
            return `${error.detail || `JM 拒绝访问（HTTP ${error.httpStatus}），可能是线路风控或请求过于频繁`}，请过一段时间再试`;
        }
        if (error?.name === "AbortError" || /timeout|timed out/i.test(error?.message || "")) return "请求超时";
        if (/failed to fetch|load failed|networkerror/i.test(error?.message || "")) return "网络连接中断，请检查网络";
        if (/decryption failed/i.test(error?.message || "")) return "无法解密接口响应";
        return error?.message || "未收到有效响应";
    }

    #isEmptyDailyResult(result) {
        return result == null || result === "" || (typeof result === "object" && Object.keys(result).length === 0);
    }

    async #performDailyCheckIn(account, relogin) {
        const outcome = await this.#attemptDailyCheckIn(account);
        if (outcome) return outcome;
        // JM answers with code 200 and an empty body (not 401) once the session has
        // expired or was replaced by a login elsewhere. Log in again and retry once: a
        // repeated check-in on the same day only reports "already checked in".
        if (!relogin) throw new Error("登录已失效（可能已过期或在其他地方登录），请重新登录后签到");
        let fresh;
        try {
            fresh = await relogin();
            if (String(fresh?.uid ?? "") !== String(account.uid)) throw new Error("重新登录后的账号与当前账号不一致");
        } catch (error) {
            if (error?.needsLogin) throw error;
            throw this.#dailyError(`登录已失效（可能已过期或在其他地方登录），重新登录失败，签到未完成：${this.#dailyErrorDetail(error)}`, error);
        }
        return this.#attemptDailyCheckIn(fresh, true);
    }

    /** Returns the check-in outcome, or null when JM answered with an empty body on a first attempt. */
    async #attemptDailyCheckIn(account, relogged = false) {
        let daily;
        try {
            daily = await this.getDailyCheckInStatus(account);
        } catch (error) {
            if (error?.emptyDailyResponse && !relogged) return null;
            throw this.#dailyError(`读取签到活动失败，尚未提交签到：${this.#dailyErrorDetail(error)}`, error);
        }
        let response;
        try {
            // Another API line is tried only after a 403/429: a lost response does not mean
            // the write was rejected, so this POST is never repeated after other failures.
            response = await this.#requestApi("/daily_chk", {
                method: "POST",
                form: { user_id: account.uid, daily_id: daily.dailyId },
                session: account.session,
                refusedOnly: true,
                retryBootstrap: false,
            });
        } catch (error) {
            if (isRefusedStatus(error?.httpStatus)) {
                throw this.#dailyError(`签到被拒绝，签到未完成：${this.#dailyErrorDetail(error)}`, error);
            }
            throw this.#dailyError(`签到结果未确认：${this.#dailyErrorDetail(error)}。请求可能已生效，请稍后再次签到确认。`, error);
        }
        const { result, payload } = response;
        const message = [...new Set([this.#dailyMessage(result), this.#dailyMessage(payload)].filter(Boolean))].join("；");
        const status = String(result?.status ?? "").trim().toLowerCase();
        const successStatus = ["success", "ok", "1", "true", "200"].includes(status);
        const failedStatus = ["fail", "failed", "failure", "error", "0", "false"].includes(status) || /^[45]\d\d$/.test(status);
        const failedCode = [payload?.code, result?.code].some((code) => code != null && Number(code) !== 200);
        const failedMessage = /失败|失敗|错误|錯誤|异常|異常|未登录|未登入|请先|請先|无法|無法|尚未|未能|没有|沒有|未成功|未签到|未簽到|不成功|not\s+(?:successful|checked)|fail(?:ed|ure)?|error|denied/i.test(message);
        const already = /已(?:经|經)?(?:完成)?[签簽]到|[签簽]到[过過]|[重複复]{2}[签簽]到|already\s+checked[ -]?in/i.test(message);
        if (already && !failedMessage) {
            return { status: "already", message: `今天已签到，无需重复提交${message ? `：${message}` : ""}` };
        }
        if (failedStatus || failedCode || failedMessage || this.#dailyMessage(result?.error) || this.#dailyMessage(payload?.error)) {
            throw new Error(`签到接口返回失败：${message || `状态 ${status || result?.code || payload?.code}`}`);
        }
        if (this.#isEmptyDailyResult(result) && !message && !status) {
            if (!relogged) return null;
            throw new Error("签到接口返回了空结果，未确认成功：已重新登录但仍没有签到结果。请稍后再次签到确认。");
        }
        // The real success response carries only rewards, e.g. {"msg":"Jcoin:10 EXP:10"}.
        // Failure wording is rejected above, so a reward-only message is a confirmed success.
        const rewards = this.#dailyRewards(message);
        const successMessage = /签到成功|簽到成功|check[ -]?in\s+(?:succeeded|successful)/i.test(message);
        if ((!successStatus && !successMessage && !rewards.length) || (status && !successStatus)) {
            throw new Error(`签到响应异常，未确认成功${message ? `：${message}` : ""}${status ? `（状态 ${status}）` : ""}。请稍后再次签到确认。`);
        }
        if (rewards.length && !message.replace(DAILY_REWARD_PATTERN, "").replace(/[\s,，、；;]+/g, "")) {
            return { status: "success", message: `签到成功：获得 ${rewards.join("、")}` };
        }
        const localizedMessage = message.replace(DAILY_REWARD_PATTERN, (_match, kind, amount) => `获得 ${amount} ${/exp/i.test(kind) ? "经验" : "金币"}`);
        return { status: "success", message: localizedMessage || "签到成功" };
    }

    #dailyRewards(message) {
        return [...message.matchAll(DAILY_REWARD_PATTERN)]
            .map(([, kind, amount]) => `${amount} ${/exp/i.test(kind) ? "经验" : "金币"}`);
    }

    #assertDailyCheckInEnvelope(payload) {
        if (!payload || typeof payload !== "object" || payload.code == null) return;
        if (Number(payload.code) === 200) return;
        throw Object.assign(new Error(`签到接口状态 ${payload.code}：${this.#dailyMessage(payload) || "接口未提供原因"}`), { httpStatus: Number(payload.code) });
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
