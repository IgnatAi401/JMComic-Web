import { jmApi } from "../api/JmcomicApi.js";
import { readLocalStorage, removeLocalStorage, writeLocalStorage } from "../utils/BrowserStorage.js";

/**
 * 作者订阅：只用浏览器存储和公开的搜索接口，前端独立完成，便于移植到纯静态版本。
 *
 * 判断新作：搜索结果按发布时间排序，但编号并不严格递增（补档的旧作会拿到新编号），
 * 所以同时看两条线索——更新时间晚于上次检查（留出收录延迟的余量），或编号大于见过的最大编号；
 * 再用“见过的编号”去重，同一部作品不会被反复加入。
 */
const STORE_KEY = "jm_author_subscriptions_v1";
const LOCK_KEY = "jm_author_subscriptions_lock";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000;
/* JM 新上传的作品要过一阵才能搜到，时间判断往前多看三天，靠“见过的编号”去重。 */
const INDEX_LAG_MS = 3 * 24 * 60 * 60 * 1000;
const LOCK_MS = 5 * 60 * 1000;
const REQUEST_GAP_MS = 1500;
const MAX_PAGES = 3;
const MAX_SEEN = 400;

const now = () => Date.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 名称比较时忽略全半角、大小写和多余空格。 */
export const normalizeAuthor = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

/* 作者字段常见“社团 (作者)”“A、B”“A & B”等写法，拆开后逐个比对，避免标题或标签里出现同名词时误报。 */
const AUTHOR_SEPARATORS = /[()（）[\]【】「」、,，&＆/／|｜;；+＋]+/;
/** 拆开后保留原样写法（用于显示别名）。 */
const rawAuthorParts = (value) => (Array.isArray(value) ? value : [value])
    .flatMap((item) => String(item ?? "").split(AUTHOR_SEPARATORS))
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
export const authorParts = (value) => rawAuthorParts(value).map(normalizeAuthor).filter(Boolean);

const matchesAuthor = (item, names) => authorParts(item?.author).some((part) => names.has(part));

/**
 * 标题开头的署名段，如“[社团 (作者)] 标题 (原作) [中國翻譯]”里的“社团 (作者)”。
 * 只看第一个方括号，原作名、语言标记等都不算，再按作者字段的规则逐段精确比对。
 */
const titleByline = (title) => String(title ?? "").normalize("NFKC").match(/^\s*\[([^\]]+)\]/)?.[1] || "";
const matchesTitle = (item, names) => authorParts(titleByline(item?.name)).some((part) => names.has(part));

/** 旧版本别名是字符串数组，统一成 { name, source }。 */
const aliasList = (value) => (Array.isArray(value) ? value : [])
    .map((item) => typeof item === "string" ? { name: item, source: "auto" } : item)
    .filter((item) => item?.name);

/**
 * 订阅名和作者字段写法不同时（如“竜/龍”这类异体字，JM 搜索视为相同），一部也匹配不到；
 * 这时把搜索结果里明显占多数的作者写法记为别名。
 */
function guessAlias(content, rejected) {
    const counts = new Map();
    for (const item of content) {
        const parts = new Map(rawAuthorParts(item?.author).map((raw) => [normalizeAuthor(raw), raw]));
        for (const [key, raw] of parts) {
            if (rejected.has(key)) continue;
            const entry = counts.get(key) || { raw, count: 0 };
            entry.count += 1;
            counts.set(key, entry);
        }
    }
    const best = [...counts.values()].sort((a, b) => b.count - a.count)[0];
    return best && best.count >= Math.max(3, content.length * 0.3) ? best.raw : "";
}

const emptyState = () => ({ version: 1, authors: [], updates: [], lastRunAt: 0, fuzzy: true });

function readState() {
    try {
        const value = JSON.parse(readLocalStorage(STORE_KEY, "null"));
        if (!value || typeof value !== "object") return emptyState();
        return {
            version: 1,
            authors: Array.isArray(value.authors) ? value.authors.filter((item) => item?.name) : [],
            updates: Array.isArray(value.updates) ? value.updates.filter((item) => item?.id) : [],
            lastRunAt: Number(value.lastRunAt) || 0,
            fuzzy: value.fuzzy !== false,
        };
    } catch {
        return emptyState();
    }
}

