/* Small, dependency-free helpers shared by every page. */

export const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
})[char]);

export const asArray = (value) => Array.isArray(value)
    ? value.filter((item) => item != null && item !== "")
    : (value == null || value === "" ? [] : [value]);

export const asText = (value, fallback = "") => {
    if (value == null || typeof value === "object") return fallback;
    const text = String(value).trim();
    return text || fallback;
};

export const textList = (value) => asArray(value).map((item) => asText(item)).filter(Boolean);

export const authorsOf = (item) => textList(item?.author ?? item?.authors);

export const isApiTrue = (value) => value === true || value === 1 || value === "1" || value === "true";

export const finiteNumber = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
};

export const formatCount = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "0";
    if (number >= 1e8) return `${(number / 1e8).toFixed(1)}亿`;
    if (number >= 1e4) return `${(number / 1e4).toFixed(1)}万`;
    return number.toLocaleString("zh-CN");
};

export const formatDate = (seconds, options = {}) => {
    const number = Number(seconds);
    if (!number) return "";
    return new Date(number * 1000).toLocaleDateString("zh-CN", options);
};

export const formatDateTime = (milliseconds) => {
    const number = Number(milliseconds);
    if (!number) return "";
    return new Date(number).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

export const plainText = (value) => {
    const template = document.createElement("template");
    template.innerHTML = String(value ?? "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/div\s*>/gi, "\n");
    return (template.content.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
};

export const detailUrl = (id) => `./chapter.html?id=${encodeURIComponent(id)}`;
export const searchUrl = (query) => `./search.html?sq=${encodeURIComponent(query)}`;
export const readerUrl = (chapterId, albumId, page = 0) => `./reader.html?id=${encodeURIComponent(chapterId)}&album=${encodeURIComponent(albumId)}${Number(page) > 1 ? `&page=${Math.trunc(Number(page))}` : ""}`;

export const pageName = () => location.pathname.split("/").pop()?.replace(".html", "") || "index";

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export const setBusy = (button, busy, label = null) => {
    if (!button) return;
    button.disabled = busy;
    button.classList.toggle("is-busy", busy);
    button.setAttribute("aria-busy", String(busy));
    if (label !== null) button.textContent = label;
};

