import { jmApi } from "../api/JmcomicApi.js";
import { libraryStore } from "../data/LibraryStore.js";
import { writeLocalStorage } from "../utils/BrowserStorage.js";
import { mountShell, appShell } from "../ui/shell.js";
import { chaptersOf } from "../ui/chapters.js";
import { detailUrl, escapeHtml, readerUrl } from "../ui/dom.js";
import { Comments } from "../ui/comments.js";
import { Sheet } from "../ui/overlay.js";
import { ReaderViewport } from "../reader/ReaderViewport.js";
import { icon } from "../ui/icons.js";
import { renderPageError } from "../ui/states.js";
import { showToast } from "../ui/toast.js";

export class ReaderPage {
    async init() {
        mountShell({ chrome: false });
        const params = new URLSearchParams(location.search);
        this.chapterId = params.get("id"); this.albumId = params.get("album");
        if (!/^\d+$/.test(this.chapterId || "") || (this.albumId && !/^\d+$/.test(this.albumId))) throw new Error("章节或作品 ID 无效");
        await jmApi.init();
        this.chapter = await jmApi.getComicChapter(this.chapterId);
        this.albumId ||= String(this.chapter.series_id || this.chapter.id);
        this.viewport = new ReaderViewport(document.querySelector(".reader-images"), this.chapter, (value) => this.progress(value));
        const startPage = Number(params.get("page"));
        if (Number.isInteger(startPage) && startPage > 1) this.viewport.seek(startPage);
        document.querySelector(".reader-loading").hidden = true;
        document.querySelector(".reader-actions").hidden = false;
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
        document.querySelector("[data-reader-settings]").onclick = (event) => appShell.openReading(event.currentTarget);
        document.querySelector("[data-reader-chapters]").onclick = (event) => this.openChapters(event.currentTarget);
        document.querySelector("[data-reader-progress]").onclick = (event) => this.openProgress(event.currentTarget);
        const images = document.querySelector(".reader-images");
        const tools = document.querySelector(".reader-tools");
        const setHidden = (hidden) => {
            if (hidden && tools.contains(document.activeElement)) images.focus({ preventScroll: true });
            document.body.classList.toggle("reader-focus", hidden);
            tools.inert = hidden;
        };
        images.addEventListener("keydown", (event) => {
            if (event.target === images && (event.key === " " || event.key === "Enter")) {
                event.preventDefault();
                setHidden(!document.body.classList.contains("reader-focus"));
            }
        });
        document.querySelector(".reader-images").addEventListener("click", (event) => {
            if (event.target.closest("a, button, input, select, textarea") || event.defaultPrevented || window.getSelection()?.toString()) return;
            setHidden(!document.body.classList.contains("reader-focus"));
        });
        document.addEventListener("keydown", (event) => {
            if (event.target.closest?.("input, textarea, select, button, [contenteditable]") || document.querySelector(".sheet.is-open")) return;
            if (event.key === "j" || event.key === "k") { event.preventDefault(); this.viewport.seek(this.viewport.current + (event.key === "j" ? 2 : 0)); }
            if (event.key === "Escape") setHidden(false);
        });
    }

    progress(value) {
        document.querySelector("[data-page-current]").textContent = value.page;
        document.querySelector("[data-page-total]").textContent = value.pages;
        document.querySelector("[data-reader-progress]").setAttribute("aria-label", `阅读进度，第 ${value.page} 页，共 ${value.pages} 页，点击跳转`);
        document.querySelector(".reader-track-fill").style.width = `${value.progress * 100}%`;
        if (this.progressSheet && !this.progressSheet.isOpen) this.syncProgressForm(value);
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
    }
    renderChapterSheet() {
        this.chapterSheet.body.innerHTML = `<div class="reader-chapter-list" data-navigation-scope="same-tab">${this.chapters.map((item, index) => `<a class="chapter-item" href="${readerUrl(item.id, this.album.id)}"${String(item.id) === String(this.chapterId) ? ' aria-current="page"' : ""}><span class="mono">${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(item.name)}</strong>${icon("chevronRight")}</a>`).join("")}</div>`;
    }

    openProgress(opener) {
        if (!this.progressSheet) {
            this.progressSheet = new Sheet({ name: "progress", title: "跳转页面" });
            this.progressSheet.body.innerHTML = `<form class="reader-progress-form"><label class="field"><span class="field-label">页码</span><input class="input" name="page" type="number" min="1" max="${this.viewport.nodes.length}" inputmode="numeric" required /></label><input name="slider" type="range" min="1" max="${this.viewport.nodes.length}" step="1" aria-label="选择页码" /><p class="picker-note">共 ${this.viewport.nodes.length} 页 · 也可以用键盘 J / K 翻页</p><button class="btn btn-primary" type="submit">跳转</button></form>`;
            const form = this.progressSheet.body.querySelector("form");
            form.elements.slider.oninput = () => { form.elements.page.value = form.elements.slider.value; };
            form.elements.page.oninput = () => { form.elements.slider.value = form.elements.page.value; };
            form.onsubmit = (event) => { event.preventDefault(); const page = form.elements.page.value; this.progressSheet.close(); this.viewport.seek(page); };
        }
        this.syncProgressForm({ page: this.viewport.current + 1 });
        this.progressSheet.open({ opener });
    }
    syncProgressForm({ page }) {
        const form = this.progressSheet.body.querySelector("form");
        form.elements.page.value = page; form.elements.slider.value = page;
    }
}

new ReaderPage().init().catch((error) => renderPageError(".reader-loading", error, { title: "章节加载失败", action: { href: location.href, label: "重新载入" } }));
