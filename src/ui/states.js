import { escapeHtml } from "./dom.js";
import { icon } from "./icons.js";

const ICONS = { empty: "inbox", error: "alert", warning: "info", info: "info" };

/**
 * Markup for an empty / error / loading block. `action` is either
 * { href, label } for a link or { label, attrs } for a button.
 */
export const stateHtml = ({ tone = "empty", title = "", message = "", action = null, compact = false, iconName = "" } = {}) => {
    const actionHtml = !action ? "" : action.href
        ? `<a class="btn btn-outline btn-sm" href="${escapeHtml(action.href)}"${action.attrs ? ` ${action.attrs}` : ""}>${escapeHtml(action.label)}</a>`
        : `<button class="btn btn-outline btn-sm" type="button"${action.attrs ? ` ${action.attrs}` : ""}>${escapeHtml(action.label)}</button>`;
    return `<div class="state is-${tone}${compact ? " is-compact" : ""}" role="${tone === "error" ? "alert" : "status"}">
        <span class="state-icon">${icon(iconName || ICONS[tone] || "info")}</span>
        ${title ? `<strong class="state-title">${escapeHtml(title)}</strong>` : ""}
        ${message ? `<p class="state-message">${escapeHtml(message)}</p>` : ""}
        ${actionHtml}
    </div>`;
};

export const loadingHtml = (label = "正在载入") => `<div class="loading-row" role="status"><span class="spinner" aria-hidden="true"></span><span>${escapeHtml(label)}</span></div>`;

export function renderState(target, options) {
    const root = typeof target === "string" ? document.querySelector(target) : target;
    if (!root) return;
    root.hidden = false;
    root.innerHTML = stateHtml(options);
}

export function renderPageError(target, error, { title = "页面加载失败", action = { href: "./index.html", label: "返回发现" } } = {}) {
    renderState(target, {
        tone: "error",
        title,
        message: error?.message || "请稍后重试",
        action,
    });
}
