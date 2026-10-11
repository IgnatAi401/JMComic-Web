/*
 * Changelog dialog. It opens once per browser session until the visitor picks
 * "此版本不再提醒"; that choice is remembered per version, so a new release shows it again.
 */
import { CHANGELOG, LATEST_VERSION } from "../data/changelog.js";
import { escapeHtml } from "./dom.js";
import { Sheet } from "./overlay.js";
import {
    readLocalStorage, readSessionStorage, writeLocalStorage, writeSessionStorage,
} from "../utils/BrowserStorage.js";

const DISMISSED_KEY = "jm_changelog_dismissed";
const CLOSED_KEY = "jm_changelog_closed";

let sheet = null;

const isDismissed = () => readLocalStorage(DISMISSED_KEY) === LATEST_VERSION;

const renderEntries = () => CHANGELOG.map((entry, index) => `
    <article class="changelog-entry">
        <header class="changelog-entry-head">
            <h3 class="changelog-version">${escapeHtml(entry.version)}</h3>
            ${index === 0 ? '<span class="changelog-latest">最新</span>' : ""}
            ${entry.date ? `<time class="changelog-date" datetime="${escapeHtml(entry.date)}">${escapeHtml(entry.date)}</time>` : ""}
        </header>
        <ul class="changelog-items">${(entry.items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </article>`).join("");

const ensureSheet = () => {
    if (sheet) return sheet;
    sheet = new Sheet({
        name: "changelog",
        title: "更新日志",
        // Closing without dismissing waits for the next visit, not the next page.
        onClose: () => writeSessionStorage(CLOSED_KEY, LATEST_VERSION),
    });
    sheet.root.classList.add("changelog-sheet");
    sheet.body.innerHTML = `<div class="changelog-list">${renderEntries()}</div>`;
    const footer = document.createElement("footer");
    footer.className = "changelog-footer";
    footer.innerHTML = '<button class="btn btn-ghost" type="button" data-changelog-dismiss>此版本不再提醒</button>';
    footer.querySelector("[data-changelog-dismiss]").addEventListener("click", () => {
        writeLocalStorage(DISMISSED_KEY, LATEST_VERSION);
        sheet.close();
    });
    sheet.panel.appendChild(footer);
    return sheet;
};

export function openChangelog(opener) {
    if (!CHANGELOG.length) return;
    const current = ensureSheet();
    current.panel.querySelector(".changelog-footer").hidden = isDismissed();
    // Focus the panel, not the first button, so the dismiss choice is never one keypress away.
    current.open({ opener, focus: false });
    current.panel.focus({ preventScroll: true });
}

export function maybeShowChangelog() {
    if (!LATEST_VERSION || isDismissed()) return;
    if (readSessionStorage(CLOSED_KEY) === LATEST_VERSION) return;
    openChangelog();
}
