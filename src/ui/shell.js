import { setting } from "../core/Setting.js";
import { openInNewPage } from "../utils/NavigationPolicy.js";
import { escapeHtml, pageName, searchUrl } from "./dom.js";
import { icon } from "./icons.js";
import { Sheet } from "./overlay.js";
import { mountReadingControls } from "./reading-controls.js";
import { attachSearchHistory, mountSearchHistorySection } from "./search-history.js";

/* Information architecture. `rail` is the short label used on the iPad-portrait rail. */
const PRIMARY = [
    { page: "index", label: "发现", rail: "发现", icon: "discover" },
    { page: "latest", label: "最新更新", rail: "最新", icon: "latest" },
    { page: "categories", label: "分类浏览", rail: "分类", icon: "categories" },
];
const PERSONAL = [
    { page: "library", label: "书架", rail: "书架", icon: "library" },
];
const HOT_TAGS = ["巨乳", "乳汁", "修女", "催眠", "女仆", "怪物女孩", "常识改变"];

const navLink = (item, current) => `
    <a class="nav-item" href="./${item.page}.html"${item.page === current ? ' aria-current="page"' : ""} aria-label="${item.label}">
        ${icon(item.icon)}<span class="nav-item-label">${item.label}</span><span class="nav-item-short" aria-hidden="true">${item.rail}</span>
    </a>`;

class AppShell {
    mounted = false;

    /** Render navigation for a page. Reader pages pass `chrome: false` and only get sheets + toasts. */
    mount({ chrome = true } = {}) {
        if (this.mounted) return this;
        this.mounted = true;
        this.current = pageName();
        setting.init();
        if (chrome) {
            this.renderNavigation();
            this.bindShortcuts();
        }
        return this;
    }

    renderNavigation() {
        const current = this.current;
        const nav = document.createElement("nav");
        nav.className = "app-nav";
        nav.setAttribute("aria-label", "主导航");
        nav.dataset.navigationScope = "same-tab";
        nav.innerHTML = `
            <a class="brand" href="./index.html" aria-label="JMComic 发现">
                <img src="./image/b5c2a091-eb74-4b78-99dd-b52dc2a1dfe5.png" alt="" width="32" height="32" />
                <span class="brand-name">JM<b>Comic</b></span>
            </a>
            <form class="nav-search" role="search">
                ${icon("search")}
                <input type="search" name="q" enterkeyhint="search" autocomplete="off" placeholder="搜索作品、作者、番号" aria-label="搜索" />
                <kbd aria-hidden="true">/</kbd>
            </form>
            <div class="nav-group">
                <button class="nav-item nav-search-button" type="button" data-open-search aria-label="搜索">${icon("search")}<span class="nav-item-short" aria-hidden="true">搜索</span></button>
                ${PRIMARY.map((item) => navLink(item, current)).join("")}
            </div>
            <div class="nav-group">
                <span class="nav-label">我的</span>
                ${PERSONAL.map((item) => navLink(item, current)).join("")}
            </div>
            <div class="nav-footer">
                <button class="nav-item" type="button" data-open-reading aria-label="图片线路与加载">${icon("source")}<span class="nav-item-label" data-source-label>图源 1</span><span class="nav-item-short" aria-hidden="true">图源</span></button>
                ${navLink({ page: "setting", label: "设置", rail: "设置", icon: "settings" }, current)}
            </div>`;

        const mobileHeader = document.createElement("header");
        mobileHeader.className = "mobile-header";
        mobileHeader.dataset.navigationScope = "same-tab";
        mobileHeader.innerHTML = `
            <div class="mobile-masthead">
                <button class="icon-btn" type="button" data-toggle-menu aria-label="展开导航菜单" aria-expanded="false" aria-controls="mobile-navigation">${icon("menu")}</button>
                <a class="mobile-brand" href="./index.html" aria-label="JMComic 发现">JM<b>Comic</b></a>
                <button class="icon-btn" type="button" data-open-search aria-label="搜索" aria-haspopup="dialog">${icon("search")}</button>
            </div>
            <nav class="mobile-navigation" id="mobile-navigation" aria-label="主导航" hidden>
                ${[...PRIMARY, ...PERSONAL, { page: "setting", label: "设置", rail: "设置", icon: "settings" }].map((item) => navLink(item, current)).join("")}
                <div class="mobile-menu-actions">
                    <button class="nav-item" type="button" data-open-reading>${icon("source")}<span>图源与加载</span></button>
                </div>
            </nav>`;
        document.body.prepend(nav, mobileHeader);
        this.nav = nav;
        const menuToggle = mobileHeader.querySelector("[data-toggle-menu]");
        const menu = mobileHeader.querySelector(".mobile-navigation");
        this.menuSheet = new Sheet({
            name: "navigation", title: "导航菜单",
            onOpen: () => menuToggle.setAttribute("aria-expanded", "true"),
            onClose: () => menuToggle.setAttribute("aria-expanded", "false"),
        });
        this.menuSheet.root.classList.add("navigation-drawer");
        menu.hidden = false;
        menu.dataset.navigationScope = "same-tab";
        this.menuSheet.body.appendChild(menu);
        menuToggle.setAttribute("aria-haspopup", "dialog");
        menuToggle.addEventListener("click", () => this.menuSheet.toggle({ opener: menuToggle }));
        menu.addEventListener("click", (event) => {
            if (event.target.closest("a, button")) this.menuSheet.close();
        });
        const desktop = window.matchMedia("(min-width: 700px)");
        desktop.addEventListener("change", () => {
            if (desktop.matches) this.menuSheet.close();
        });

        nav.querySelector(".nav-search").addEventListener("submit", (event) => {
            event.preventDefault();
            this.submitSearch(event.currentTarget.elements.q.value);
        });
        attachSearchHistory(nav.querySelector(".nav-search"), (query) => this.submitSearch(query));
        document.addEventListener("click", (event) => {
            const trigger = event.target.closest("[data-open-search], [data-open-more], [data-open-reading]");
            if (!trigger) return;
            const opener = trigger.closest(".mobile-navigation") ? menuToggle : trigger;
            if (trigger.hasAttribute("data-open-search")) this.openSearch(opener);
            else if (trigger.hasAttribute("data-open-more")) this.openMore(opener);
            else if (trigger.hasAttribute("data-open-reading")) this.openReading(opener);
        });
        const renderSource = () => {
            nav.querySelector("[data-source-label]").textContent = `图源 ${Number(setting.using_imgserver_index) + 1} · 并发 ${setting.image_load_batch_size}`;
        };
        window.addEventListener("jm-image-server-change", renderSource);
        window.addEventListener("jm-settings-change", renderSource);
        renderSource();
    }

