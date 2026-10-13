import { jmApi } from "../api/JmcomicApi.js";
import { libraryStore } from "../data/LibraryStore.js";
import { comicCardHtml } from "../ui/comic-card.js";
import { coverHtml, hydrateCovers } from "../ui/covers.js";
import { asText, authorsOf, detailUrl, escapeHtml, formatCount, formatDateTime, searchUrl, textList } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { hydrateRichCards } from "../ui/rich-cards.js";
import { loadPreferences, preferenceAuthorsHtml, preferenceLegendHtml, preferenceTagsHtml } from "../ui/preferences.js";
import { mountShell } from "../ui/shell.js";
import { renderPageError, stateHtml } from "../ui/states.js";
import { showToast } from "../ui/toast.js";
import { checkTrackingUpdates, hasUpdate, trackedByUpdate, updatedLabel } from "../ui/tracking.js";
import { syncWatchLaterButtons } from "../ui/watch-later.js";

const MAX_RANDOM_ATTEMPTS = 12;
const RANDOM_BATCH_SIZE = 4;
const FALLBACK_IDS = ["1436985", "1433587", "1428159"];
const HIDDEN_SECTIONS = new Set(["creator", "novels"]);
const CURATED_SECTION = /推荐|精选|本本/i;

/**
 * "随机一本": validates random 6/7-digit IDs in parallel batches, falls back to a
 * known-good shortlist, and keeps a pageable history of every validated pick.
 */
class RandomPick {
    currentId = "";
    loading = false;
    history = [];
    currentIndex = -1;
    coverRequest = 0;

    constructor(root) {
        this.root = root;
        this.q = (name) => root.querySelector(`[data-random-${name}]`);
    }

    async init() {
        this.q("trigger").addEventListener("click", () => this.pick());
        this.q("prev").addEventListener("click", () => this.showHistoryAt(this.currentIndex + 1, "older"));
        this.q("next").addEventListener("click", () => this.showHistoryAt(this.currentIndex - 1, "newer"));
        this.root.addEventListener("keydown", (event) => {
            if (event.target.closest("input, textarea")) return;
            if (event.key === "ArrowLeft") this.q("prev").click();
            if (event.key === "ArrowRight") this.q("next").click();
        });
        // A temporary history failure must not leave the random button unbound.
        await libraryStore.init().catch(() => {});
        this.history = libraryStore.getRandomHistory();
        await this.pick();
    }

    async pick() {
        if (this.loading) return;
        this.setLoading(true);
        try {
            const { album, id, fallback } = await this.findValidAlbum();
            await this.render(album, id, {
                record: true,
                direction: "newer",
                status: fallback ? "已改为精选推荐" : "",
            });
        } catch (error) {
            this.q("status").textContent = error?.message || "随机验证失败，请再试一次";
            if (!this.currentId) {
                this.q("title").textContent = "这次没有找到有效作品";
                this.q("author").textContent = "";
            }
        } finally {
            this.setLoading(false);
        }
    }