const comicFromSearch = (item, source, foundAt, via) => ({
    id: String(item.id),
    name: String(item.name || `漫画 #${item.id}`),
    author: authorParts(item.author).length ? [String(item.author)] : [],
    category: item.category?.title ? { title: String(item.category.title) } : undefined,
    updateAt: Number(item.update_at) || 0,
    sources: [source],
    foundAt,
    ...(via === "title" ? { via } : {}),
});

class AuthorSubscriptions {
    running = null;
    progress = null;

    constructor() {
        if (typeof window !== "undefined") {
            // 其他标签页改动后同步刷新。
            window.addEventListener("storage", (event) => {
                if (event.key === STORE_KEY) this.#notify();
            });
        }
    }

    get state() { return readState(); }
    get authors() { return this.state.authors; }
    get updates() { return this.state.updates; }
    get lastRunAt() { return this.state.lastRunAt; }
    /** 模糊匹配：识别作者的其他写法，并收录标题署名为该作者的作品。 */
    get fuzzy() { return this.state.fuzzy; }

    setFuzzy(enabled) { this.#update((state) => { state.fuzzy = Boolean(enabled); }); }

    /** 每位作者的别名，含来源（auto 自动识别 / manual 手动添加）。 */
    aliasesOf(author) { return aliasList(author?.aliases); }

    #author(state, name) {
        return state.authors.find((item) => normalizeAuthor(item.name) === normalizeAuthor(name));
    }

