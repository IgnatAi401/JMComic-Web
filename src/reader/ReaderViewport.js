import { EagerComicImageLoader } from "./EagerComicImageLoader.js";
import { setting } from "../core/Setting.js";

/** Owns the visible page and a stable seek target while nearby images decode. */
export class ReaderViewport {
    constructor(root, chapter, onProgress) {
        const images = Array.isArray(chapter.images) ? chapter.images.filter(Boolean) : [];
        if (!images.length) throw new Error("这一章没有可读取的图片");
        this.root = root; this.onProgress = onProgress; this.current = 0; this.seeking = null;
        this.nodes = images.map((path, index) => {
            const node = document.createElement("div");
            node.className = "reader-page";
            Object.assign(node.dataset, { path: String(path), index: String(index), pageNumber: String(index + 1), state: "pending" });
            node.setAttribute("aria-label", `第 ${index + 1} 页`);
            return node;
        });
        root.replaceChildren(...this.nodes);
        this.loader = new EagerComicImageLoader(chapter.id, { batchSize: setting.image_load_batch_size, onLayoutChange: () => this.realign() });
        this.loader.start(this.nodes);
        this.schedule = () => {
            if (this.frame) return;
            this.frame = requestAnimationFrame(() => { this.frame = 0; this.measure(); });
        };
        window.addEventListener("scroll", this.schedule, { passive: true });
        window.addEventListener("resize", this.schedule);
        window.addEventListener("jm-settings-change", (event) => this.loader.setBatchSize(event.detail?.imageLoadBatchSize));
        window.addEventListener("wheel", () => { this.seeking = null; }, { passive: true });
        root.addEventListener("touchstart", () => { this.seeking = null; }, { passive: true });
        window.addEventListener("pagehide", () => { cancelAnimationFrame(this.frame); this.frame = 0; });
        window.addEventListener("pageshow", this.schedule);
        this.schedule();
    }

    measure() {
        if (this.seeking !== null) { this.realign(); return; }
        const marker = Math.min(150, window.innerHeight * 0.2);
        let low = 0, high = this.nodes.length - 1;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            if (this.nodes[mid].getBoundingClientRect().top <= marker) low = mid;
            else high = mid - 1;
        }
        this.setCurrent(low);
    }

    setCurrent(index) {
        this.current = index;
        this.loader.setCurrent(index);
        this.onProgress?.({ page: index + 1, pages: this.nodes.length, progress: (index + 1) / this.nodes.length });
    }

    seek(page) {
        const index = Math.min(this.nodes.length - 1, Math.max(0, Math.trunc(Number(page) || 1) - 1));
        this.seeking = index;
        this.setCurrent(index);
        this.realign();
    }

    realign() {
        if (this.seeking === null) { this.schedule?.(); return; }
        const target = this.nodes[this.seeking];
        window.scrollBy({ top: target.getBoundingClientRect().top, behavior: "instant" });
        if (this.loader.isLayoutStableBefore(this.seeking)) this.seeking = null;
    }
}