    async findValidAlbum() {
        const attempted = new Set();
        let lastError;
        for (let offset = 0; offset < MAX_RANDOM_ATTEMPTS; offset += RANDOM_BATCH_SIZE) {
            const candidates = [];
            while (candidates.length < RANDOM_BATCH_SIZE) {
                const id = this.candidateId();
                if (id === this.currentId || attempted.has(id)) continue;
                attempted.add(id);
                candidates.push({ id, attempt: offset + candidates.length + 1 });
            }
            this.q("id").textContent = `JM ${candidates[0].id}`;
            this.q("status").textContent = "正在抽取";
            try {
                return await Promise.any(candidates.map(async ({ id, attempt }) => {
                    const album = await jmApi.getComicAlbum(id, { maxServers: 1, timeoutMs: 5000 });
                    if (!this.isValid(album, id)) throw new Error(`漫画 ${id} 无效`);
                    return { album, id, attempts: attempt, fallback: false };
                }));
            } catch (error) {
                lastError = error;
            }
        }
        for (const id of FALLBACK_IDS) {
            if (id === this.currentId) continue;
            try {
                const album = await jmApi.getComicAlbum(id, { maxServers: 2, timeoutMs: 8000 });
                if (this.isValid(album, id)) return { album, id, attempts: MAX_RANDOM_ATTEMPTS, fallback: true };
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError?.errors?.[0] || lastError || new Error("暂时没有找到有效的随机漫画");
    }

    candidateId() {
        const digits = Math.random() < 0.5 ? 6 : 7;
        const min = digits === 6 ? 100000 : 1000000;
        const max = digits === 6 ? 999999 : 1499999;
        return String(min + Math.floor(Math.random() * (max - min + 1)));
    }

    isValid(album, id) {
        return Boolean(album && !Array.isArray(album) && typeof album === "object" && String(album.id) === id && asText(album.name));
    }

    async render(album, id, { record = false, direction = "newer", status = "" } = {}) {
        const title = asText(album.name, `漫画 #${id}`);
        const authors = authorsOf(album);
        const tags = textList(album.tags).slice(0, 8);
        const chapters = Number(album.chapters || (Array.isArray(album.series) && album.series.length) || 1);
        const coverUrl = asText(album.cover_url || album.coverUrl, jmApi.getCoverImageURL(id));
        const href = detailUrl(id);
        const preferences = await loadPreferences();

        if (record) {
            try {
                await libraryStore.recordRandomHistory({ ...album, id, name: title, author: authors, tags, chapters, cover_url: coverUrl });
                this.history = libraryStore.getRandomHistory();
                this.currentIndex = this.history.findIndex((item) => String(item.id) === id);
            } catch {
                this.currentIndex = -1;
                status = "历史保存失败";
            }
        }
        if (this.currentId && this.currentId !== id) this.animate(direction);
        this.currentId = id;

        this.q("id").textContent = `JM ${id}`;
        this.q("status").textContent = status;
        this.q("title").textContent = title;
        this.q("author").innerHTML = preferenceAuthorsHtml(authors, preferences.authors, { link: true, fallback: "未知作者" });
        this.q("chapters").textContent = String(chapters);
        this.q("pages").textContent = String(album.total_photos ?? "—");
        // History saved before views/likes were recorded has neither field.
        this.q("views").textContent = album.total_views == null ? "—" : formatCount(album.total_views);
        this.q("likes").textContent = album.likes == null ? "—" : formatCount(album.likes);
        // Rank the full tag list, so a liked tag past the first eight still makes the card.
        this.q("tags").innerHTML = preferenceTagsHtml(album.tags, preferences.tags, { prioritize: true });

        const open = this.q("open");
        open.href = href;
        open.removeAttribute("aria-disabled");
        const cover = this.q("cover");
        cover.href = href;
        cover.removeAttribute("aria-disabled");
        cover.setAttribute("aria-label", `查看《${title}》详情`);
        const later = this.q("later");
        later.dataset.watchLater = JSON.stringify({ id, name: title, author: authors, cover_url: coverUrl });
        later.disabled = false;
        syncWatchLaterButtons(this.root);
        this.mountCover(cover, [coverUrl, jmApi.getCoverImageURL(id)], title);
        this.renderPager();
    }

    mountCover(cover, sources, title) {
        const request = ++this.coverRequest;
        const unique = [...new Set(sources.filter(Boolean))];
        const backdrop = this.root.querySelector(".random-backdrop img");
        const image = document.createElement("img");
        image.alt = `${title}封面`;
        image.decoding = "async";
        cover.classList.remove("is-ready", "is-error");
        cover.classList.add("is-loading");
        backdrop.classList.remove("is-loaded");
        let index = 0;
        image.onload = () => {
            if (request !== this.coverRequest) return;
            image.classList.add("is-loaded");
            cover.classList.add("is-ready");
            backdrop.onload = () => { if (request === this.coverRequest) backdrop.classList.add("is-loaded"); };
            backdrop.src = image.src;
        };
        image.onerror = () => {
            if (request !== this.coverRequest) return;
            index += 1;
            if (index < unique.length) image.src = unique[index];
            else cover.classList.add("is-ready", "is-error");
        };
        cover.replaceChildren(image);
        image.src = unique[0];
    }

    animate(direction) {
        this.root.dataset.direction = direction;
        this.root.querySelectorAll(".random-cover, .random-copy, .random-stats, .random-tags").forEach((node) => {
            node.classList.remove("is-swapping");
            void node.offsetWidth;
            node.classList.add("is-swapping");
        });
    }

    showHistoryAt(index, direction) {
        if (this.loading || index < 0 || index >= this.history.length || index === this.currentIndex) return;
        const item = this.history[index];
        this.currentIndex = index;
        this.render(item, String(item.id), { direction });
    }

    renderPager() {
        const total = this.history.length;
        this.q("prev").disabled = this.loading || this.currentIndex + 1 >= total;
        this.q("next").disabled = this.loading || this.currentIndex <= 0;
        this.q("position").textContent = total && this.currentIndex >= 0
            ? `${total - this.currentIndex} / ${total}`
            : "—";
    }

    setLoading(loading) {
        this.loading = loading;
        this.root.setAttribute("aria-busy", String(loading));
        this.root.classList.toggle("is-loading", loading);
        this.q("trigger").disabled = loading;
        // A spinner replaces the label while drawing, so the button keeps its width.
        this.q("trigger").classList.toggle("is-busy", loading);
        this.renderPager();
    }
}

const sideAuthorHtml = (item) => {
    const author = authorsOf(item)[0];
    return author ? `<a class="author-name" href="${searchUrl(author)}">${escapeHtml(author)}</a>` : "未知作者";
};

const savedMeta = (item) => (item.savedAt ? formatDateTime(item.savedAt) : "");

function renderSideList(section, items, { removable = false, meta = savedMeta, highlight = () => false } = {}) {
    section.hidden = !items.length;
    const side = section.closest(".home-side");
    side.removeAttribute("data-pending");
    side.hidden = [...side.querySelectorAll(".continue")].every((node) => node.hidden);
    if (!items.length) return;
    section.querySelector(".continue-list").innerHTML = items.map((item) => {
        const title = asText(item.name ?? item.title, "未命名作品");
        const href = detailUrl(item.id);
        return `<li class="continue-item${removable ? " later-item" : ""}${highlight(item) ? " is-highlight" : ""}">
            ${coverHtml(item, { href })}
            <div class="continue-copy">
                <a class="continue-title" href="${href}">${escapeHtml(title)}</a>
                <span class="continue-meta">${sideAuthorHtml(item)}${meta(item) ? ` · ${escapeHtml(meta(item))}` : ""}</span>
            </div>
            ${removable ? `<button class="later-remove" type="button" data-later-remove="${escapeHtml(item.id)}" aria-label="从稍后再看移除《${escapeHtml(title)}》" title="移除">${icon("close")}</button>` : ""}
        </li>`;
    }).join("");
    hydrateCovers(section);
}

function renderContinueReading() {
    renderSideList(document.querySelector(".continue.reading"), libraryStore.getHistory().slice(0, 8));
}

function renderTracking() {
    renderSideList(document.querySelector(".continue.tracking"), trackedByUpdate().slice(0, 8), {
        meta: (item) => `${hasUpdate(item) ? "有更新 · " : ""}更新于 ${updatedLabel(item.updatedAt)}`,
        highlight: hasUpdate,
    });
}

function renderWatchLater() {
    renderSideList(document.querySelector(".continue.later"), libraryStore.getWatchLater().slice(0, 8), { removable: true });
}

function bindWatchLater() {
    const section = document.querySelector(".continue.later");
    section.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-later-remove]");
        if (!button || button.disabled) return;
        button.disabled = true;
        try {
            await libraryStore.removeWatchLater(button.dataset.laterRemove);
        } catch (error) {
            button.disabled = false;
            showToast(error?.message || "移除失败，请重试", "warning");
        }
    });
    window.addEventListener("jm-library-change", () => {
        renderWatchLater();
        renderTracking();
        renderContinueReading();
    });
}

