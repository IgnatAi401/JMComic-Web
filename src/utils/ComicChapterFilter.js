import { jmApi } from "../api/JmcomicApi.js";

const isSingleChapterComic = (album) => {
    const chapters = Array.isArray(album?.series) ? album.series.filter(Boolean) : [];
    return chapters.length <= 1;
};

/**
 * List endpoints do not expose chapter counts. Resolve album details with a
 * small worker pool and let JmcomicApi cache repeated album requests.
 */
export async function keepSingleChapterComics(comics, enabled, concurrency = 8) {
    if (!enabled || !Array.isArray(comics) || !comics.length) return comics || [];

    const matches = new Array(comics.length).fill(false);
    let cursor = 0;
    const worker = async () => {
        while (cursor < comics.length) {
            const index = cursor++;
            try {
                const album = await jmApi.getComicAlbum(comics[index]?.id);
                matches[index] = isSingleChapterComic(album);
            } catch {
                // Unknown chapter counts stay hidden while the strict filter is on.
                matches[index] = false;
            }
        }
    };

    await Promise.all(Array.from(
        { length: Math.min(concurrency, comics.length) },
        () => worker(),
    ));
    return comics.filter((_, index) => matches[index]);
}
