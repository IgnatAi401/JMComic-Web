/**
 * Small expiring API cache kept in the browser's localStorage.
 * Entries are evicted oldest-first when the count limit or the storage quota is reached.
 */
const PREFIX = "jm_cache:";
const MAX_ENTRIES = 300;

const storage = () => {
    try { return window.localStorage; } catch { return null; }
};

const cacheKeys = (store) => {
    const keys = [];
    for (let index = 0; index < store.length; index++) {
        const key = store.key(index);
        if (key?.startsWith(PREFIX)) keys.push(key);
    }
    return keys;
};

const savedAt = (store, key) => {
    try { return Number(JSON.parse(store.getItem(key))?.t) || 0; } catch { return 0; }
};

/** Remove the oldest `fraction` of cache entries (expired ones sort first). */
function evict(store, fraction) {
    const keys = cacheKeys(store).map((key) => [key, savedAt(store, key)]).sort((a, b) => a[1] - b[1]);
    const count = Math.max(1, Math.ceil(keys.length * fraction));
    keys.slice(0, count).forEach(([key]) => store.removeItem(key));
}

export async function readCache(kind, key, maxAgeSeconds) {
    const store = storage();
    if (!store) return null;
    try {
        const entry = JSON.parse(store.getItem(`${PREFIX}${kind}:${key}`));
        if (!entry || Date.now() - Number(entry.t) > Number(maxAgeSeconds) * 1000) return null;
        return entry.d ?? null;
    } catch {
        return null;
    }
}

export async function writeCache(kind, key, data) {
    const store = storage();
    if (!store) return;
    const fullKey = `${PREFIX}${kind}:${key}`;
    try {
        if (data == null) {
            store.removeItem(fullKey);
            return;
        }
        const value = JSON.stringify({ t: Date.now(), d: data });
        if (cacheKeys(store).length >= MAX_ENTRIES) evict(store, 0.2);
        try {
            store.setItem(fullKey, value);
        } catch {
            // Quota reached: drop half of the cache and try once more.
            evict(store, 0.5);
            store.setItem(fullKey, value);
        }
    } catch {
        // The API data stays usable when browser storage is unavailable.
    }
}

/** Delete every cached API response; reading history and settings are kept. */
export function clearCache() {
    const store = storage();
    if (!store) return 0;
    const keys = cacheKeys(store);
    keys.forEach((key) => store.removeItem(key));
    return keys.length;
}

