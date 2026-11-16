import { authorSubscriptions } from "../data/AuthorSubscriptions.js";
import { libraryStore } from "../data/LibraryStore.js";
import { mountShell } from "../ui/shell.js";
import { comicCardHtml } from "../ui/comic-card.js";
import { hydrateCovers } from "../ui/covers.js";
import { hydrateRichCards } from "../ui/rich-cards.js";
import { stateHtml, renderPageError } from "../ui/states.js";
import { confirmAction } from "../ui/confirm.js";
import { showToast } from "../ui/toast.js";
import { escapeHtml, formatDateTime } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { checkResultMessage } from "../ui/subscriptions.js";
import { ActionMenu } from "../ui/action-menu.js";
import { checkTrackingUpdates, hasUpdate, trackedByUpdate, updatedLabel } from "../ui/tracking.js";

const VIEWS = ["authors", "tracking"];
const SETTINGS_URL = "./setting#settings-subscriptions";

/** 今天的时间只显示时分，手机工具栏放得下。 */
const shortTime = (time) => {
    const date = new Date(time);
    return date.toDateString() === new Date().toDateString()
        ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
        : formatDateTime(time);
};

/**
 * 订阅与追更：两个视图共用一行工具栏。
 * - 作者新作：订阅作者的新作品（AuthorSubscriptions）。
 * - 追踪连载：在详情页点了“追踪连载”的系列（原书架里的同名视图）。
 */
class SubscriptionsPage {
    view = "authors";
    rendered = "";
    author = "";
    checkingTracking = false;
    trackingNotice = "";
    trackingWarning = false;

    async init() {
        mountShell();
        this.status = document.querySelector(".subscription-status");
        this.grid = document.querySelector(".subscription-grid");
        this.filter = document.querySelector(".subscription-filter");
        this.tabs = [...document.querySelectorAll(".subscription-tabs button")];
        this.checkButton = document.querySelector("[data-check-updates]");
        this.checkButton.innerHTML = icon("refresh");
        this.checkButton.addEventListener("click", () => (this.view === "tracking" ? this.checkTracking({ force: true }) : this.checkAuthors()));
        this.menu = new ActionMenu();
        document.querySelector(".toolbar-actions").append(this.menu.root);
        this.tabs.forEach((button) => button.addEventListener("click", () => this.selectView(button.dataset.view, { updateUrl: true })));
        this.filter.addEventListener("change", () => {
            this.author = this.filter.value;
            this.render();
        });
        this.grid.addEventListener("click", (event) => {
            const button = event.target.closest("[data-dismiss-update]");
            if (!button) return;
            authorSubscriptions.dismiss(button.dataset.dismissUpdate);
            showToast("已移出");
        });
        await libraryStore.init();
        window.addEventListener("jm-subscriptions-change", () => this.render());
        window.addEventListener("jm-library-change", () => this.render());
        const requested = new URLSearchParams(location.search).get("view");
        this.selectView(VIEWS.includes(requested) ? requested : "authors");
    }

