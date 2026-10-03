import { jmApi } from "../api/JmcomicApi.js";
import { authorsOf, formatCount, formatDate } from "./dom.js";
import { authorStance, fitTagRows, loadPreferences, preferenceAuthorsHtml, preferenceTagsHtml } from "./preferences.js";

// Each card costs one small /album request (cached for 7 days); a low ceiling
// keeps a long home page from bursting the API while the user scrolls.
const MAX_ACTIVE = 3;
const TAG_ROWS = 2;
const queue = [];
let active = 0;

const observer = typeof IntersectionObserver === "function"
    ? new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            observer.unobserve(entry.target);
            enqueue(entry.target);
        });
    }, { rootMargin: "240px 240px" })
    : null;

// Card widths follow the viewport, so the two-row cut is re-measured on resize.
const tagWidths = new WeakMap();
const tagResizer = typeof ResizeObserver === "function"
    ? new ResizeObserver((entries) => {
        entries.forEach(({ target, contentRect }) => {
            if (tagWidths.get(target) === contentRect.width) return;
            tagWidths.set(target, contentRect.width);
            fitTagRows(target, TAG_ROWS);
        });
    })
    : null;

function enqueue(card) {
    if (card.dataset.details !== "pending") return;
    card.dataset.details = "queued";
    queue.push(card);
    pump();
}

function pump() {
    while (active < MAX_ACTIVE && queue.length) {
        const card = queue.shift();
        if (!card.isConnected) continue;
        active += 1;
        load(card).finally(() => { active -= 1; pump(); });
    }
}

const field = (card, key) => card.querySelector(`[data-detail="${key}"]`);

async function load(card) {
    card.dataset.details = "loading";
    try {
        const [album, preferences] = await Promise.all([
            jmApi.getComicAlbum(card.dataset.comicId, { maxServers: 2, timeoutMs: 8000 }),
            loadPreferences(),
        ]);
        if (!album?.id) throw new Error("作品资料为空");
        fillRichCard(card, album, preferences);
    } catch {
        card.dataset.details = "error";
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "rich-retry";
        retry.textContent = "资料加载失败 · 重试";
        retry.addEventListener("click", () => {
            card.dataset.details = "pending";
            field(card, "tags").replaceChildren();
            enqueue(card);
        }, { once: true });
        field(card, "tags").replaceChildren(retry);
    }
}

export function fillRichCard(card, album, preferences) {
    const series = Array.isArray(album.series) ? album.series.length : 0;
    const values = {
        chapters: String(series || 1),
        pages: album.total_photos != null && album.total_photos !== "" ? String(album.total_photos) : "—",
        date: formatDate(album.addtime, { year: "numeric", month: "2-digit", day: "2-digit" }) || "—",
        views: formatCount(album.total_views),
        likes: formatCount(album.likes),
    };
    Object.entries(values).forEach(([key, value]) => { field(card, key).textContent = value; });
    field(card, "authors").innerHTML = preferenceAuthorsHtml(authorsOf(album), preferences.authors, { link: true });
    const stance = authorStance(authorsOf(album), preferences.authors);
    if (stance) card.dataset.authorPreference = stance;
    else delete card.dataset.authorPreference;
    const tags = field(card, "tags");
    tags.innerHTML = preferenceTagsHtml(album.tags, preferences.tags, { compact: true, prioritize: true });
    card.dataset.details = "ready";
    fitTagRows(tags, TAG_ROWS);
    tagResizer?.observe(tags);
}

/** Fill every pending rich card inside `root` once it comes near the viewport. */
export function hydrateRichCards(root = document) {
    root.querySelectorAll(".rich-card[data-details=\"pending\"]").forEach((card) => {
        if (observer) observer.observe(card);
        else enqueue(card);
    });
}
