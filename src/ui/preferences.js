import { libraryStore } from "../data/LibraryStore.js";
import { escapeHtml, searchUrl, textList } from "./dom.js";

/** Stance labels in display order; authors use only the first and last. */
export const LEVEL_LABELS = { like: "喜欢", fond: "较喜欢", avoid: "软回避", dislike: "不喜欢" };
export const TAG_LEVELS = ["like", "fond", "avoid", "dislike"];
export const AUTHOR_LEVELS = ["like", "dislike"];
// Liked names lead, then the warnings, then everything without a stance.
const RANK = { like: 0, fond: 1, dislike: 2, avoid: 3 };

const toMap = (value) => new Map(Object.entries(value && typeof value === "object" ? value : {})
    .filter(([name, level]) => name && LEVEL_LABELS[level]));

/** Normalise stored `{ tags, authors }` objects into maps of name → level. */
export const preferenceMaps = (data) => ({ tags: toMap(data?.tags), authors: toMap(data?.authors) });

/** Tag and author stances saved in this browser beside the reading history. */
export function loadPreferences() {
    return Promise.resolve(preferenceMaps(libraryStore.getPreferences()));
}

const stanceAttrs = (name, level) => level
    ? ` data-preference="${level}" title="${LEVEL_LABELS[level]}" aria-label="${escapeHtml(`${name}（${LEVEL_LABELS[level]}）`)}"`
    : "";

/** Next stance after `level` in `levels`, wrapping through "no stance" (null). */
export const nextLevel = (level, levels) => level && levels.indexOf(level) < levels.length - 1
    ? levels[levels.indexOf(level) + 1]
    : level ? null : levels[0];

// In manage mode a name is a button that cycles its stance instead of a search link.
const manageAttrs = (kind, name) => ` type="button" data-manage-preference="${kind}" data-name="${escapeHtml(name)}"`;

/**
 * Search-link tags coloured by the user's stance. `limit` folds the rest into a
 * "+N" counter; `prioritize` (default when limited) shows stance tags first.
 * `manage` renders stance-cycling buttons instead of links.
 */
export function preferenceTagsHtml(values, preferences = new Map(), { limit = Infinity, compact = false, prioritize = Number.isFinite(limit), manage = false } = {}) {
    const tags = [...new Set(textList(values))];
    const ordered = prioritize
        ? tags.map((tag, index) => ({ tag, index, rank: RANK[preferences.get(tag)] ?? 4 }))
            .sort((a, b) => a.rank - b.rank || a.index - b.index)
            .map((item) => item.tag)
        : tags;
    const shown = ordered.slice(0, limit);
    const className = compact ? "tag is-compact" : "tag";
    const html = shown.map((tag) => manage
        ? `<button class="${className}"${manageAttrs("tag", tag)}${stanceAttrs(tag, preferences.get(tag))}>${escapeHtml(tag)}</button>`
        : `<a class="${className}" href="${searchUrl(tag)}"${stanceAttrs(tag, preferences.get(tag))}>${escapeHtml(tag)}</a>`).join("");
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
 * `limit` folds the rest into a "+N" counter (a toggle button when `expandable`).
 * `manage` keeps the original order and renders stance-cycling buttons.
 */
export function preferenceAuthorsHtml(values, preferences = new Map(), { link = false, fallback = "作者未标注", manage = false, limit = Infinity, expandable = false } = {}) {
    const authors = manage ? [...new Set(textList(values))] : [...new Set(rankedAuthors(values, preferences))];
    if (!authors.length) return escapeHtml(fallback);
    const shown = manage ? authors : authors.slice(0, Math.max(1, limit));
    const html = shown.map((author) => {
        const attrs = `class="author-name"${stanceAttrs(author, preferences.get(author))}`;
        if (manage) return `<button ${attrs}${manageAttrs("author", author)}>${escapeHtml(author)}</button>`;
        return link
            ? `<a ${attrs} href="${searchUrl(author)}">${escapeHtml(author)}</a>`
            : `<span ${attrs}>${escapeHtml(author)}</span>`;
    }).join(" · ");
    const rest = authors.length - shown.length;
    if (rest <= 0) return html;
    const label = `还有 ${rest} 位作者`;
    return expandable
        ? `${html} <button class="author-more" type="button" data-expand-authors aria-expanded="false" aria-label="${label}，展开全部" title="${label}">+${rest}</button>`
        : `${html} <span class="author-more" title="${escapeHtml(authors.slice(shown.length).join("、"))}" aria-label="${label}">+${rest}</span>`;
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

/** Small key explaining the colours; empty when nothing has a stance yet. */
export const preferenceLegendHtml = ({ tags, authors }) => tags.size || authors.size
    ? `<p class="tag-legend" aria-label="标签与作者颜色说明">${TAG_LEVELS.map((level) => `<span data-preference="${level}">${LEVEL_LABELS[level]}</span>`).join("")}</p>`
    : "";
