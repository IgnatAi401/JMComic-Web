import { mountShell } from "../ui/shell.js";
import { comicCardHtml } from "../ui/comic-card.js";
import { hydrateCovers } from "../ui/covers.js";
import { hydrateRichCards } from "../ui/rich-cards.js";
import { stateHtml } from "../ui/states.js";
import { confirmAction } from "../ui/confirm.js";
import { showToast } from "../ui/toast.js";
import { libraryStore } from "../data/LibraryStore.js";
import { renderPageError } from "../ui/states.js";

const VIEWS = {
    history: { name: "最近阅读", clear: "阅读历史", note: "" },
    later: { name: "稍后再看", clear: "稍后再看", note: "点卡片右上角的时钟按钮即可加入或移出稍后再看。" },
    random: { name: "随机历史", clear: "随机历史", note: "这里保留在发现页验证通过的随机作品。" },
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
        this.selectView(VIEWS[requestedView] ? requestedView : "history");
    }

    bindEvents() {
        document.querySelectorAll(".library-tabs button").forEach((button) => {
            button.addEventListener("click", () => this.selectView(button.dataset.view, { updateUrl: true }));
        });
        document.querySelector(".clear-history").addEventListener("click", async (event) => {
            const button = event.currentTarget;
            const name = VIEWS[this.view].clear;
            if (!await confirmAction({ title: `清空${name}？`, message: "只清空当前浏览器中的对应列表，无法撤销。", label: "确认清空" })) return;
            button.disabled = true;
            try {
                if (this.view === "random") await libraryStore.clearRandomHistory();
                else if (this.view === "later") await libraryStore.clearWatchLater();
                else await libraryStore.clearHistory();
                showToast(`${name}已清空`);
            } catch (error) {
                showToast(error.message || "清空失败，请重试");
            } finally {
                button.disabled = false;
            }
        });
    }

    selectView(view, { updateUrl = false } = {}) {
        this.view = view;
        document.querySelectorAll(".library-tabs button").forEach((button) => {
            const active = button.dataset.view === view;
            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
        });
        const clearButton = document.querySelector(".clear-history");
        clearButton.hidden = false;
        clearButton.textContent = `清空${VIEWS[view].clear}`;
        this.notice.className = "library-notice";
        this.notice.textContent = VIEWS[view].note;
        if (updateUrl) {
            const url = new URL(window.location.href);
            url.searchParams.set("view", view);
            url.hash = "";
            window.history.replaceState({}, "", url);
        }
        this.render();
    }

    render() {
        const items = this.view === "random" ? libraryStore.getRandomHistory()
            : this.view === "later" ? libraryStore.getWatchLater() : libraryStore.getHistory();
        document.querySelector(".sync-state").textContent = `${VIEWS[this.view].name} · ${items.length}`;
        if (!items.length) {
            this.grid.innerHTML = stateHtml({ title: "这里暂时没有作品", message: "开始阅读或把作品加入稍后再看。", action: { label: "去发现", href: "./index.html" } });
            return;
        }
        this.grid.innerHTML = items.map((item) => comicCardHtml(item, {
            meta: item.savedAt ? new Date(item.savedAt).toLocaleDateString("zh-CN") : "",
        })).join("");
        hydrateCovers(this.grid);
        hydrateRichCards(this.grid);
    }
}
new LibraryPage().init().catch((error) => renderPageError(".library-grid", error, { title: "书架加载失败" }));
