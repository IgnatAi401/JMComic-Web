import { mountShell } from "../ui/shell.js";
import { comicCardHtml } from "../ui/comic-card.js";
import { hydrateCovers } from "../ui/covers.js";
import { hydrateRichCards } from "../ui/rich-cards.js";
import { stateHtml } from "../ui/states.js";
import { confirmAction } from "../ui/confirm.js";
import { showToast } from "../ui/toast.js";
import { libraryStore } from "../data/LibraryStore.js";
import { renderPageError } from "../ui/states.js";
import { ActionMenu } from "../ui/action-menu.js";

const VIEWS = {
    favorites: { name: "收藏", clear: "收藏", empty: "收藏夹是空的" },
    history: { name: "最近阅读", clear: "阅读历史", empty: "还没有阅读记录" },
    later: { name: "稍后再看", clear: "稍后再看", empty: "没有稍后再看的作品" },
    random: { name: "随机历史", clear: "随机历史", empty: "还没有随机记录" },
};

class LibraryPage {
    view = "history";

    async init() {
        mountShell();
        this.grid = document.querySelector(".library-grid");
        this.notice = document.querySelector(".library-notice");
        this.bindEvents();
        await libraryStore.init();
        window.addEventListener("jm-library-change", () => this.render());
        const requestedView = new URLSearchParams(window.location.search).get("view");
        // 追踪连载已移到“订阅与追更”页，旧链接直接转过去。
        if (requestedView === "tracking") { location.replace("./subscriptions?view=tracking"); return; }
        this.selectView(VIEWS[requestedView] ? requestedView : "history");
    }

    bindEvents() {
        document.querySelectorAll(".library-tabs button").forEach((button) => {
            button.addEventListener("click", () => this.selectView(button.dataset.view, { updateUrl: true }));
        });
        // 清空这类不常用、不可撤销的操作收进“⋯”菜单，避免误点。
        this.menu = new ActionMenu();
        document.querySelector(".toolbar-actions").append(this.menu.root);
    }

    async clearList() {
        const name = VIEWS[this.view].clear;
        if (!await confirmAction({ title: `清空${name}？`, message: "只清空当前浏览器的记录，无法撤销。", label: "清空" })) return;
        try {
            if (this.view === "random") await libraryStore.clearRandomHistory();
            else if (this.view === "later") await libraryStore.clearWatchLater();
            else if (this.view === "favorites") await libraryStore.clearFavorites();
            else await libraryStore.clearHistory();
            showToast("已清空");
        } catch (error) {
            showToast(error.message || "清空失败", "warning");
        }
    }

    selectView(view, { updateUrl = false } = {}) {
        this.view = view;
        document.querySelectorAll(".library-tabs button").forEach((button) => {
            const active = button.dataset.view === view;
            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
        });
        this.noticeText = "";
        if (updateUrl) {
            const url = new URL(window.location.href);
            url.searchParams.set("view", view);
            url.hash = "";
            window.history.replaceState({}, "", url);
        }
        this.render();
    }

    items() {
        return this.view === "random" ? libraryStore.getRandomHistory()
            : this.view === "later" ? libraryStore.getWatchLater()
                : this.view === "favorites" ? libraryStore.getFavorites() : libraryStore.getHistory();
    }

    meta(item) {
        return { meta: item.savedAt ? new Date(item.savedAt).toLocaleDateString("zh-CN") : "" };
    }

    /** 工具栏状态：有提示时显示提示，否则显示数量。 */
    setNotice(text, warning = false) {
        this.noticeText = text;
        this.noticeWarning = warning;
        this.#paintNotice();
    }

    #paintNotice() {
        this.notice.textContent = this.noticeText || this.summary || "";
        this.notice.classList.toggle("warning", Boolean(this.noticeText && this.noticeWarning));
    }

    render() {
        const items = this.items();
        this.summary = `${items.length} 部`;
        this.menu.setItems([
            items.length ? { label: `清空${VIEWS[this.view].clear}`, icon: "trash", danger: true, onSelect: () => this.clearList() } : null,
        ]);
        this.#paintNotice();
        if (!items.length) {
            this.grid.innerHTML = stateHtml({ title: VIEWS[this.view].empty, action: { label: "去发现", href: "./" } });
            return;
        }
        this.grid.innerHTML = items.map((item) => comicCardHtml(item, this.meta(item))).join("");
        hydrateCovers(this.grid);
        hydrateRichCards(this.grid);
    }
}
new LibraryPage().init().catch((error) => renderPageError(".library-grid", error, { title: "书架加载失败" }));
