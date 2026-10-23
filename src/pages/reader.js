import { jmApi } from "../api/JmcomicApi.js";
import { libraryStore } from "../data/LibraryStore.js";
import { writeLocalStorage } from "../utils/BrowserStorage.js";
import { mountShell, appShell } from "../ui/shell.js";
import { chaptersOf } from "../ui/chapters.js";
import { detailUrl, escapeHtml, readerUrl } from "../ui/dom.js";
import { Comments } from "../ui/comments.js";
import { Sheet, isPageScrollLocked, setPageScrollLockMode } from "../ui/overlay.js";
import { seriesIdOf } from "../ui/tracking.js";
import { ReaderViewport } from "../reader/ReaderViewport.js";
import { icon } from "../ui/icons.js";
import { renderPageError } from "../ui/states.js";
import { showToast } from "../ui/toast.js";

export class ReaderPage {
    async init() {
        mountShell({ chrome: false });
        setPageScrollLockMode("contain");
        const params = new URLSearchParams(location.search);
        this.chapterId = params.get("id"); this.albumId = params.get("album");
        if (!/^\d+$/.test(this.chapterId || "") || (this.albumId && !/^\d+$/.test(this.albumId))) throw new Error("章节或作品 ID 无效");
        await jmApi.init();
        this.chapter = await jmApi.getComicChapter(this.chapterId);
        this.albumId ||= seriesIdOf(this.chapter);
        this.viewport = new ReaderViewport(document.querySelector(".reader-images"), this.chapter, (value) => this.progress(value));
        const startPage = Number(params.get("page"));
        if (Number.isInteger(startPage) && startPage > 1) this.viewport.seek(startPage);
        document.querySelector(".reader-loading").hidden = true;
        document.querySelector(".reader-scrubber").hidden = false;
        this.bind();
        const album = await jmApi.getComicAlbum(this.albumId).catch(() => null);
        this.album = album?.id ? album : { id: this.albumId, name: this.chapter.name, series: this.chapter.series || [], author: [] };
        this.chapters = chaptersOf(this.album, this.chapter);
        this.renderChapters();
        new Comments(document.querySelector(".reader-comments"), this.chapterId, { title: "本话评论" }).mount({ lazy: true });
        document.querySelector(".reader-afterword").hidden = false;
        this.bindLaterRemove();
        libraryStore.recordHistory(this.album).catch((error) => showToast(`历史保存失败：${error.message}`, "warning"));
        writeLocalStorage(`jm_last_chapter_${this.album.id}`, String(this.chapterId));
    }

    bind() {
        const images = document.querySelector(".reader-images");
        this.tools = document.querySelector(".reader-tools");
        this.slider = document.querySelector("[data-reader-slider]");
        this.slider.max = String(this.viewport.nodes.length);
        document.querySelector("[data-reader-settings]").onclick = (event) => appShell.openReading(event.currentTarget);
        document.querySelector("[data-reader-chapters]").onclick = (event) => this.openChapters(event.currentTarget);
        document.querySelector("[data-reader-progress]").onclick = (event) => this.openProgress(event.currentTarget);
        this.bindSlider();
        this.bindAutoHide();
        images.addEventListener("keydown", (event) => {
            if (event.target === images && (event.key === " " || event.key === "Enter")) {
                event.preventDefault();
                this.toggleTools();
            }
        });
        images.addEventListener("click", (event) => {
            if (event.target.closest("a, button, input, select, textarea") || event.defaultPrevented || window.getSelection()?.toString()) return;
            this.toggleTools();
        });
        document.addEventListener("keydown", (event) => {
            if (event.target.closest?.("input, textarea, select, button, [contenteditable]") || document.querySelector(".sheet.is-open")) return;
            if (event.key === "j" || event.key === "k") { event.preventDefault(); this.seek(this.viewport.current + (event.key === "j" ? 2 : 0)); }
            if (event.key === "Escape") this.setToolsHidden(false);
        });
        this.progress({ page: this.viewport.current + 1, pages: this.viewport.nodes.length });
    }

