import { libraryStore } from "../data/LibraryStore.js";
import { authorsOf, asText, escapeHtml } from "./dom.js";
import { icon } from "./icons.js";
import { showToast } from "./toast.js";

/**
 * "稍后再看" toggles. Buttons carry the fields the list stores, so a card can add a
 * comic without another album request; one delegated listener serves every page.
 */
const payload = (comic) => JSON.stringify({
    id: String(comic?.id ?? ""),
    name: asText(comic?.name ?? comic?.title, "未命名作品"),
    author: authorsOf(comic),
    cover_url: asText(comic?.cover_url || comic?.coverUrl),
});

const label = (active) => (active ? "已在稍后再看" : "稍后再看");

/** `compact` renders the icon-only button used on comic cards. */
export const watchLaterButtonHtml = (comic, { compact = false } = {}) => {
    const active = libraryStore.isWatchLater(comic?.id);
    return compact
        ? `<button class="later-toggle" type="button" data-watch-later="${escapeHtml(payload(comic))}" aria-pressed="${active}" aria-label="${label(active)}" title="${label(active)}">${icon("later")}</button>`
        : `<button class="btn btn-outline" type="button" data-watch-later="${escapeHtml(payload(comic))}" aria-pressed="${active}">${icon("later")}<span>${label(active)}</span></button>`;
};

export function syncWatchLaterButtons(root = document) {
    root.querySelectorAll("[data-watch-later]").forEach((button) => {
        let id = "";
        try { id = JSON.parse(button.dataset.watchLater).id; } catch { /* Malformed buttons stay as they are. */ }
        const active = libraryStore.isWatchLater(id);
        button.setAttribute("aria-pressed", String(active));
        if (button.classList.contains("later-toggle")) {
            button.setAttribute("aria-label", label(active));
            button.title = label(active);
        } else {
            const text = button.querySelector("span");
            if (text) text.textContent = label(active);
        }
    });
}

async function toggle(button) {
    if (button.disabled) return;
    let comic;
    try { comic = JSON.parse(button.dataset.watchLater); } catch { return; }
    button.disabled = true;
    try {
        await libraryStore.init();
        if (libraryStore.isWatchLater(comic.id)) {
            await libraryStore.removeWatchLater(comic.id);
            showToast("已移出稍后再看");
        } else {
            await libraryStore.addWatchLater(comic);
            showToast("已加入稍后再看");
        }
    } catch (error) {
        showToast(error?.message || "稍后再看保存失败，请重试", "warning");
    } finally {
        button.disabled = false;
        syncWatchLaterButtons();
    }
}

if (typeof document !== "undefined" && !window.__watchLaterBound) {
    window.__watchLaterBound = true;
    document.addEventListener("click", (event) => {
        const button = event.target.closest?.("[data-watch-later]");
        if (!button) return;
        event.preventDefault();
        toggle(button);
    });
    window.addEventListener("jm-library-change", () => syncWatchLaterButtons());
    // Cards render before the list loads; refresh their state once it arrives.
    libraryStore.init().catch(() => {});
}
