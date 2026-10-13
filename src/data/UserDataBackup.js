import { clearCache } from "../utils/BrowserCache.js";

/**
 * Export and restore the user data this site keeps in localStorage: reading history,
 * bookshelf lists, preferences, reader settings and search history. The expiring API cache
 * (`jm_cache:`) and the API server bootstrap are left out; they are rebuilt automatically.
 * Values are kept as the exact strings stored, so a restore reproduces them unchanged.
 */
const APP = "JMComic-Web";
const FORMAT_VERSION = 1;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const EXCLUDED_PREFIXES = ["jm_cache:"];
const EXCLUDED_KEYS = new Set(["jm_api_bootstrap_v1"]);
const EXTRA_KEYS = new Set(["using_imgserver_index"]);

const isUserKey = (key) => typeof key === "string"
    && (key.startsWith("jm_") || EXTRA_KEYS.has(key))
    && !EXCLUDED_KEYS.has(key)
    && !EXCLUDED_PREFIXES.some((prefix) => key.startsWith(prefix));

const storage = () => {
    try { return window.localStorage; } catch { return null; }
};

function readUserData(store) {
    const data = {};
    for (let index = 0; index < store.length; index++) {
        const key = store.key(index);
        if (isUserKey(key)) data[key] = store.getItem(key);
    }
    return data;
}

const pad = (number) => String(number).padStart(2, "0");
const stamp = (date) => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;

/** Download every user data entry as a JSON file; returns the number of entries. */
export function exportUserData() {
    const store = storage();
    if (!store) throw new Error("浏览器存储不可用");
    const now = new Date();
    const data = readUserData(store);
    const backup = { app: APP, version: FORMAT_VERSION, exportedAt: now.toISOString(), data };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `jmcomic-backup-${stamp(now)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Safari needs the URL a moment longer than the click.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return Object.keys(data).length;
}

/** Read and validate a backup file; resolves to `{ data, exportedAt }` or throws a readable error. */
export async function parseBackupFile(file) {
    if (!file) throw new Error("没有选择文件");
    if (file.size > MAX_FILE_BYTES) throw new Error("文件过大，不像是本站导出的备份");
    let backup;
    try { backup = JSON.parse(await file.text()); } catch { throw new Error("文件不是有效的 JSON"); }
    if (backup?.app !== APP || !backup.data || typeof backup.data !== "object" || Array.isArray(backup.data)) {
        throw new Error("这不是本站导出的备份文件");
    }
    if (Number(backup.version) > FORMAT_VERSION) throw new Error("备份来自更新的版本，请先刷新网站再导入");
    const data = Object.fromEntries(Object.entries(backup.data)
        .filter(([key, value]) => isUserKey(key) && typeof value === "string"));
    return { data, exportedAt: typeof backup.exportedAt === "string" ? backup.exportedAt : "" };
}

/**
 * Replace this browser's user data with `data`. When storage is full the API cache is dropped
 * and the write tried once more; if it still fails the previous data is put back before the
 * error is thrown. Returns the number of restored entries.
 */
export function restoreUserData(data) {
    const store = storage();
    if (!store) throw new Error("浏览器存储不可用");
    const previous = readUserData(store);
    const replaceWith = (entries) => {
        Object.keys(readUserData(store)).forEach((key) => store.removeItem(key));
        Object.entries(entries).forEach(([key, value]) => store.setItem(key, value));
    };
    try {
        replaceWith(data);
    } catch {
        try {
            clearCache();
            replaceWith(data);
            return Object.keys(data).length;
        } catch { /* Fall through to put the previous data back. */ }
        try { replaceWith(previous); } catch { /* Nothing more can be done. */ }
        throw new Error("浏览器存储空间不足，已保留原有数据");
    }
    return Object.keys(data).length;
}
