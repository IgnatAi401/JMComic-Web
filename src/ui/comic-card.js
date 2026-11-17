import { authorsOf, asText, detailUrl, escapeHtml } from "./dom.js";
import { coverHtml } from "./covers.js";
import { icon } from "./icons.js";
import { preferenceAuthorsHtml } from "./preferences.js";
import { watchLaterButtonHtml } from "./watch-later.js";

// [field, label, icon]: one compact row; the label stays readable to screen readers and on hover.
// Authors named on a card; the rest fold into "+N" so a long list never grows the card.
export const CARD_AUTHORS = 2;

const RICH_STATS = [["chapters", "章节", "list"], ["pages", "页数", "pages"], ["views", "观看", "eye"], ["likes", "喜欢", "heart"], ["date", "发布", ""]];

/**
 * The catalogue tile shared by every comic list: cover beside the title, album
 * statistics and stance-coloured tags and authors. Listing APIs omit these fields,
 * so they start as placeholders and `hydrateRichCards` fills them.
 */
/** `after` is trusted HTML shown as a full-width row under the card; `fillTitle` lets the details request fill in the title. */
export const comicCardHtml = (comic, { meta = "", highlight = false, footer = "", after = "", fillTitle = false } = {}) => {
    const id = String(comic?.id ?? "").trim();
    const title = asText(comic?.name ?? comic?.title, "未命名作品");
    const href = detailUrl(id);
    const category = asText(comic?.category?.title);
    return `<article class="comic-card rich-card" data-comic-id="${escapeHtml(id)}" data-details="pending"${fillTitle ? " data-fill-title" : ""}>
        ${coverHtml(comic, { href })}
        <div class="rich-card-body">
            <h3 class="comic-title"><a href="${href}">${escapeHtml(title)}</a></h3>
            <p class="comic-meta"><span data-detail="authors">${preferenceAuthorsHtml(authorsOf(comic), undefined, { link: true, limit: CARD_AUTHORS })}</span>${category ? ` · ${escapeHtml(category)}` : ""}</p>
            ${meta ? `<p class="comic-meta rich-note${highlight ? " is-highlight" : ""}">${escapeHtml(meta)}</p>` : ""}
            <div class="tag-list rich-tags" data-detail="tags" aria-live="polite"></div>
            <dl class="rich-stats">${RICH_STATS.map(([key, label, glyph]) => {
                const stat = `<div title="${label}"><dt class="visually-hidden">${label}</dt>${glyph ? icon(glyph) : ""}<dd class="num" data-detail="${key}">—</dd></div>`;
                // 卡片操作按钮和日期同一行、靠右，不额外占一行把卡片撑高。
                return key === "date" && footer ? `<div class="rich-stats-end">${stat}${footer}</div>` : stat;
            }).join("")}</dl>
        </div>
        ${after}
        ${id ? watchLaterButtonHtml(comic, { compact: true }) : ""}
    </article>`;
};
