import { mountShell } from "../ui/shell.js";
import { mountReadingControls } from "../ui/reading-controls.js";
import { libraryStore } from "../data/LibraryStore.js";
import { PreferenceEditor } from "../ui/preference-editor.js";
import { AUTHOR_LEVELS, TAG_LEVELS, preferenceMaps } from "../ui/preferences.js";
import { clearCache } from "../utils/BrowserCache.js";
import { showToast } from "../ui/toast.js";
import { openChangelog } from "../ui/changelog.js";
import { LATEST_VERSION } from "../data/changelog.js";

mountShell();
mountReadingControls(document.querySelector("#settings-reading"));

const editors = [
    new PreferenceEditor(document.querySelector("#settings-tag-preferences"), { kind: "tag", levels: TAG_LEVELS, noun: "标签" }).mount(),
    new PreferenceEditor(document.querySelector("#settings-author-preferences"), { kind: "author", levels: AUTHOR_LEVELS, noun: "作者" }).mount(),
];
const renderPreferences = () => {
    const { tags, authors } = preferenceMaps(libraryStore.getPreferences());
    editors[0].render(tags);
    editors[1].render(authors);
};
renderPreferences();
// Keep the editors current when another tab changes the stances.
window.addEventListener("jm-library-change", renderPreferences);

const changelogVersion = document.querySelector("[data-changelog-version]");
if (changelogVersion && LATEST_VERSION) changelogVersion.textContent = `当前版本 ${LATEST_VERSION}`;
document.querySelector("[data-open-changelog]")?.addEventListener("click", (event) => openChangelog(event.currentTarget));

document.querySelector("[data-clear-cache]")?.addEventListener("click", () => {
    const count = clearCache();
    showToast(count ? `已清除 ${count} 项接口缓存` : "当前没有接口缓存", "success");
});
