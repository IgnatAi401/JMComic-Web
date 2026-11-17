import { jmApi } from "../api/JmcomicApi.js";
import { communityApi } from "../community/CommunityApi.js";
import { communityIdentity } from "../community/identity.js";
import { mountShell } from "../ui/shell.js";
import { Feed } from "../ui/feed.js";
import { comicCardHtml } from "../ui/comic-card.js";
import { hydrateCovers } from "../ui/covers.js";
import { hydrateRichCards } from "../ui/rich-cards.js";
import { communityBarHtml, nextVote, onlineHtml, pickReaction, renderOnline } from "../ui/community.js";
import { renderPageError, stateHtml } from "../ui/states.js";
import { showToast } from "../ui/toast.js";
import { readLocalStorage, writeLocalStorage } from "../utils/BrowserStorage.js";

mountShell();
const SORTS = ["hot", "new", "top"];
const grid = document.querySelector("[data-results]");
const state = document.querySelector("[data-result-state]");
const tabs = [...document.querySelectorAll("[data-sort]")];
const items = new Map();
let sort = SORTS.includes(readLocalStorage("jm_recommend_sort")) ? readLocalStorage("jm_recommend_sort") : "hot";
let total = 0;

document.querySelector(".page-title").insertAdjacentHTML("afterend", onlineHtml("page-online"));
renderOnline();

// Only the ID is shared; the card fills title, cover and stats from JM like any other list.
const cardHtml = (item) => comicCardHtml({ id: item.id, name: "读取中…" }, {
    after: communityBarHtml(item), fillTitle: true,
});

function renderTabs() {
    tabs.forEach((tab) => tab.setAttribute("aria-pressed", String(tab.dataset.sort === sort)));
}

function renderStatus() {
    state.textContent = total ? `共 ${total} 部 · 已加载 ${items.size} 部` : "";
}

async function init() {
    renderTabs();
    const identity = await communityIdentity.get().catch(() => null);
    if (identity && !identity.enabled) {
        state.textContent = "";
        grid.innerHTML = stateHtml({ title: "社区功能已关闭", message: "在设置里打开“参与社区功能”后即可查看和投票。", action: { href: "./setting", label: "前往设置" } });
        return;
    }
    await jmApi.init();
    const feed = new Feed({ footer: document.querySelector("[data-feed]"), loadPage: async (page, current) => {
        let result;
        try {
            result = await communityApi.list(sort, page);
        } catch (error) {
            if (current() && !items.size) state.textContent = "";
            throw error;
        }
        if (!current()) return {};
        total = Number(result.total) || 0;
        const fresh = (result.items || []).filter((item) => !items.has(item.id));
        fresh.forEach((item) => items.set(item.id, item));
        grid.querySelector(".state")?.remove();
        grid.insertAdjacentHTML("beforeend", fresh.map(cardHtml).join(""));
        if (!items.size) grid.innerHTML = stateHtml({ title: "还没有人推荐", message: "打开任意作品详情页，点“推荐”成为第一个推荐的人。" });
        hydrateCovers(grid);
        hydrateRichCards(grid);
        renderStatus();
        return { done: items.size >= total || !fresh.length, count: fresh.length };
    } });
    const restart = () => { grid.replaceChildren(); items.clear(); state.textContent = "读取中…"; return feed.restart(); };
    document.querySelector("[data-refresh]").addEventListener("click", restart);
    tabs.forEach((tab) => tab.addEventListener("click", () => {
        if (tab.dataset.sort === sort) return;
        sort = tab.dataset.sort;
        writeLocalStorage("jm_recommend_sort", sort);
        renderTabs();
        restart();
    }));
    grid.addEventListener("click", (event) => {
        const button = event.target.closest("[data-vote], [data-react], [data-react-add]");
        if (button) act(button);
    });
    await feed.restart();
}

/** One vote or reaction change; the bar is redrawn from the server's answer. */
async function act(button) {
    const bar = button.closest("[data-community-bar]");
    const item = items.get(bar?.dataset.communityBar);
    if (!item || bar.dataset.busy) return;
    let request;
    if (button.dataset.vote) {
        request = () => communityApi.vote(item.id, nextVote(item, button.dataset.vote));
    } else if (button.dataset.react) {
        const key = button.dataset.react;
        request = () => communityApi.react(item.id, key, !(item.mine?.reactions || []).includes(key));
    } else {
        const key = await pickReaction(button, item.mine?.reactions || []);
        if (!key || !bar.isConnected) return;
        request = () => communityApi.react(item.id, key, !(item.mine?.reactions || []).includes(key));
    }
    bar.dataset.busy = "true";
    bar.querySelectorAll("button").forEach((el) => { el.disabled = true; });
    try {
        const updated = await request();
        items.set(item.id, updated);
        bar.outerHTML = communityBarHtml(updated);
    } catch (error) {
        showToast(error?.disabled ? "社区功能已关闭，可在设置中开启" : `操作失败：${error.message}`, "warning");
        bar.querySelectorAll("button").forEach((el) => { el.disabled = false; });
        delete bar.dataset.busy;
    }
}

init().catch((error) => renderPageError(grid, error));
