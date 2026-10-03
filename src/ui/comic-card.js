import { authorsOf, asText, detailUrl, escapeHtml } from "./dom.js";
import { coverHtml } from "./covers.js";
import { preferenceAuthorsHtml } from "./preferences.js";
import { watchLaterButtonHtml } from "./watch-later.js";

const RICH_STATS = [["chapters", "章节"], ["pages", "页数"], ["date", "发布"], ["views", "观看"], ["likes", "喜欢"]];

/**
 * The catalogue tile shared by every comic list: cover beside album statistics and
 * stance-coloured tags and authors. Listing APIs omit these fields, so they start as
 * placeholders and `hydrateRichCards` fills them.
 */
export const comicCardHtml = (comic, { meta = "" } = {}) => {
    const id = String(comic?.id ?? "").trim();
    const title = asText(comic?.name ?? comic?.title, "未命名作品");
    const href = detailUrl(id);
    const category = asText(comic?.category?.title);
    return `<article class="comic-card rich-card" data-comic-id="${escapeHtml(id)}" data-details="pending">
        ${coverHtml(comic, { href })}
        <div class="rich-card-body">
            <h3 class="comic-title"><a href="${href}">${escapeHtml(title)}</a></h3>
            <p class="comic-meta"><span data-detail="authors">${preferenceAuthorsHtml(authorsOf(comic), undefined, { link: true })}</span>${category ? ` · ${escapeHtml(category)}` : ""}</p>
            ${meta ? `<p class="comic-meta rich-note">${escapeHtml(meta)}</p>` : ""}
            <dl class="rich-stats">${RICH_STATS.map(([key, label]) => `<div><dt>${label}</dt><dd class="num" data-detail="${key}">—</dd></div>`).join("")}</dl>
        </div>
        <div class="tag-list rich-tags" data-detail="tags" aria-live="polite"></div>
        ${id ? watchLaterButtonHtml(comic, { compact: true }) : ""}
    </article>`;
};