const cleanLabel = (value) => String(value || "").replace(/[→>-]*右滑看更多[→>-]*/gi, "").replace(/\s+/g, " ").trim();
const displaySlug = (slug) => {
    const value = cleanLabel(slug);
    if (/^hanman$/i.test(value)) return "韩漫";
    if (/^another$/i.test(value)) return "其他更新";
    return value;
};

async function renderShelves() {
    const root = document.querySelector(".shelves");
    const [promotion, preferences] = await Promise.all([jmApi.getPromotionContent(), loadPreferences()]);
    const visible = (Array.isArray(promotion) ? promotion : []).filter((section) => {
        const slug = String(section?.slug || "").trim().toLowerCase();
        const title = String(section?.title || "").trim();
        return !HIDDEN_SECTIONS.has(slug) && title !== "禁漫书库" && title !== "禁漫小说"
            && Array.isArray(section.content) && section.content.length;
    });
    const curated = visible.findIndex((section) => CURATED_SECTION.test(`${section?.title || ""} ${section?.slug || ""}`));
    const sections = curated > 0 ? [visible[curated], ...visible.slice(0, curated), ...visible.slice(curated + 1)] : visible;

    root.setAttribute("aria-busy", "false");
    if (!sections.length) {
        root.innerHTML = stateHtml({ title: "今天的书架还是空的", message: "稍后再来看看，或者去分类里逛逛。", action: { href: "./categories.html", label: "浏览分类" } });
        return;
    }
    root.innerHTML = preferenceLegendHtml(preferences) + sections.map((section, sectionIndex) => {
        const title = cleanLabel(section.title);
        const slug = displaySlug(section.slug);
        const heading = slug || title || "精选";
        const sub = slug && title && slug !== title ? title : "";
        return `<section class="section shelf" aria-labelledby="shelf-${sectionIndex}">
            <div class="section-head">
                <h2 class="section-title" id="shelf-${sectionIndex}">${escapeHtml(heading)}${sub ? ` <small class="shelf-sub">${escapeHtml(sub)}</small>` : ""}</h2>
                <span class="section-meta num">${section.content.length} 部</span>
            </div>
            <div class="comic-grid shelf-items">${section.content.map((comic) => comicCardHtml(comic)).join("")}</div>
        </section>`;
    }).join("");
    hydrateCovers(root);
    hydrateRichCards(root);
}

class HomePage {
    async init() {
        mountShell();
        document.querySelector("[data-today]").textContent = new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
        await jmApi.init();
        bindWatchLater();
        const random = new RandomPick(document.querySelector(".random"));
        // The random pick and the shelves are independent; load them side by side.
        await Promise.all([
            random.init()
                .catch((error) => { document.querySelector("[data-random-status]").textContent = error.message || "随机历史暂时不可用"; })
                .finally(() => {
                    renderWatchLater(); renderTracking(); renderContinueReading();
                    // Stale series are re-checked quietly; the list re-renders on change.
                    checkTrackingUpdates().catch(() => {});
                }),
            renderShelves().catch((error) => renderPageError(".shelves", error, { title: "书架加载失败", action: null })),
        ]);
    }
}

new HomePage().init().catch((error) => renderPageError(".home-layout", error, { title: "首页加载失败", action: null }));
