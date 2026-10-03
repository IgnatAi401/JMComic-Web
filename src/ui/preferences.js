import { escapeHtml, searchUrl, textList } from "./dom.js";

/*
 * Tag and author rendering. The static build has no stored stances, so every
 * preference map is empty; the map parameters are kept so callers stay simple.
 */
const LEVEL_LABELS = { like: "喜欢", fond: "较喜欢", avoid: "软回避", dislike: "不喜欢" };
const RANK = { like: 0, fond: 1, dislike: 2, avoid: 3 };
const EMPTY = Object.freeze({ tags: new Map(), authors: new Map() });

export function loadPreferences() {
    return Promise.resolve(EMPTY);
}

const stanceAttrs = (name, level) => level
    ? ` data-preference="${level}" title="${LEVEL_LABELS[level]}" aria-label="${escapeHtml(`${name}（${LEVEL_LABELS[level]}）`)}"`
    : "";

/**
 * Search-link tags coloured by the user's stance. `limit` folds the rest into a
 * "+N" counter; `prioritize` (default when limited) shows stance tags first.
 */
export function preferenceTagsHtml(values, preferences = new Map(), { limit = Infinity, compact = false, prioritize = Number.isFinite(limit) } = {}) {
    const tags = [...new Set(textList(values))];
    const ordered = prioritize
        ? tags.map((tag, index) => ({ tag, index, rank: RANK[preferences.get(tag)] ?? 4 }))
            .sort((a, b) => a.rank - b.rank || a.index - b.index)
            .map((item) => item.tag)
        : tags;
    const shown = ordered.slice(0, limit);
    const className = compact ? "tag is-compact" : "tag";
    const html = shown.map((tag) => `<a class="${className}" href="${searchUrl(tag)}"${stanceAttrs(tag, preferences.get(tag))}>${escapeHtml(tag)}</a>`).join("");
    const rest = ordered.length - shown.length;
    return rest > 0 ? `${html}${tagMoreHtml(rest, compact)}` : html;
}

const rankedAuthors = (values, preferences) => textList(values)
    .map((author, index) => ({ author, index, rank: RANK[preferences.get(author)] ?? 4 }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((item) => item.author);

/** The strongest author stance among `values` (liked first), or "" when none matches. */
export const authorStance = (values, preferences = new Map()) => preferences.get(rankedAuthors(values, preferences)[0]) || "";

/**
 * Author names as search links or plain text, joined with " · ". Authors with a stance
 * lead the list and render as badges so a hit is never lost behind a truncated line.
 */
export function preferenceAuthorsHtml(values, preferences = new Map(), { link = false, fallback = "作者未标注" } = {}) {
    const authors = rankedAuthors(values, preferences);
    if (!authors.length) return escapeHtml(fallback);
    return authors.map((author) => {
        const attrs = `class="author-name"${stanceAttrs(author, preferences.get(author))}`;
        return link
            ? `<a ${attrs} href="${searchUrl(author)}">${escapeHtml(author)}</a>`
            : `<span ${attrs}>${escapeHtml(author)}</span>`;
    }).join(" · ");
}

const tagMoreHtml = (rest, compact) => `<span class="tag${compact ? " is-compact" : ""} tag-more" title="还有 ${rest} 个标签">+${rest}</span>`;

/**
 * Keep a wrapping tag list within `maxRows` lines by hiding the tags that would
 * spill over and replacing them with a "+N" counter that itself still fits.
 */
export function fitTagRows(container, maxRows = 2) {
    container.querySelector(":scope > .tag-more")?.remove();
    const tags = [...container.querySelectorAll(":scope > .tag")];
    tags.forEach((tag) => { tag.hidden = false; });
    const tops = [...new Set(tags.map((tag) => tag.offsetTop))].sort((a, b) => a - b);
    if (tops.length <= maxRows) return;
    const lastTop = tops[maxRows - 1];
    let visible = tags.findIndex((tag) => tag.offsetTop > lastTop);
    tags.slice(visible).forEach((tag) => { tag.hidden = true; });
    const template = document.createElement("template");
    template.innerHTML = tagMoreHtml(tags.length - visible, tags[0].classList.contains("is-compact"));
    const more = template.content.firstElementChild;
    container.append(more);
    while (visible > 1 && more.offsetTop > lastTop) {
        visible -= 1;
        tags[visible].hidden = true;
        more.textContent = `+${tags.length - visible}`;
        more.title = `还有 ${tags.length - visible} 个标签`;
    }
}