    /** 手动添加别名；添加后立刻检查这位作者，把新写法下的已有作品记为见过。 */
    addAlias(authorName, alias) {
        const name = String(alias ?? "").replace(/\s+/g, " ").trim();
        const key = normalizeAuthor(name);
        if (!key) throw new Error("请输入别名");
        const result = this.#update((state) => {
            const author = this.#author(state, authorName);
            if (!author) throw new Error("请先订阅这位作者");
            if (key === normalizeAuthor(author.name)) return "same";
            const aliases = aliasList(author.aliases);
            if (aliases.some((item) => normalizeAuthor(item.name) === key)) return "exists";
            author.aliases = [...aliases, { name, source: "manual" }];
            author.rejected = (author.rejected || []).filter((item) => item !== key);
            return "added";
        });
        if (result === "added" && !this.running) this.check([authorName]).catch(() => {});
        return result;
    }

    /** 删除别名并记为“已拒绝”，以后不会再自动识别回来。 */
    removeAlias(authorName, alias) {
        const key = normalizeAuthor(alias);
        this.#update((state) => {
            const author = this.#author(state, authorName);
            if (!author) return;
            author.aliases = aliasList(author.aliases).filter((item) => normalizeAuthor(item.name) !== key);
            author.rejected = [...new Set([...(author.rejected || []), key])];
        });
    }

    find(name) {
        const key = normalizeAuthor(name);
        return this.authors.find((item) => normalizeAuthor(item.name) === key) || null;
    }

    isSubscribed(name) { return Boolean(this.find(name)); }

    /** 读出最新状态、修改、写回；每次都重新读取，避免覆盖其他标签页的改动。 */
    #update(mutator) {
        const state = readState();
        const result = mutator(state);
        if (!writeLocalStorage(STORE_KEY, JSON.stringify(state))) throw new Error("浏览器存储已满或不可用，订阅未保存");
        this.#notify();
        return result;
    }

    #notify() {
        window.dispatchEvent(new CustomEvent("jm-subscriptions-change", { detail: { progress: this.progress } }));
    }

    /** 增量添加，已订阅的名字保持原样；返回实际新增的名字。 */
    subscribe(names) {
        const added = this.#update((state) => {
            const known = new Set(state.authors.map((item) => normalizeAuthor(item.name)));
            const fresh = [];
            for (const raw of Array.isArray(names) ? names : [names]) {
                const name = String(raw ?? "").replace(/\s+/g, " ").trim();
                const key = normalizeAuthor(name);
                if (!key || known.has(key)) continue;
                known.add(key);
                // checkedAt 为 0 表示还没建立基准：第一次检查只记下已有作品，不加入更新列表。
                fresh.push({ name, subscribedAt: now(), checkedAt: 0, maxId: 0, seen: [], error: "", failedAt: 0 });
            }
            state.authors.push(...fresh);
            return fresh.map((item) => item.name);
        });
        if (added.length) this.runDue().catch(() => {});
        return added;
    }

    /** 取消订阅；只来自这位作者的待看作品一并移出。 */
    unsubscribe(name) {
        const key = normalizeAuthor(name);
        this.#update((state) => {
            state.authors = state.authors.filter((item) => normalizeAuthor(item.name) !== key);
            state.updates = state.updates
                .map((item) => ({ ...item, sources: (item.sources || []).filter((source) => normalizeAuthor(source) !== key) }))
                .filter((item) => item.sources.length);
        });
    }

    toggle(name) {
        if (this.isSubscribed(name)) {
            this.unsubscribe(name);
            return false;
        }
        this.subscribe(name);
        return true;
    }

    /** 看过或手动移出。 */
    dismiss(id) {
        const target = String(id ?? "");
        if (!target || !this.updates.some((item) => item.id === target)) return;
        this.#update((state) => { state.updates = state.updates.filter((item) => item.id !== target); });
    }

    clearUpdates() { this.#update((state) => { state.updates = []; }); }

    /** 待检查的作者：还没建立基准，或距上次检查超过一天（失败后至少隔一小时再试）。 */
    dueAuthors(state = readState()) {
        const time = now();
        return state.authors.filter((item) => {
            if (item.failedAt && time - item.failedAt < RETRY_AFTER_FAILURE_MS) return false;
            return !item.checkedAt || time - item.checkedAt >= CHECK_INTERVAL_MS;
        });
    }

    /** 每天自动检查：只查到期的作者，多个标签页同时打开时只有一个在查。 */
    runDue() {
        const names = this.dueAuthors().map((item) => item.name);
        return names.length ? this.check(names, { auto: true }) : Promise.resolve({ added: 0, failed: [], checked: 0 });
    }

    /** 手动检查全部作者。 */
    checkAll() { return this.check(this.authors.map((item) => item.name)); }

    check(names, { auto = false } = {}) {
        if (this.running) return this.running;
        if (auto && !this.#acquireLock()) return Promise.resolve({ added: 0, failed: [], checked: 0, skipped: true });
        if (!auto) writeLocalStorage(LOCK_KEY, String(now()));
        this.running = this.#checkAll(names).finally(() => {
            this.running = null;
            this.progress = null;
            removeLocalStorage(LOCK_KEY);
            this.#notify();
        });
        return this.running;
    }

    get isRunning() { return Boolean(this.running); }

    #acquireLock() {
        const locked = Number(readLocalStorage(LOCK_KEY, "0")) || 0;
        if (locked && now() - locked < LOCK_MS) return false;
        writeLocalStorage(LOCK_KEY, String(now()));
        return true;
    }

    async #checkAll(names) {
        const result = { added: 0, failed: [], checked: 0 };
        for (const [index, name] of names.entries()) {
            this.progress = { index: index + 1, total: names.length, name };
            this.#notify();
            writeLocalStorage(LOCK_KEY, String(now()));
            if (index) await sleep(REQUEST_GAP_MS);
            try {
                result.added += await this.#checkAuthor(name);
                result.checked += 1;
            } catch (error) {
                result.failed.push(name);
                this.#update((state) => {
                    const author = state.authors.find((item) => normalizeAuthor(item.name) === normalizeAuthor(name));
                    if (author) Object.assign(author, { error: error?.message || "检查失败", failedAt: now() });
                });
            }
        }
        this.#update((state) => { state.lastRunAt = now(); });
        return result;
    }

    async #checkAuthor(name) {
        const subscription = this.find(name);
        if (!subscription) return 0;
        let baseline = !subscription.checkedAt;
        const seen = new Set((subscription.seen || []).map(String));
        const since = subscription.checkedAt - INDEX_LAG_MS;
        const startedAt = now();
        const found = [];
        const pageIds = [];
        let maxId = Number(subscription.maxId) || 0;
        const fuzzy = this.fuzzy;
        const aliases = aliasList(subscription.aliases);
        const rejected = new Set(subscription.rejected || []);
        // 关闭模糊匹配时别名保留但停用，只按订阅名精确匹配作者字段。
        const names = () => new Set([normalizeAuthor(subscription.name), ...(fuzzy ? aliases.map((item) => normalizeAuthor(item.name)) : [])]);
        const select = (content) => content.flatMap((item) => {
            if (!item?.id) return [];
            if (matchesAuthor(item, names())) return [{ item, via: "author" }];
            return fuzzy && matchesTitle(item, names()) ? [{ item, via: "title" }] : [];
        });

        for (let page = 1; page <= (baseline ? 1 : MAX_PAGES); page += 1) {
            if (page > 1) await sleep(REQUEST_GAP_MS);
            const response = await jmApi.getSearchResults(subscription.name, page, { order: "mr" });
            const content = Array.isArray(response?.content) ? response.content : [];
            let matched = select(content);
            // 只有作者字段一部都对不上时才识别别名；标题署名匹配到的作品照收，但不拿来学习。
            if (fuzzy && page === 1 && !matched.some((entry) => entry.via === "author")) {
                const alias = guessAlias(content, rejected);
                if (alias) {
                    aliases.push({ name: alias, source: "auto" });
                    // 换了匹配方式，已有作品从没记过，这次只当作重新建立基准。
                    baseline = true;
                    matched = select(content);
                }
            }
            let fresh = 0;
            for (const { item, via } of matched) {
                const id = String(item.id);
                pageIds.push(id);
                if (baseline || seen.has(id)) continue;
                const updatedAt = (Number(item.update_at) || 0) * 1000;
                // 编号线索只在有过匹配后才用：从没对上过时 maxId 为 0，所有旧作都会被当成新作。
                if (updatedAt > since || (maxId > 0 && Number(id) > maxId)) {
                    found.push(comicFromSearch(item, subscription.name, startedAt, via));
                    fresh += 1;
                }
            }
            // 这一页的结果全是新作，说明可能还有更多，继续往后翻；否则到此为止。
            if (!matched.length || fresh < matched.length || content.length < 20) break;
        }
        for (const id of pageIds) maxId = Math.max(maxId, Number(id) || 0);

        return this.#update((state) => {
            const author = this.#author(state, name);
            if (!author) return 0;
            // 合并检查期间用户对别名的改动（手动添加或删除），自动识别的新别名不覆盖已拒绝的。
            const current = aliasList(author.aliases);
            const refused = new Set(author.rejected || []);
            for (const alias of aliases) {
                const key = normalizeAuthor(alias.name);
                if (!refused.has(key) && !current.some((item) => normalizeAuthor(item.name) === key)) current.push(alias);
            }
            author.aliases = current;
            const known = [...new Set([...pageIds, ...(author.seen || []).map(String)])].slice(0, MAX_SEEN);
            Object.assign(author, { checkedAt: startedAt, maxId, seen: known, error: "", failedAt: 0 });
            let added = 0;
            for (const comic of found) {
                const existing = state.updates.find((item) => item.id === comic.id);
                if (existing) {
                    if (!existing.sources.includes(comic.sources[0])) existing.sources.push(comic.sources[0]);
                    continue;
                }
                state.updates.unshift(comic);
                added += 1;
            }
            state.updates.sort((a, b) => (b.updateAt || 0) - (a.updateAt || 0) || Number(b.id) - Number(a.id));
            return added;
        });
    }
}

export const authorSubscriptions = new AuthorSubscriptions();
