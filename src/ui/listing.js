import { jmApi } from "../api/JmcomicApi.js";
import { keepSingleChapterComics } from "../utils/ComicChapterFilter.js";
import { DEFAULT_LISTING_FILTERS, ORDER_LABELS, TIME_LABELS, listingFilterSummary, reconcileListingFilters } from "../utils/ListingFilters.js";
import { comicCardHtml } from "./comic-card.js";
import { hydrateCovers } from "./covers.js";
import { escapeHtml } from "./dom.js";
import { hydrateRichCards } from "./rich-cards.js";
import { Feed } from "./feed.js";
import { Sheet } from "./overlay.js";
import { stateHtml } from "./states.js";

const PAGE_SIZE = 80;
const compactQuery = window.matchMedia("(max-width: 699px)");

const choices = (entries, active) => entries.map(([value, label]) => `<button class="chip" type="button" data-value="${escapeHtml(value)}" aria-pressed="${String(value) === String(active)}">${escapeHtml(label)}</button>`).join("");

/**
 * Order / period / category / sub-category / single-chapter filters.
 * Inline on iPad and desktop; on iPhone the same node moves into a bottom sheet.
 */
export class ListingFilterPanel {
    constructor({ panel, toggle, reset, onChange }) {
        this.panel = panel;
        this.home = panel.parentElement;
        this.anchor = panel.nextSibling;
        this.toggle = toggle;
        this.resetButton = reset;
        this.onChange = onChange;
        this.filters = { ...DEFAULT_LISTING_FILTERS };
        this.categories = [];
    }

    init() {
        this.panel.innerHTML = `
            <div class="filter-group" data-filter="order"><h3 class="filter-label">排序</h3><div class="chip-row">${choices(Object.entries(ORDER_LABELS), this.filters.order)}</div></div>
            <div class="filter-group" data-filter="time"><h3 class="filter-label">时间 <small>周期榜只按观看量排序</small></h3><div class="chip-row">${choices(Object.entries(TIME_LABELS).map(([key, label]) => [key, key === "a" ? "全部" : label]), this.filters.time)}</div></div>
            <div class="filter-group" data-filter="category"><h3 class="filter-label">主分类</h3><div class="chip-row" data-category-options>${choices([["0", "全部"]], "0")}</div></div>
            <div class="filter-group" data-filter="mainTag" hidden><h3 class="filter-label">副分类</h3><div class="chip-row" data-subcategory-options></div></div>
            <div class="filter-group">
                <label class="switch"><input type="checkbox" data-hide-serial /><span class="switch-copy"><strong>只看单章</strong><small>隐藏章节数大于 1 的作品</small></span></label>
            </div>`;
        this.panel.addEventListener("click", (event) => {
            const button = event.target.closest(".chip[data-value]");
            if (!button || button.disabled || button.getAttribute("aria-pressed") === "true") return;
            this.select(button.closest("[data-filter]").dataset.filter, button);
        });
        this.panel.querySelector("[data-hide-serial]").addEventListener("change", (event) => {
            this.filters.hideSerial = event.currentTarget.checked;
            this.emit();
        });
        this.resetButton?.addEventListener("click", () => this.reset());
        this.sheet = new Sheet({ name: "filters", title: "筛选" });
        this.toggle?.addEventListener("click", () => this.sheet.open({ opener: this.toggle }));
        this.sheet.body.insertAdjacentHTML("beforeend", '<div class="filter-sheet-actions"><button class="btn btn-ghost" type="button" data-sheet-reset>重置</button><button class="btn btn-primary" type="button" data-sheet-done>查看结果</button></div>');
        this.sheet.body.querySelector("[data-sheet-reset]").addEventListener("click", () => this.reset());
        this.sheet.body.querySelector("[data-sheet-done]").addEventListener("click", () => this.sheet.close());
        const place = () => {
            if (compactQuery.matches) {
                this.sheet.body.prepend(this.panel);
            } else {
                this.sheet.close();
                this.home.insertBefore(this.panel, this.anchor);
            }
        };
        compactQuery.addEventListener?.("change", place);
        place();
        this.sync();
    }

    async loadCategories() {
        const data = await jmApi.getCategories();
        this.categories = (Array.isArray(data?.categories) ? data.categories : []).filter((item) => item?.type === "slug" && item.slug);
        this.panel.querySelector("[data-category-options]").innerHTML = choices([["0", "全部"], ...this.categories.map((item) => [item.slug, item.name])], this.filters.category);
        this.renderSubcategories();
        this.sync();
    }

    select(filter, button) {
        if (filter === "mainTag") {
            this.filters.mainTag = button.dataset.value;
            this.filters.subcategorySlug = button.dataset.slug || "";
        } else {
            this.filters[filter] = button.dataset.value;
        }
        if (filter === "category") {
            this.filters.mainTag = "0";
            this.filters.subcategorySlug = "";
            this.renderSubcategories();
        }
        this.filters = reconcileListingFilters(this.filters, filter);
        this.emit();
    }

    renderSubcategories() {
        const category = this.categories.find((item) => String(item.slug) === String(this.filters.category));
        const subcategories = Array.isArray(category?.sub_categories) ? category.sub_categories : [];
        const group = this.panel.querySelector('[data-filter="mainTag"]');
        group.hidden = !subcategories.length;
        group.querySelector("[data-subcategory-options]").innerHTML = subcategories.length
            ? `<button class="chip" type="button" data-value="0" data-slug="" aria-pressed="true">全部</button>${subcategories.map((item) => `<button class="chip" type="button" data-value="${escapeHtml(item.CID)}" data-slug="${escapeHtml(item.slug || "")}" aria-pressed="false">${escapeHtml(item.name)}</button>`).join("")}`
            : "";
    }