    setToolsHidden(hidden) {
        if (hidden === document.body.classList.contains("reader-focus")) return;
        if (hidden && this.tools.contains(document.activeElement)) document.querySelector(".reader-images").focus({ preventScroll: true });
        document.body.classList.toggle("reader-focus", hidden);
        this.tools.inert = hidden;
    }
    toggleTools() { this.setToolsHidden(!document.body.classList.contains("reader-focus")); }

    /** Seek from a control; the resulting jump is not reading, so it must not hide the panel. */
    seek(page) {
        this.quietUntil = performance.now() + 600;
        this.viewport.seek(page);
    }

    bindSlider() {
        const slider = this.slider;
        const position = document.querySelector("[data-reader-progress]");
        // Dragging only previews the page number; the seek happens once on release.
        slider.addEventListener("input", () => {
            this.scrubbing = true;
            position.classList.add("is-scrubbing");
            this.renderPosition(Number(slider.value), this.viewport.nodes.length);
        });
        slider.addEventListener("change", () => {
            this.scrubbing = false;
            position.classList.remove("is-scrubbing");
            this.seek(slider.value);
        });
    }

    /** Reading forward hides the panel; reaching the afterword or pointing at the panel's spot brings it back. */
    bindAutoHide() {
        const setHidden = (hidden) => this.setToolsHidden(hidden);
        let lastY = null, travel = 0;
        window.addEventListener("scroll", () => {
            const y = window.scrollY;
            const delta = lastY === null ? 0 : y - lastY;
            lastY = isPageScrollLocked() ? null : y;
            // Sheet scroll locks, seeks and image layout fixes move the page without the reader scrolling.
            if (!delta || isPageScrollLocked() || this.viewport.seeking !== null || performance.now() < (this.quietUntil || 0)
                || Math.abs(delta) > window.innerHeight * 1.5) { travel = 0; return; }
            travel = delta > 0 ? travel + delta : 0;
            if (travel > 48 && !this.atEnd) setHidden(true);
        }, { passive: true });
        new IntersectionObserver(([entry]) => {
            this.atEnd = entry.isIntersecting;
            if (this.atEnd) setHidden(false);
        }, { rootMargin: "0px 0px -25% 0px" }).observe(document.querySelector(".reader-afterword"));
        if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
            window.addEventListener("mousemove", (event) => {
                if (event.clientY > window.innerHeight - 96 && !document.querySelector(".sheet.is-open")) setHidden(false);
            }, { passive: true });
        }
    }

    progress(value) {
        if (!this.slider) return;
        if (!this.scrubbing) {
            this.renderPosition(value.page, value.pages);
            this.slider.value = String(value.page);
        }
        if (this.progressSheet && !this.progressSheet.isOpen) this.syncProgressForm(value);
    }

    renderPosition(page, pages) {
        document.querySelectorAll("[data-page-current]").forEach((node) => { node.textContent = page; });
        document.querySelectorAll("[data-page-total]").forEach((node) => { node.textContent = pages; });
        document.querySelector("[data-reader-progress]").setAttribute("aria-label", `第 ${page} 页，共 ${pages} 页，点击输入页码跳转`);
        this.slider.style.setProperty("--fill", `${pages > 1 ? ((page - 1) / (pages - 1)) * 100 : 100}%`);
        this.slider.setAttribute("aria-valuetext", `第 ${page} 页，共 ${pages} 页`);
    }

    bindLaterRemove() {
        const box = document.querySelector(".reader-later");
        const button = box.querySelector("button");
        const sync = () => { box.hidden = !libraryStore.isWatchLater(this.album.id); };
        button.onclick = async () => {
            button.disabled = true;
            try { await libraryStore.removeWatchLater(this.album.id); showToast("已移出稍后再看"); }
            catch (error) { showToast(error?.message || "移除失败，请重试", "warning"); }
            finally { button.disabled = false; sync(); }
        };
        window.addEventListener("jm-library-change", sync);
        libraryStore.init().then(sync).catch(() => {});
    }

    renderChapters() {
        const index = Math.max(0, this.chapters.findIndex((item) => String(item.id) === String(this.chapterId)));
        const current = this.chapters[index];
        document.querySelector("[data-reader-back]").href = detailUrl(this.album.id);
        document.querySelector(".reader-title").textContent = this.album.name || "漫画阅读";
        document.querySelector(".reader-subtitle").textContent = current.name;
        document.querySelector(".reader-end-title").textContent = `已读至「${current.name}」结尾`;
        document.title = `${current.name} · ${this.album.name || "JMComic"}`;
        this.tools.classList.toggle("is-single", this.chapters.length <= 1);
        document.querySelector("[data-reader-chapters]").disabled = this.chapters.length <= 1;
        for (const [kind, item] of [["prev", this.chapters[index - 1]], ["next", this.chapters[index + 1]]]) {
            document.querySelectorAll(`[data-reader-${kind}]`).forEach((link) => {
                if (item) { link.href = readerUrl(item.id, this.album.id); link.removeAttribute("aria-disabled"); link.tabIndex = 0; }
                else { link.removeAttribute("href"); link.setAttribute("aria-disabled", "true"); link.tabIndex = -1; }
            });
        }
        if (this.chapterSheet) this.renderChapterSheet();
    }

    openChapters(opener) {
        if (!this.chapters) return;
        if (!this.chapterSheet) { this.chapterSheet = new Sheet({ name: "chapters", title: "章节目录" }); this.renderChapterSheet(); }
        this.chapterSheet.open({ opener });
        // Long series: start the list at the chapter being read.
        const body = this.chapterSheet.body, item = body.querySelector("[aria-current]");
        if (item) body.scrollTop += item.getBoundingClientRect().top - body.getBoundingClientRect().top - (body.clientHeight - item.offsetHeight) / 2;
    }
    renderChapterSheet() {
        this.chapterSheet.body.innerHTML = `<div class="reader-chapter-list" data-navigation-scope="same-tab">${this.chapters.map((item, index) => `<a class="chapter-item" href="${readerUrl(item.id, this.album.id)}"${String(item.id) === String(this.chapterId) ? ' aria-current="page" data-autofocus' : ""}><span class="mono">${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(item.name)}</strong>${icon("chevronRight")}</a>`).join("")}</div>`;
    }

    openProgress(opener) {
        if (!this.progressSheet) {
            const pages = this.viewport.nodes.length;
            this.progressSheet = new Sheet({ name: "progress", title: "跳转页面" });
            this.progressSheet.body.innerHTML = `<form class="reader-progress-form"><label class="field"><span class="field-label">页码（1–${pages}）</span><input class="input" name="page" type="number" min="1" max="${pages}" inputmode="numeric" enterkeyhint="go" required /></label><div class="chip-row"><button class="chip" type="button" data-jump="1">第一页</button><button class="chip" type="button" data-jump="${pages}">最后一页</button></div><button class="btn btn-primary" type="submit">跳转</button></form>`;
            const form = this.progressSheet.body.querySelector("form");
            const go = (page) => { this.progressSheet.close(); this.seek(page); };
            form.onclick = (event) => { const chip = event.target.closest("[data-jump]"); if (chip) go(chip.dataset.jump); };
            form.onsubmit = (event) => { event.preventDefault(); go(form.elements.page.value); };
        }
        this.syncProgressForm({ page: this.viewport.current + 1 });
        this.progressSheet.open({ opener });
    }
    syncProgressForm({ page }) {
        const form = this.progressSheet.body.querySelector("form");
        form.elements.page.value = page;
    }
}

new ReaderPage().init().catch((error) => renderPageError(".reader-loading", error, { title: "章节加载失败", action: { href: location.href, label: "重新载入" } }));
