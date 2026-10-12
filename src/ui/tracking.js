import { jmApi } from "../api/JmcomicApi.js";
import { libraryStore } from "../data/LibraryStore.js";
import { formatDate } from "./dom.js";

// A tracked series is re-checked at most this often, unless the check is forced.
const CHECK_AGE = 30 * 60 * 1000;
const CONCURRENCY = 3;

export const updatedLabel = (seconds) => formatDate(seconds, { year: "numeric", month: "2-digit", day: "2-digit" }) || "未知";

/**
 * The id of the series an album belongs to. Opening one chapter of a series returns the
 * whole chapter list but that chapter's own name and date, so tracking uses the series.
 */
export const seriesIdOf = (album) => {
    const seriesId = String(album?.series_id ?? "");
    return /^\d+$/.test(seriesId) && seriesId !== "0" ? seriesId : String(album?.id ?? "");
};

/** The series album for `album`, read with `options` when it is a different album. */
export const seriesAlbumOf = (album, options = {}) => (seriesIdOf(album) === String(album.id)
    ? album
    : jmApi.getComicAlbum(seriesIdOf(album), options));

/** The series changed after the user last opened its detail page. */
export const hasUpdate = (item) => Number(item.updatedAt) * 1000 > Number(item.viewedAt);

/** Tracked series, most recently updated first. */
export const trackedByUpdate = () => [...libraryStore.getTracking()]
    .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));

let running = null;

/**
 * Re-read tracked albums (bypassing the album cache) to learn each series' latest update.
 * Resolves to `{ checked, failed, total }`; concurrent calls share one run.
 */
export function checkTrackingUpdates({ force = false, onProgress = () => {} } = {}) {
    if (running) return running;
    const now = Date.now();
    const due = libraryStore.getTracking().filter((item) => force || now - (Number(item.checkedAt) || 0) > CHECK_AGE);
    if (!due.length) return Promise.resolve({ checked: 0, failed: 0, total: 0 });
    running = (async () => {
        const albums = [];
        let done = 0;
        let failed = 0;
        onProgress(done, due.length);
        await jmApi.init();
        const queue = [...due];
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
            while (queue.length) {
                const item = queue.shift();
                try {
                    const options = { refresh: true, maxServers: 2, timeoutMs: 8000 };
                    const series = await seriesAlbumOf(await jmApi.getComicAlbum(item.id, options), options);
                    albums.push({ ...series, trackedId: item.id });
                }
                catch { failed += 1; }
                done += 1;
                onProgress(done, due.length);
            }
        }));
        await libraryStore.refreshTracking(albums);
        return { checked: albums.length, failed, total: due.length };
    })().finally(() => { running = null; });
    return running;
}
