import { communityApi } from "../community/CommunityApi.js";
import { confirmAction } from "./confirm.js";
import { escapeHtml } from "./dom.js";
import { icon } from "./icons.js";
import { Sheet } from "./overlay.js";
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

/*
 * Emoji reactions. The server stores the key; two rows of seven: faces from warm to cross,
 * then symbols and things. Order here is also the picker's order and the tie-break order.
 */
export const REACTIONS = [
    ["love", "😍", "喜欢"], ["hot", "🥵", "好涩"], ["lol", "🤣", "笑死"], ["mindblown", "🤯", "震撼"],
    ["think", "🤔", "疑惑"], ["cry", "😭", "哭了"], ["angry", "😡", "生气"],
    ["fire", "🔥", "火"], ["zap", "⚡️", "带电"], ["cow", "🐮", "牛"], ["chicken", "🐔", "鸡"],
    ["milk", "🍼", "奶"], ["nails", "💅", "优雅"], ["zero", "0️⃣", "零"],
].map(([key, emoji, label]) => ({ key, emoji, label }));
const REACTION_BY_KEY = new Map(REACTIONS.map((reaction) => [reaction.key, reaction]));

/** Votes and reactions under a recommended comic; re-render the whole block after a change. */
export const communityBarHtml = (item) => {
    const mine = item.mine || {};
    const voteButton = (value, glyph, label, count) => `<button class="vote-btn" type="button" data-vote="${value}" aria-pressed="${mine.vote === value}" aria-label="${label}，${count} 票" title="${label}">${icon(glyph)}<span>${label}</span><b class="num">${count}</b></button>`;
    const counts = item.reactions || {};
    const mineReactions = new Set(mine.reactions || []);
    const shown = REACTIONS.filter(({ key }) => counts[key] > 0).sort((a, b) => counts[b.key] - counts[a.key]);
    const chips = shown.map(({ key, emoji, label }) => `<button class="reaction-chip" type="button" data-react="${key}" aria-pressed="${mineReactions.has(key)}" aria-label="${label}，${counts[key]} 人" title="${label}"><span class="reaction-emoji">${emoji}</span><b class="num">${counts[key]}</b></button>`).join("");
    return `<div class="community-bar" data-community-bar="${escapeHtml(item.id)}">
        <div class="vote-bar">
            <span class="vote-count" title="推荐人数">${icon("flame")}<b class="num">${Number(item.recommenders) || 0}</b> 人推荐</span>
            ${voteButton("good", "thumbUp", "好看", item.good)}
            ${voteButton("bad", "thumbDown", "不好看", item.bad)}
        </div>
        <div class="reaction-bar">${chips}<button class="reaction-add" type="button" data-react-add aria-label="添加表情回应" title="添加表情回应">${icon("smile")}<span aria-hidden="true">+</span></button></div>
    </div>`;
};

/** 好看 / 不好看 are one choice: clicking the current one clears it. */
export const nextVote = (item, clicked) => (item.mine?.vote === clicked ? null : clicked);

const pickerGridHtml = (mine) => `<div class="reaction-grid" role="group" aria-label="表情回应">${REACTIONS.map(({ key, emoji, label }) => `<button type="button" data-pick="${key}" aria-pressed="${mine.has(key)}" aria-label="${label}" title="${label}">${emoji}</button>`).join("")}</div>`;

let pickerSheet = null;
let popover = null;

/**
 * Let the user pick one reaction; resolves to its key, or null when dismissed.
 * Phones get the usual bottom sheet; wider screens a small popover next to the button.
 */
export function pickReaction(opener, mineKeys = []) {
    const mine = new Set(mineKeys);
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
        if (window.matchMedia("(max-width: 699px)").matches) {
            pickerSheet ||= new Sheet({ name: "reactions", title: "表情回应", onClose: () => pickerSheet.onPick?.(null) });
            pickerSheet.onPick = finish;
            pickerSheet.body.innerHTML = `<p class="sheet-note">点一下添加，再点一次取消</p>${pickerGridHtml(mine)}`;
            pickerSheet.body.onclick = (event) => {
                const button = event.target.closest("[data-pick]");
                if (!button) return;
                const pick = pickerSheet.onPick;
                pickerSheet.onPick = null;
                pick?.(button.dataset.pick);
                pickerSheet.close();
            };
            pickerSheet.open({ opener });
            return;
        }
        popover?.close();
        const root = document.createElement("div");
        root.className = "reaction-popover";
        root.innerHTML = pickerGridHtml(mine);
        document.body.append(root);
        const rect = opener.getBoundingClientRect();
        const width = root.offsetWidth;
        const height = root.offsetHeight;
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
        const below = rect.bottom + 6 + height <= window.innerHeight - 8;
        root.style.left = `${left}px`;
        root.style.top = `${below ? rect.bottom + 6 : rect.top - 6 - height}px`;
        const close = (value = null) => {
            document.removeEventListener("pointerdown", outside, true);
            document.removeEventListener("keydown", escape, true);
            window.removeEventListener("scroll", dismiss, true);
            window.removeEventListener("resize", dismiss);
            root.remove();
            if (popover?.root === root) popover = null;
            finish(value);
        };
        const outside = (event) => { if (!root.contains(event.target) && !opener.contains(event.target)) close(); };
        const escape = (event) => { if (event.key === "Escape") { event.stopPropagation(); close(); opener.focus({ preventScroll: true }); } };
        const dismiss = () => close();
        root.addEventListener("click", (event) => {
            const button = event.target.closest("[data-pick]");
            if (button) close(button.dataset.pick);
        });
        document.addEventListener("pointerdown", outside, true);
        document.addEventListener("keydown", escape, true);
        window.addEventListener("scroll", dismiss, true);
        window.addEventListener("resize", dismiss);
        popover = { root, close };
        root.querySelector("[data-pick]")?.focus({ preventScroll: true });
    });
}
