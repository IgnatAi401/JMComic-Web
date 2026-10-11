import { readLocalStorage, writeLocalStorage } from "../utils/BrowserStorage.js";

/** Lists are kept in this browser only; each list is de-duplicated by comic id, newest first. */
const LISTS = {
    reading: { key: "jm_reading_history_v2", limit: 200 },
    random: { key: "jm_random_history_v1", limit: 200 },
    later: { key: "jm_watch_later_v1", limit: 500 },
};

/** Tag and author stances live beside the lists, as `{ tags, authors }` maps of name → level. */
const PREFERENCES_KEY = "jm_preferences_v1";
// Allowed levels per kind, strongest liking first.
const PREFERENCE_LEVELS = { tag: ["like", "fond", "avoid", "dislike"], author: ["like", "dislike"] };
const MAX_PREFERENCES_PER_KIND = 1000;
const PREFERENCE_NAME = /^[^\x00-\x1f\x7f]{1,80}$/u;

function readList(key) {
    try {
        const value = JSON.parse(readLocalStorage(key, "[]"));
        return Array.isArray(value) ? value.filter((item) => item?.id != null) : [];
    } catch {
        return [];
    }
}

function normalizeAlbum(album) {
    return {
        id: String(album.id),
        name: album.name || "未命名作品",
        author: Array.isArray(album.author) ? album.author.join(" & ") : (album.author || "未知作者"),
        savedAt: Date.now(),
    };
}

function normalizeRandomAlbum(album) {
    const authors = Array.isArray(album.author)
        ? album.author.filter(Boolean).map(String)
        : (Array.isArray(album.authors)
            ? album.authors.filter(Boolean).map(String)
            : (album.author || album.authors ? [String(album.author || album.authors)] : []));
    const tags = Array.isArray(album.tags) ? album.tags.filter(Boolean).map(String) : [];
    return {
        id: String(album.id),
        name: album.name || album.title || `漫画 #${album.id}`,
        author: authors,
        tags,
        description: album.description || "",
        chapters: Number(album.chapters || (Array.isArray(album.series) && album.series.length) || 1),
        total_photos: album.total_photos ?? null,
        comment_total: album.comment_total ?? 0,
        addtime: Number(album.addtime) || 0,
        cover_url: album.cover_url || album.coverUrl || "",
        savedAt: Number(album.savedAt) || Date.now(),
    };
}

function readPreferences() {
    let value;
    try { value = JSON.parse(readLocalStorage(PREFERENCES_KEY, "{}")); } catch { value = null; }
    const pick = (kind) => {
        const entries = value?.[`${kind}s`];
        return Object.fromEntries(Object.entries(entries && typeof entries === "object" ? entries : {})
            .filter(([name, level]) => PREFERENCE_NAME.test(name) && PREFERENCE_LEVELS[kind].includes(level)));
    };
    return { tags: pick("tag"), authors: pick("author") };
}

class LibraryStore {
    lists = { reading: [], random: [], later: [] };
    preferences = { tags: {}, authors: {} };
    loaded = false;

    init() {
        if (!this.loaded) {
            this.loaded = true;
            this.#load();
            // Keep several open tabs in step with each other.
            window.addEventListener("storage", (event) => {
                if (event.key === null || event.key === PREFERENCES_KEY || Object.values(LISTS).some((list) => list.key === event.key)) {
                    this.#load();
                    this.#notify();
                }
            });
        }
        return Promise.resolve();
    }

    #load() {
        for (const [kind, { key }] of Object.entries(LISTS)) this.lists[kind] = readList(key);
        this.preferences = readPreferences();
    }

    getHistory() { this.init(); return this.lists.reading; }
    getRandomHistory() { this.init(); return this.lists.random; }
    getWatchLater() { this.init(); return this.lists.later; }
    isWatchLater(id) { this.init(); return this.lists.later.some((item) => String(item.id) === String(id)); }

    /** `clear === true` empties the list; a string `clear` removes only that comic id. */
    async #mutate(kind, items, clear = false) {
        this.init();
        const { key, limit } = LISTS[kind];
        let next;
        if (clear === true) next = [];
        else if (typeof clear === "string") next = this.lists[kind].filter((item) => String(item.id) !== clear);
        else {
            const ids = new Set(items.map((item) => String(item.id)));
            next = [...items, ...readList(key).filter((item) => !ids.has(String(item.id)))]
                .sort((a, b) => (Number(b.savedAt) || 0) - (Number(a.savedAt) || 0))
                .slice(0, limit);
        }
        if (!writeLocalStorage(key, JSON.stringify(next))) throw new Error("浏览器存储不可用或已满");
        this.lists[kind] = next;
        this.#notify();
    }

    recordHistory(album) { return this.#mutate("reading", [normalizeAlbum(album)]); }
    recordRandomHistory(album) { return this.#mutate("random", [normalizeRandomAlbum(album)]); }
    clearHistory() { return this.#mutate("reading", [], true); }
    clearRandomHistory() { return this.#mutate("random", [], true); }
    addWatchLater(album) { return this.#mutate("later", [normalizeRandomAlbum({ ...album, savedAt: Date.now() })]); }
    removeWatchLater(id) { return this.#mutate("later", [], String(id)); }
    clearWatchLater() { return this.#mutate("later", [], true); }

    getPreferences() { this.init(); return this.preferences; }

    /**
     * Upsert one `{ kind, name, level }` stance; `level: null` deletes it and `previous`
     * renames an entry. Resolves to every preference, like the JMComic-Next backend.
     */
    async savePreference({ kind, name, level = null, previous = "" } = {}) {
        this.init();
        if (!PREFERENCE_LEVELS[kind]) throw new Error("偏好类型无效");
        const clean = String(name ?? "").trim();
        if (!PREFERENCE_NAME.test(clean)) throw new Error("名称不能为空，且不超过 80 个字符");
        if (level !== null && !PREFERENCE_LEVELS[kind].includes(level)) throw new Error("偏好等级无效");
        // Start from storage so a change made in another tab is not overwritten.
        const next = readPreferences();
        const entries = next[`${kind}s`];
        const old = String(previous ?? "").trim();
        if (old && old !== clean) delete entries[old];
        if (level === null) delete entries[clean];
        else {
            if (!(clean in entries) && Object.keys(entries).length >= MAX_PREFERENCES_PER_KIND) {
                throw new Error(`每类偏好最多 ${MAX_PREFERENCES_PER_KIND} 项`);
            }
            entries[clean] = level;
        }
        if (!writeLocalStorage(PREFERENCES_KEY, JSON.stringify(next))) throw new Error("浏览器存储不可用或已满");
        this.preferences = next;
        this.#notify();
        return next;
    }
    #notify() { window.dispatchEvent(new CustomEvent("jm-library-change")); }
}

export const libraryStore = new LibraryStore();