    bindShortcuts() {
        document.addEventListener("keydown", (event) => {
            const typing = event.target.closest?.("input, textarea, select, [contenteditable]");
            const commandK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
            if (!commandK && (typing || event.key !== "/")) return;
            event.preventDefault();
            const input = this.nav?.querySelector(".nav-search input");
            if (input && input.offsetParent !== null) {
                input.focus();
                input.select();
            } else {
                this.openSearch();
            }
        });
    }

    submitSearch(value) {
        const query = String(value || "").trim();
        if (!query) return false;
        const url = searchUrl(query);
        this.searchSheet?.close();
        // The search page records the keyword when it opens.
        if (this.current === "search") window.location.assign(url);
        else openInNewPage(url);
        return true;
    }

    openSearch(opener) {
        if (!this.searchSheet) {
            this.searchSheet = new Sheet({ name: "search", title: "搜索" });
            this.searchSheet.body.innerHTML = `
                <form class="search-form" role="search">
                    ${icon("search", "search-icon")}
                    <input class="input" type="search" name="q" enterkeyhint="search" autocomplete="off" placeholder="作品、作者或番号" aria-label="搜索关键词" data-autofocus />
                    <button class="btn btn-primary btn-sm search-submit" type="submit">搜索</button>
                </form>
                <div class="sheet-section search-history-section" style="margin-top:22px" hidden></div>
                <div class="sheet-section" style="margin-top:22px">
                    <h3 class="sheet-section-title">常用标签</h3>
                    <div class="chip-row">${HOT_TAGS.map((tag) => `<button class="chip" type="button" data-search-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("")}</div>
                </div>
                <div class="sheet-section" data-navigation-scope="same-tab">
                    <a class="group group-row" href="./categories.html">${icon("categories")}<span class="group-row-copy"><strong>按分类与排行浏览</strong><small>主分类、副分类、时间与排序</small></span>${icon("chevronRight", "chevron")}</a>
                </div>`;
            const form = this.searchSheet.body.querySelector("form");
            form.addEventListener("submit", (event) => {
                event.preventDefault();
                this.submitSearch(form.elements.q.value);
            });
            this.searchSheet.body.addEventListener("click", (event) => {
                const tag = event.target.closest("[data-search-tag]");
                if (tag) this.submitSearch(tag.dataset.searchTag);
            });
            mountSearchHistorySection(this.searchSheet.body.querySelector(".search-history-section"), (query) => this.submitSearch(query));
        }
        if (this.current === "search") {
            const query = new URLSearchParams(location.search).get("sq") || "";
            this.searchSheet.body.querySelector("input").value = query;
        }
        this.searchSheet.open({ opener });
    }

    openMore(opener) {
        if (!this.moreSheet) {
            const current = this.current;
            const tile = (page, label, iconName, extra = "") => `<a class="action-tile" href="./${page}.html"${page === current ? ' aria-current="page"' : ""}>${icon(iconName)}<span>${label}</span>${extra}</a>`;
            this.moreSheet = new Sheet({
                name: "more",
                title: "更多",
                onOpen: () => opener?.setAttribute("aria-expanded", "true"),
                onClose: () => this.tabBar?.querySelector("[data-open-more]")?.setAttribute("aria-expanded", "false"),
            });
            this.moreSheet.body.innerHTML = `
                <div class="sheet-section" data-navigation-scope="same-tab">
                    <div class="action-grid">
                        ${tile("latest", "最新更新", "latest")}
                        ${tile("library", "书架", "library")}
                        ${tile("setting", "设置", "settings")}
                        ${tile("categories", "分类浏览", "categories")}
                    </div>
                </div>
                <div class="sheet-section">
                    <h3 class="sheet-section-title">阅读线路</h3>
                    <div class="reading-controls" id="more-reading"></div>
                </div>`;
            mountReadingControls(this.moreSheet.body.querySelector(".reading-controls"), { compact: true });
        }
        this.moreSheet.open({ opener, focus: false });
    }

    openReading(opener) {
        if (!this.readingSheet) {
            this.readingSheet = new Sheet({ name: "reading", title: "图片线路与加载" });
            this.readingSheet.body.innerHTML = '<div class="reading-controls" id="sheet-reading"></div>';
            mountReadingControls(this.readingSheet.body.firstElementChild);
        }
        this.readingSheet.open({ opener });
    }
}

export const appShell = new AppShell();
export const mountShell = (options) => appShell.mount(options);
