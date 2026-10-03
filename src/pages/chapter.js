import { jmApi } from "../api/JmcomicApi.js";
import { translateTitleToSimplifiedChinese } from "../api/GoogleTranslateApi.js";
import { readLocalStorage } from "../utils/BrowserStorage.js";
import { mountShell } from "../ui/shell.js";
import { asText, authorsOf, escapeHtml, formatCount, formatDate, isApiTrue, readerUrl, searchUrl, textList } from "../ui/dom.js";
import { coverHtml, hydrateCovers } from "../ui/covers.js";
import { comicCardHtml } from "../ui/comic-card.js";
import { hydrateRichCards } from "../ui/rich-cards.js";
import { chaptersOf } from "../ui/chapters.js";
import { Comments } from "../ui/comments.js";
import { PagePreview } from "../ui/page-preview.js";
import { loadPreferences, preferenceAuthorsHtml, preferenceTagsHtml } from "../ui/preferences.js";
import { icon } from "../ui/icons.js";
import { renderPageError } from "../ui/states.js";
import { showToast } from "../ui/toast.js";
import { watchLaterButtonHtml } from "../ui/watch-later.js";

const links = (values) => textList(values).map((value) => `<a class="tag" href="${searchUrl(value)}">${escapeHtml(value)}</a>`).join("");

class ChapterPage {
    async init() {
        mountShell();
        const id = new URLSearchParams(location.search).get("id");
        if (!/^\d+$/.test(id || "")) throw new Error("漫画 ID 无效");
        await jmApi.init();
        const album = await jmApi.getComicAlbum(id);
        if (!album?.id || !asText(album.name)) throw new Error("没有找到这本作品");
        this.album = album;
        this.chapters = chaptersOf(album);
        this.originalTitle = album.name;
        this.root = document.querySelector(".detail-content");
        document.title = `${album.name} · JMComic`;
        this.render();
        this.bind();
        this.renderChapters();
        loadPreferences().then((preferences) => {
            this.root.querySelector(".detail-authors").innerHTML = preferenceAuthorsHtml(authorsOf(album), preferences.authors, { link: true });
            this.root.querySelector(".detail-tags").innerHTML = preferenceTagsHtml(album.tags, preferences.tags);
        });
        const first = this.chapters[0];
        new PagePreview(this.root.querySelector(".detail-preview"), album, { id: first.id, label: this.chapters.length > 1 ? "第 1 章" : "全篇" }).mount();
        new Comments(this.root.querySelector(".detail-comments"), id, { total: album.comment_total }).mount();
    }

    render() {
        const album = this.album;
        this.root.innerHTML = `<header class="detail-hero">
            <div class="detail-cover">${coverHtml(album, { eager: true })}</div>
            <div class="detail-copy"><p class="eyebrow">JM ${escapeHtml(album.id)} · ${this.chapters.length > 1 ? "系列作品" : "单篇作品"}</p>
                <h1 class="detail-title">${escapeHtml(album.name)}</h1>
                <div class="detail-byline"><span class="detail-authors">${preferenceAuthorsHtml(authorsOf(album), undefined, { link: true })}</span><button class="btn btn-ghost btn-sm" type="button" data-translate aria-pressed="false">${icon("translate")}<span>翻译标题</span></button></div>
                <div class="tag-list detail-tags">${preferenceTagsHtml(album.tags)}</div>
                <p class="detail-description">${escapeHtml(asText(album.description, "暂无作品简介"))}</p>
                <dl class="detail-stats"><div><dt>章节</dt><dd>${this.chapters.length}</dd></div><div><dt>页数</dt><dd>${escapeHtml(album.total_photos ?? "—")}</dd></div><div><dt>观看</dt><dd>${formatCount(album.total_views)}</dd></div><div><dt>喜欢</dt><dd>${formatCount(album.likes)}</dd></div></dl>
                <div class="detail-actions"><a class="btn btn-primary" data-start-read data-navigation="same-tab">${icon("play")}开始阅读</a>${watchLaterButtonHtml(album)}</div>
            </div></header>
            <div class="detail-layout"><div class="detail-primary">
                <section class="section detail-preview" aria-labelledby="preview-title"><div class="section-head"><h2 class="section-title" id="preview-title">内容预览</h2><span class="section-meta" data-preview-meta></span></div><div class="preview-strip" data-navigation-scope="same-tab"><span class="preview-page" data-state="loading"></span><span class="preview-page" data-state="loading"></span><span class="preview-page" data-state="loading"></span></div></section>
                <section class="section"><div class="section-head"><h2 class="section-title">目录</h2><span class="section-meta">${this.chapters.length} 章</span></div><div class="chapter-list" data-navigation-scope="same-tab"></div></section>
                <section class="section detail-comments"></section>
            </div><aside class="detail-secondary">
                <section class="section detail-info"><h2 class="section-title">作品资料</h2><dl>${[["发布", formatDate(album.addtime) || "未知"], ["评论", album.comment_total ?? 0], ["编号", album.id], ["类型", isApiTrue(album.is_aids) ? "章节合集" : this.chapters.length > 1 ? "系列" : "单篇"], ["价格", album.price || "免费"], ["购买状态", album.purchased || "无需购买"], ["原始链接", album.real_link || "无"]].map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl><h3>关联作品</h3><div class="tag-list">${links(album.works) || "暂无"}</div><h3>角色</h3><div class="tag-list">${links(album.actors) || "暂无"}</div></section>
            </aside></div>
            <section class="section related"><div class="section-head"><h2 class="section-title">相关作品</h2></div><div class="comic-grid">${(Array.isArray(album.related_list) ? album.related_list : []).map((item) => comicCardHtml(item)).join("")}</div></section>`;
        this.root.querySelector(".related").hidden = !album.related_list?.length;
        hydrateCovers(this.root);
        hydrateRichCards(this.root);
    }

    bind() {
        this.root.querySelector("[data-translate]").onclick = () => this.translate();
    }

    renderChapters() {
        const last = readLocalStorage(`jm_last_chapter_${this.album.id}`);
        const selected = this.chapters.find((item) => String(item.id) === last) || this.chapters[0];
        this.root.querySelector(".chapter-list").innerHTML = this.chapters.map((item, index) => `<a href="${readerUrl(item.id, this.album.id)}" class="chapter-item"${String(item.id) === last ? ' aria-current="true"' : ""}><span class="mono">${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(item.name)}</strong>${icon("chevronRight")}</a>`).join("");
        const start = this.root.querySelector("[data-start-read]");
        start.href = readerUrl(selected.id, this.album.id);
        start.innerHTML = `${icon("play")}${last ? "继续阅读" : "开始阅读"}`;
    }

    async translate() {
        const button = this.root.querySelector("[data-translate]");
        if (button.disabled) return;
        button.disabled = true;
        try {
            if (this.translated) this.translated = false;
            else {
                this.translation ||= await translateTitleToSimplifiedChinese(this.originalTitle);
                this.translated = Boolean(this.translation);
            }
            const title = this.translated ? this.translation : this.originalTitle;
            this.root.querySelector(".detail-title").textContent = title;
            document.title = `${title} · JMComic`;
            button.querySelector("span").textContent = this.translated ? "显示原文" : "翻译标题";
            button.setAttribute("aria-pressed", String(this.translated));
        } catch (error) { showToast(error.message || "翻译失败", "warning"); }
        finally { button.disabled = false; }
    }
}

new ChapterPage().init().catch((error) => renderPageError(".detail-content", error, { title: "作品加载失败", action: { href: location.href, label: "重新载入" } }));