    reset() {
        this.filters = { ...DEFAULT_LISTING_FILTERS };
        this.renderSubcategories();
        this.emit();
    }

    sync() {
        this.panel.querySelectorAll("[data-filter]").forEach((group) => {
            const value = String(this.filters[group.dataset.filter] ?? "");
            group.querySelectorAll(".chip[data-value]").forEach((button) => {
                button.setAttribute("aria-pressed", String(button.dataset.value === value));
            });
        });
        const periodActive = this.filters.time !== "a";
        this.panel.querySelectorAll('[data-filter="order"] .chip').forEach((button) => {
            button.disabled = periodActive && button.dataset.value !== "mv";
        });
        const nonViewOrder = this.filters.order !== "mv";
        this.panel.querySelectorAll('[data-filter="time"] .chip').forEach((button) => {
            button.disabled = nonViewOrder && button.dataset.value !== "a";
        });
        this.panel.querySelector("[data-hide-serial]").checked = this.filters.hideSerial;
        const changed = ["order", "time", "category", "mainTag"].filter((key) => this.filters[key] !== DEFAULT_LISTING_FILTERS[key]).length
            + (this.filters.hideSerial ? 1 : 0);
        const badge = this.toggle?.querySelector("[data-filter-count]");
        if (badge) {
            badge.textContent = String(changed);
            badge.hidden = !changed;
        }
        if (this.resetButton) this.resetButton.disabled = !changed;
    }

    emit() {
        this.sync();
        this.onChange({ ...this.filters });
    }
}

/**
 * Infinite comic grid for a keyword or category listing.
 * Results from superseded filter combinations are discarded by the feed generation.
 */
export class ListingResults {
    constructor({ grid, footer, state, query = "" }) {
        this.grid = grid;
        this.state = state;
        this.query = query;
        this.filters = { ...DEFAULT_LISTING_FILTERS };
        this.renderedIds = new Set();
        this.comics = [];
        this.onAppend = null;
        this.maxPage = Infinity;
        this.feed = new Feed({ footer, loadPage: (page, isCurrent) => this.loadPage(page, isCurrent) });
    }

    setFilters(filters) {
        this.filters = { ...filters };
        this.comics = [];
        clearTimeout(this.debounce);
        this.feed.reset();
        // Keep the sentinel from starting an old page while a new filter is debounced.
        this.feed.loading = true;
        this.state.textContent = "正在应用筛选…";
        this.debounce = setTimeout(() => {
            this.grid.innerHTML = "";
            this.renderedIds.clear();
            this.maxPage = Infinity;
            this.feed.restart();
        }, 160);
    }

    async loadPage(page, isCurrent) {
        if (page > this.maxPage) return { done: true };
        const filters = { ...this.filters };
        const query = this.query;
        if (page === 1 && /^\d+$/.test(query) && Number(query) > 10 && filters.category === "0" && filters.time === "a") {
            // A numeric query may be a JM id: show the exact album first when it exists.
            try {
                const album = await jmApi.getComicAlbum(query);
                const direct = await keepSingleChapterComics([album], filters.hideSerial);
                if (isCurrent() && direct[0]?.name) this.append(direct);
            } catch { /* Keyword results below remain authoritative. */ }
        }
        let list;
        try {
            list = await jmApi.getFilteredComics(query, page, filters);
        } catch (error) {
            if (isCurrent()) {
                this.state.textContent = "结果暂时不可用";
                if (page === 1 && !this.renderedIds.size) this.grid.innerHTML = stateHtml({ tone: "error", title: "没能载入结果", message: error.message || "请稍后重试" });
            }
            throw error;
        }
        if (!isCurrent()) return { done: false };
        const content = Array.isArray(list?.content) ? list.content : [];
        if (filters.hideSerial && content.length) this.state.textContent = "正在核对章节数…";
        const visible = await keepSingleChapterComics(content, filters.hideSerial);
        if (!isCurrent()) return { done: false };
        const total = Number(list?.total || content.length);
        this.maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
        const summary = listingFilterSummary(filters);
        const totalLabel = total.toLocaleString("zh-CN");
        this.state.textContent = filters.hideSerial
            ? `${totalLabel} 条候选 · 已加载 ${this.renderedIds.size + visible.length} 个单章 · ${summary}`
            : `${totalLabel} 部作品 · ${summary}`;
        const added = this.append(visible);
        if (page === 1 && !this.renderedIds.size) {
            this.grid.innerHTML = stateHtml({ title: "没有符合条件的作品", message: "换个关键词，或放宽筛选条件试试。" });
        }
        return { done: !content.length || page >= this.maxPage, count: added };
    }

    append(list) {
        const unique = list.filter((comic) => {
            const id = String(comic?.id ?? "");
            if (!id || this.renderedIds.has(id)) return false;
            this.renderedIds.add(id);
            return true;
        });
        if (!unique.length) return 0;
        this.comics.push(...unique);
        this.grid.querySelector(".state")?.remove();
        const fragment = document.createElement("template");
        fragment.innerHTML = unique.map((comic) => comicCardHtml(comic)).join("");
        const nodes = [...fragment.content.children];
        this.grid.append(...nodes);
        nodes.forEach((node) => hydrateCovers(node));
        hydrateRichCards(this.grid);
        this.onAppend?.(unique);
        return unique.length;
    }
}
