import { communityApi } from "../community/CommunityApi.js";
import { confirmAction } from "./confirm.js";
import { escapeHtml } from "./dom.js";
import { icon } from "./icons.js";
import { showToast } from "./toast.js";

const HEARTBEAT_MS = 60 * 1000;

/**
 * Online presence: one short heartbeat a minute while the page is visible. A hidden page
 * simply stops (the server forgets it after 150 s); closing the page says goodbye at once.
 * Elements marked `data-community-online` show the count and stay hidden while it is unknown.
 */
class Presence {
    started = false;
    online = null;

    start() {
        if (this.started || typeof document === "undefined") return;
        this.started = true;
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) clearTimeout(this.timer);
            else this.beat();
        });
        window.addEventListener("pagehide", () => { clearTimeout(this.timer); communityApi.leave(); });
        // Pages restored from the back/forward cache never reload, so they rejoin here.
        window.addEventListener("pageshow", (event) => { if (event.persisted) this.beat(); });
        window.addEventListener("jm-community-change", (event) => {
            if (event.detail?.enabled) this.beat();
            else { clearTimeout(this.timer); this.publish(null); }
        });
        this.beat();
    }

    beat() {
        clearTimeout(this.timer);
        if (document.hidden) return;
        communityApi.heartbeat()
            .then(({ online }) => { this.publish(online); this.schedule(); })
            .catch((error) => { this.publish(null); if (!error?.disabled) this.schedule(); });
    }

    schedule() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.beat(), HEARTBEAT_MS);
    }

    publish(count) {
        this.online = Number.isFinite(count) ? count : null;
        renderOnline();
        window.dispatchEvent(new CustomEvent("jm-community-online", { detail: { online: this.online } }));
    }
}

export const presence = new Presence();

/** Refresh every online counter on the page (call after adding new ones). */
export function renderOnline(root = document) {
    root.querySelectorAll("[data-community-online]").forEach((node) => {
        node.hidden = presence.online == null;
        const count = node.querySelector("[data-online-count]");
        if (count) count.textContent = String(presence.online ?? "");
    });
}

export const onlineHtml = (className = "") => `<span class="community-online ${className}" data-community-online hidden title="当前在线人数（匿名统计）"><i aria-hidden="true"></i><b data-online-count></b><span class="community-online-label">人在线</span></span>`;

/**
 * The detail page's "推荐" button. It is always shown; its state loads quietly in the
 * background, and only a click reports a switched-off or unreachable service.
 */
export class RecommendButton {
    constructor(container, albumId) {
        this.albumId = String(albumId);
        this.item = null;
        this.button = document.createElement("button");
        this.button.type = "button";
        this.button.className = "btn btn-outline community-recommend";
        this.button.setAttribute("aria-pressed", "false");
        this.button.innerHTML = `${icon("flame")}<span>推荐</span>`;
        container.append(this.button);
        this.button.addEventListener("click", () => this.click());
        window.addEventListener("jm-community-change", () => this.load());
    }

    async load() {
        try {
            this.render(await communityApi.comic(this.albumId));
            return true;
        } catch (error) {
            this.lastError = error;
            return false;
        }
    }

    render(item) {
        this.item = item;
        const mine = Boolean(item?.mine?.recommended);
        const count = Number(item?.recommenders) || 0;
        this.button.setAttribute("aria-pressed", String(mine));
        this.button.querySelector("span").textContent = mine ? `已推荐 · ${count}` : count ? `推荐 · ${count}` : "推荐";
        this.button.title = mine ? `你已推荐，共 ${count} 人推荐` : count ? `已有 ${count} 人推荐` : "推荐到社区推荐页";
    }

    async click() {
        if (this.busy) return;
        this.busy = true;
        this.button.classList.add("is-busy");
        try {
            // The background load may have failed or still be running: ask once more now.
            if (!this.item && !(await this.load())) {
                showToast(this.lastError?.disabled ? "社区功能已关闭，可在设置中开启" : this.lastError?.message || "暂时无法连接服务器，请稍后再试", "warning");
                return;
            }
            if (this.item.mine?.recommended) {
                showToast("已经推荐过了，推荐不能撤销");
                return;
            }
            this.button.classList.remove("is-busy");
            const ok = await confirmAction({
                title: "推荐这本到社区？",
                message: "推荐完全匿名，会出现在“社区推荐”页供大家投票。提交后不能撤销。",
                label: "推荐",
                tone: "primary",
            });
            if (!ok) return;
            this.button.classList.add("is-busy");
            this.render(await communityApi.recommend(this.albumId));
            showToast("已推荐到社区", "success");
        } catch (error) {
            showToast(error?.disabled ? "社区功能已关闭，可在设置中开启" : `推荐失败：${error.message}`, "warning");
        } finally {
            this.busy = false;
            this.button.classList.remove("is-busy");
        }
    }
}

/** Votes under a recommended comic: 好看 / 不好看 are one choice, 欢乐 is a separate tick. */
export const voteBarHtml = (item) => {
    const mine = item.mine || {};
    const button = (attr, value, active, glyph, label, count) => `<button class="vote-btn" type="button" ${attr}="${value}" aria-pressed="${active}" aria-label="${label}，${count} 票" title="${label}">${icon(glyph)}<span>${label}</span><b class="num">${count}</b></button>`;
    return `<div class="vote-bar" data-vote-bar="${escapeHtml(item.id)}">
        <span class="vote-count" title="推荐人数">${icon("flame")}<b class="num">${Number(item.recommenders) || 0}</b> 人推荐</span>
        ${button("data-vote", "good", mine.vote === "good", "thumbUp", "好看", item.good)}
        ${button("data-vote", "bad", mine.vote === "bad", "thumbDown", "不好看", item.bad)}
        ${button("data-vote", "fun", Boolean(mine.fun), "smile", "欢乐", item.fun)}
    </div>`;
};

/** The vote the bar's button asks for, given the current item. */
export const nextVote = (item, clicked) => {
    const mine = item.mine || {};
    if (clicked === "fun") return { vote: mine.vote ?? null, fun: !mine.fun };
    return { vote: mine.vote === clicked ? null : clicked, fun: Boolean(mine.fun) };
};
