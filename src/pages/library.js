import { mountShell } from "../ui/shell.js";
import { comicCardHtml } from "../ui/comic-card.js";
import { hydrateCovers } from "../ui/covers.js";
import { hydrateRichCards } from "../ui/rich-cards.js";
import { stateHtml } from "../ui/states.js";
import { confirmAction } from "../ui/confirm.js";
import { showToast } from "../ui/toast.js";
import { libraryStore } from "../data/LibraryStore.js";
import { renderPageError } from "../ui/states.js";
import { checkTrackingUpdates, hasUpdate, trackedByUpdate, updatedLabel } from "../ui/tracking.js";

const VIEWS = {
    favorites: { name: "收藏", clear: "收藏" },
    history: { name: "最近阅读", clear: "阅读历史" },
    tracking: { name: "追踪连载", clear: "追踪连载" },
    later: { name: "稍后再看", clear: "稍后再看" },
    random: { name: "随机历史", clear: "随机历史" },
};

class LibraryPage {
    view = "history";
    checkingTracking = false;

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
        this.checkButton = document.querySelector(".check-updates");
        this.checkButton.addEventListener("click", () => this.checkTracking({ force: true }));
        document.querySelector(".clear-history").addEventListener("click", async (event) => {
            const button = event.currentTarget;
            const name = VIEWS[this.view].clear;
            if (!await confirmAction({ title: `清空${name}？`, message: "只清空当前浏览器中的对应列表，无法撤销。", label: "确认清空" })) return;
            button.disabled = true;
            try {
                if (this.view === "random") await libraryStore.clearRandomHistory();
                else if (this.view === "later") await libraryStore.clearWatchLater();
                else if (this.view === "favorites") await libraryStore.clearFavorites();
                else if (this.view === "tracking") await libraryStore.clearTracking();
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
        this.checkButton.hidden = view !== "tracking";
        this.notice.className = "library-notice";
        this.notice.textContent = this.checkingTracking && view === "tracking" ? this.notice.textContent : "";
        if (updateUrl) {
            const url = new URL(window.location.href);
            url.searchParams.set("view", view);
            url.hash = "";
            window.history.replaceState({}, "", url);
        }
        this.render();
        if (view === "tracking") this.checkTracking();
    }

    /** Check tracked series for new chapters; stale ones only, unless `force`. */
    async checkTracking({ force = false } = {}) {
        if (this.checkingTracking) return;
        this.checkingTracking = true;
        this.checkButton.disabled = true;
        try {
            const { checked, failed, total } = await checkTrackingUpdates({
                force,
                onProgress: (done, count) => {
                    if (this.view === "tracking") this.notice.textContent = `正在检查更新 ${done} / ${count}…`;
                },
            });
            if (total && this.view === "tracking") {
                const updates = libraryStore.getTracking().filter(hasUpdate).length;
                this.notice.textContent = `已检查 ${checked} 部${updates ? `，${updates} 部有更新` : ""}${failed ? `，${failed} 部检查失败` : ""}。`;
                this.notice.classList.toggle("warning", failed > 0);
            }
        } catch (error) {
            if (this.view === "tracking") {
                this.notice.textContent = error.message || "检查更新失败，请稍后重试";
                this.notice.classList.add("warning");
            }
        } finally {
            this.checkingTracking = false;
            this.checkButton.disabled = false;
        }
    }

    items() {
        if (this.view === "tracking") return trackedByUpdate();
        return this.view === "random" ? libraryStore.getRandomHistory()
            : this.view === "later" ? libraryStore.getWatchLater()
                : this.view === "favorites" ? libraryStore.getFavorites() : libraryStore.getHistory();
    }

    meta(item) {
        if (this.view === "tracking") {
            return { meta: `${hasUpdate(item) ? "有更新 · " : ""}最后更新 ${updatedLabel(item.updatedAt)} · 共 ${Number(item.chapters) || 1} 章`, highlight: hasUpdate(item) };
        }
        return { meta: item.savedAt ? new Date(item.savedAt).toLocaleDateString("zh-CN") : "" };
    }

    render() {
        const items = this.items();
        document.querySelector(".sync-state").textContent = `${VIEWS[this.view].name} · ${items.length}`;
        if (!items.length) {
            this.grid.innerHTML = stateHtml({ title: "这里暂时没有作品", action: { label: "去发现", href: "./" } });
            return;
        }
        this.grid.innerHTML = items.map((item) => comicCardHtml(item, this.meta(item))).join("");
        hydrateCovers(this.grid);
        hydrateRichCards(this.grid);
    }
}
new LibraryPage().init().catch((error) => renderPageError(".library-grid", error, { title: "书架加载失败" }));
