import { jmApi } from "../api/JmcomicApi.js";
import { ImageCutter } from "../reader/ImageCutter.js";
import { readerUrl } from "./dom.js";

const LOAD_TIMEOUT_MS = 15000;

/** Zero-based page indexes at 1/4, 1/2 and 3/4 of a chapter, without duplicates. */
export const previewIndexes = (count) => {
    const total = Math.max(0, Math.trunc(Number(count) || 0));
    return [...new Set([1, 2, 3].map((quarter) => Math.min(total - 1, Math.floor((total * quarter) / 4))))]
        .filter((index) => index >= 0);
};

/**
 * Three restored, downscaled pages from the first chapter. Each page is one
 * independent CDN request; the full-size image is released once drawn.
 */
export class PagePreview {
    constructor(root, album, chapter) {
        this.root = root;
        this.album = album;
        this.chapter = chapter;
        this.cutter = new ImageCutter();
    }

    async mount() {
        const strip = this.root.querySelector(".preview-strip");
        const meta = this.root.querySelector("[data-preview-meta]");
        try {
            const data = await jmApi.getComicChapter(this.chapter.id);
            const images = Array.isArray(data?.images) ? data.images.filter(Boolean).map(String) : [];
            const indexes = previewIndexes(images.length);
            if (!indexes.length) throw new Error("这一章没有可预览的图片");
            const chapterId = String(data.id ?? this.chapter.id);
            meta.textContent = `${this.chapter.label} · 共 ${images.length} 页`;
            strip.innerHTML = indexes.map((index) => `<a class="preview-page" data-state="loading" href="${readerUrl(chapterId, this.album.id, index + 1)}" data-navigation="same-tab" aria-label="从第 ${index + 1} 页开始阅读"><span class="preview-label num">${index + 1} / ${images.length}</span></a>`).join("");
            [...strip.children].forEach((tile, position) => {
                this.loadPage(tile, chapterId, images[indexes[position]]);
            });
        } catch {
            meta.textContent = "";
            strip.innerHTML = `<p class="preview-error">预览暂不可用</p>`;
        }
    }

    loadPage(tile, chapterId, path) {
        const sources = jmApi.getChapterImageURLs(chapterId, path);
        const scrambled = Number(chapterId) >= 220980 && !path.toLowerCase().endsWith(".gif");
        let sourceIndex = 0;
        let timer = 0;
        const image = new Image();
        image.decoding = "async";
        image.referrerPolicy = "no-referrer";
        const release = () => {
            clearTimeout(timer);
            image.onload = null;
            image.onerror = null;
            image.removeAttribute("src");
        };
        const next = () => {
            clearTimeout(timer);
            if (sourceIndex >= sources.length) {
                release();
                tile.dataset.state = "error";
                return;
            }
            timer = setTimeout(next, LOAD_TIMEOUT_MS);
            image.src = sources[sourceIndex++];
        };
        image.onload = () => {
            try {
                const canvas = this.cutter.restoreThumbnail(image, chapterId, path, { scrambled });
                canvas.setAttribute("aria-hidden", "true");
                tile.prepend(canvas);
                tile.dataset.state = "ready";
                release();
            } catch {
                next();
            }
        };
        image.onerror = next;
        next();
    }
}
