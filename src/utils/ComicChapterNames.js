const chapterText = (value) => String(value ?? "").trim();

export function hasMissingComicChapterNames(chapters) {
    return Array.isArray(chapters)
        && chapters.length > 1
        && chapters.some((chapter) => !chapterText(chapter?.name));
}

/**
 * Merge mobile API chapter names with names parsed from the JM web detail.
 * Mobile values win; web values only fill gaps. Multi-chapter gaps fall back
 * to their numbered labels, while one-shots always use a single fixed label.
 */
export function mergeComicChapterNames(chapters, webChapters = []) {
    const source = Array.isArray(chapters) ? chapters : [];
    if (source.length <= 1) {
        const chapter = source[0] || {};
        return [{ ...chapter, name: "全1话", sort: "1" }];
    }

    const webById = new Map();
    const webBySort = new Map();
    for (const chapter of Array.isArray(webChapters) ? webChapters : []) {
        const name = chapterText(chapter?.name);
        if (!name) continue;
        const id = chapterText(chapter?.id);
        const sort = chapterText(chapter?.sort);
        if (id && !webById.has(id)) webById.set(id, name);
        if (sort && !webBySort.has(sort)) webBySort.set(sort, name);
    }

    return source.map((chapter, index) => {
        const id = chapterText(chapter?.id);
        const sort = chapterText(chapter?.sort) || String(index + 1);
        const name = chapterText(chapter?.name)
            || webById.get(id)
            || webBySort.get(sort)
            || `第${sort}话`;
        return { ...chapter, name, sort };
    });
}
