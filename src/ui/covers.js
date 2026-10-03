import { jmApi } from "../api/JmcomicApi.js";
import { escapeHtml } from "./dom.js";

const observer = typeof IntersectionObserver === "function"
    ? new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            observer.unobserve(entry.target);
            loadCover(entry.target);
        });
    }, { rootMargin: "400px 400px" })
    : null;

function loadCover(cover) {
    const image = cover.querySelector("img");
    const sources = [cover.dataset.coverSrc, cover.dataset.coverFallback].filter(Boolean);
    if (!image || !sources.length) return;
    let index = 0;
    image.decoding = "async";
    image.onload = () => {
        image.classList.add("is-loaded");
        cover.classList.add("is-ready");
    };
    image.onerror = () => {
        index += 1;
        if (index < sources.length) {
            image.src = sources[index];
            return;
        }
        image.removeAttribute("src");
        cover.classList.add("is-ready", "is-error");
    };
    image.src = sources[0];
}

/** Start lazily loading every unbound cover inside `root`. */
export function hydrateCovers(root = document) {
    root.querySelectorAll(".cover[data-cover-src]:not([data-cover-bound])").forEach((cover) => {
        cover.dataset.coverBound = "true";
        if (observer && cover.dataset.coverEager !== "true") observer.observe(cover);
        else loadCover(cover);
    });
}

export const coverUrlFor = (item) => {
    const id = String(item?.id ?? "");
    return String(item?.cover_url || item?.coverUrl || (id ? jmApi.getCoverImageURL(id) : ""));
};

/** A cover tile. Pass `href` to make it a link; pass `index` for a catalogue number overlay. */
export const coverHtml = (item, { href = "", index = "", hiddenFromA11y = true, eager = false } = {}) => {
    const id = String(item?.id ?? "");
    const primary = coverUrlFor(item);
    const fallback = id ? jmApi.getCoverImageURL(id) : "";
    const tag = href ? "a" : "div";
    const attrs = [
        `class="cover"`,
        href ? `href="${escapeHtml(href)}"` : "",
        href && hiddenFromA11y ? `tabindex="-1" aria-hidden="true"` : "",
        `data-cover-src="${escapeHtml(primary)}"`,
        fallback && fallback !== primary ? `data-cover-fallback="${escapeHtml(fallback)}"` : "",
        eager ? `data-cover-eager="true"` : "",
    ].filter(Boolean).join(" ");
    return `<${tag} ${attrs}>${index ? `<span class="cover-index">${escapeHtml(index)}</span>` : ""}<img alt="" width="300" height="400" /></${tag}>`;
};
