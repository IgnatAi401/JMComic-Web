import { mergeComicChapterNames } from "../utils/ComicChapterNames.js";

export function chaptersOf(album, chapter = null, webChapters = []) {
    const series = album?.series?.length ? album.series : chapter?.series;
    const list = Array.isArray(series) && series.length ? series : [{ id: chapter?.id || album.id, name: "", sort: "1" }];
    const seen = new Set();
    return mergeComicChapterNames([...list].filter((item) => item?.id != null).sort((a, b) => Number(a.sort) - Number(b.sort)).filter((item) => {
        const key = String(item.sort || item.id);
        if (seen.has(key)) return false;
        seen.add(key); return true;
    }), webChapters);
}