    selectView(view, { updateUrl = false } = {}) {
        this.view = view;
        this.tabs.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.view === view)));
        if (!this.checkingTracking) this.trackingNotice = "";
        if (updateUrl) {
            const url = new URL(location.href);
            url.searchParams.set("view", view);
            url.hash = "";
            history.replaceState({}, "", url);
        }
        this.render();
        // 进入追踪连载时顺手检查一次（只查半小时内没查过的）。
        if (view === "tracking") this.checkTracking();
    }

    render() {
        if (this.view === "tracking") {
            this.filter.hidden = true;
            this.renderTrackingStatus();
            this.renderTracking();
        } else {
            this.renderFilters();
            this.renderAuthorStatus();
            this.renderAuthorUpdates();
        }
    }

    /* ---------- 作者新作 ---------- */

    /** 作者下拉框：全部，以及有待看新作的作者（附数量），和书架的收藏夹、评分筛选一致。 */
    renderFilters() {
        const updates = authorSubscriptions.updates;
        const counts = new Map();
        for (const item of updates) for (const name of item.sources) counts.set(name, (counts.get(name) || 0) + 1);
        if (this.author && !counts.has(this.author)) this.author = "";
        this.filter.hidden = counts.size < 2;
        const option = (value, label, count) => `<option value="${escapeHtml(value)}">${escapeHtml(label)} · ${count}</option>`;
        this.filter.innerHTML = option("", "全部作者", updates.length) + [...counts].map(([name, count]) => option(name, name, count)).join("");
        this.filter.value = this.author;
    }

    renderAuthorStatus() {
        const { authors, updates, lastRunAt } = authorSubscriptions.state;
        const progress = authorSubscriptions.progress;
        const running = authorSubscriptions.isRunning;
        this.checkButton.disabled = running || !authors.length;
        this.checkButton.classList.toggle("is-spinning", running);
        this.checkButton.setAttribute("aria-label", "检查作者新作");
        this.checkButton.title = "检查作者新作";
        this.menu.setItems([
            { label: "管理订阅", icon: "sliders", onSelect: () => { location.href = SETTINGS_URL; } },
            updates.length ? { label: "清空新作列表", icon: "trash", danger: true, onSelect: () => this.clearAuthorUpdates() } : null,
        ]);
        this.status.classList.remove("warning");
        if (progress) this.status.textContent = `检查中 ${progress.index}/${progress.total} · ${progress.name}`;
        else if (!authors.length) this.status.textContent = "未订阅作者";
        else {
            // 下拉框选项里已有新作数量，这时只显示检查时间。
            const checked = lastRunAt ? `${shortTime(lastRunAt)} 检查` : "尚未检查";
            this.status.textContent = this.filter.hidden ? `${updates.length} 部新作 · ${checked}` : checked;
        }
    }

    renderAuthorUpdates() {
        const author = this.author;
        const updates = authorSubscriptions.updates.filter((item) => !author || item.sources.includes(author));
        // 只在列表真正变化时重绘，检查进度刷新时卡片不闪。
        const signature = "authors#" + updates.map((item) => `${item.id}:${item.sources.join(",")}:${item.via || ""}`).join("|") + `#${author}#${authorSubscriptions.authors.length ? 1 : 0}`;
        if (signature === this.rendered && this.grid.childElementCount) return;
        this.rendered = signature;
        if (!updates.length) {
            const hasAuthors = authorSubscriptions.authors.length;
            this.grid.innerHTML = stateHtml(hasAuthors
                ? { title: "暂无新作", message: "看过的作品会自动移出" }
                : { title: "还没有订阅作者", message: "在作品详情或搜索结果里订阅", action: { label: "管理订阅", href: SETTINGS_URL } });
            return;
        }
        this.grid.innerHTML = updates.map((item) => comicCardHtml(item, {
            // 作者行已显示作者；只有标题匹配（作者字段对不上）时才注明来自哪位订阅作者。
            meta: `${formatDateTime(item.foundAt)} 发现${item.via === "title" ? ` · 标题匹配 ${item.sources.join("、")}` : ""}`,
            footer: `<button class="card-folder-move" type="button" data-dismiss-update="${escapeHtml(item.id)}">${icon("check")}<span>移出</span></button>`,
        })).join("");
        this.hydrate();
    }

    async checkAuthors() {
        try {
            const result = await authorSubscriptions.checkAll();
            showToast(checkResultMessage(result), result.failed.length ? "warning" : result.added ? "success" : "default");
        } catch (error) {
            showToast(error.message || "检查失败", "warning");
        }
    }

    async clearAuthorUpdates() {
        const count = authorSubscriptions.updates.length;
        if (!await confirmAction({ title: "清空新作列表？", message: `移出 ${count} 部作品，订阅不受影响。`, label: "清空" })) return;
        authorSubscriptions.clearUpdates();
        showToast("已清空");
    }

    /* ---------- 追踪连载 ---------- */

    renderTrackingStatus() {
        const items = libraryStore.getTracking();
        const updates = items.filter(hasUpdate).length;
        this.checkButton.disabled = this.checkingTracking || !items.length;
        this.checkButton.classList.toggle("is-spinning", this.checkingTracking);
        this.checkButton.setAttribute("aria-label", "检查连载更新");
        this.checkButton.title = "检查连载更新";
        this.menu.setItems([
            items.length ? { label: "清空追踪连载", icon: "trash", danger: true, onSelect: () => this.clearTracking() } : null,
        ]);
        this.status.textContent = this.trackingNotice || (items.length ? `${items.length} 部${updates ? ` · ${updates} 部有更新` : ""}` : "");
        this.status.classList.toggle("warning", Boolean(this.trackingNotice && this.trackingWarning));
    }

    renderTracking() {
        const items = trackedByUpdate();
        const signature = "tracking#" + items.map((item) => `${item.id}:${item.updatedAt}:${item.chapters}:${hasUpdate(item)}`).join("|");
        if (signature === this.rendered && this.grid.childElementCount) return;
        this.rendered = signature;
        if (!items.length) {
            this.grid.innerHTML = stateHtml({ title: "还没有追踪的连载", message: "在多章节作品的详情页点“追踪连载”" });
            return;
        }
        this.grid.innerHTML = items.map((item) => comicCardHtml(item, {
            meta: `${hasUpdate(item) ? "有更新 · " : ""}${updatedLabel(item.updatedAt)} 更新 · ${Number(item.chapters) || 1} 章`,
            highlight: hasUpdate(item),
        })).join("");
        this.hydrate();
    }

    setTrackingNotice(text, warning = false) {
        this.trackingNotice = text;
        this.trackingWarning = warning;
        if (this.view === "tracking") this.renderTrackingStatus();
    }

    /** 检查追踪的连载有没有新章节；默认只查半小时内没查过的，点 ↻ 时全部重查。 */
    async checkTracking({ force = false } = {}) {
        if (this.checkingTracking) return;
        this.checkingTracking = true;
        this.render();
        try {
            const { checked, failed, total } = await checkTrackingUpdates({
                force,
                onProgress: (done, count) => this.setTrackingNotice(`检查中 ${done}/${count}`),
            });
            if (total) {
                const updates = libraryStore.getTracking().filter(hasUpdate).length;
                this.setTrackingNotice(`已检查 ${checked} 部${updates ? ` · ${updates} 部有更新` : ""}${failed ? ` · ${failed} 部失败` : ""}`, failed > 0);
            }
        } catch (error) {
            this.setTrackingNotice(error.message || "检查失败", true);
        } finally {
            this.checkingTracking = false;
            this.render();
        }
    }

    async clearTracking() {
        if (!await confirmAction({ title: "清空追踪连载？", message: "只清空当前浏览器的记录，无法撤销。", label: "清空" })) return;
        try {
            await libraryStore.clearTracking();
            this.trackingNotice = "";
            showToast("已清空");
        } catch (error) {
            showToast(error.message || "清空失败", "warning");
        }
    }

    hydrate() {
        hydrateCovers(this.grid);
        hydrateRichCards(this.grid);
    }
}

new SubscriptionsPage().init().catch((error) => renderPageError(".subscription-grid", error, { title: "订阅与追更加载失败" }));
