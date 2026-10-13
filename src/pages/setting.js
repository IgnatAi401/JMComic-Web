import { mountShell } from "../ui/shell.js";
import { mountReadingControls } from "../ui/reading-controls.js";
import { libraryStore } from "../data/LibraryStore.js";
import { PreferenceEditor } from "../ui/preference-editor.js";
import { AUTHOR_LEVELS, TAG_LEVELS, preferenceMaps } from "../ui/preferences.js";
import { clearCache } from "../utils/BrowserCache.js";
import { showToast } from "../ui/toast.js";
import { confirmAction } from "../ui/confirm.js";
import { exportUserData, parseBackupFile, restoreUserData } from "../data/UserDataBackup.js";
import { openChangelog } from "../ui/changelog.js";
import { LATEST_VERSION } from "../data/changelog.js";
import { readSessionStorage, removeSessionStorage, writeSessionStorage } from "../utils/BrowserStorage.js";

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

// A restore reloads the page so every module re-reads its settings; the result is shown afterwards.
const IMPORT_NOTICE_KEY = "jm_import_notice";
const importNotice = readSessionStorage(IMPORT_NOTICE_KEY);
if (importNotice) {
    removeSessionStorage(IMPORT_NOTICE_KEY);
    showToast(importNotice, "success");
}

document.querySelector("[data-export-data]")?.addEventListener("click", () => {
    try {
        const count = exportUserData();
        showToast(count ? `已导出 ${count} 项用户数据` : "当前没有用户数据，已导出空备份", "success");
    } catch (error) {
        showToast(error.message || "导出失败", "error");
    }
});

const importInput = document.querySelector("[data-import-file]");
document.querySelector("[data-import-data]")?.addEventListener("click", () => importInput?.click());
importInput?.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    // Allow choosing the same file again after a cancelled or failed import.
    importInput.value = "";
    if (!file) return;
    try {
        const { data, exportedAt } = await parseBackupFile(file);
        const count = Object.keys(data).length;
        if (!count) throw new Error("备份文件里没有可恢复的数据");
        const date = exportedAt && !Number.isNaN(Date.parse(exportedAt)) ? new Date(exportedAt).toLocaleString("zh-CN") : "未知时间";
        const confirmed = await confirmAction({
            title: "导入用户数据",
            message: `备份导出于 ${date}，共 ${count} 项。导入会用备份替换当前浏览器里的历史、书架、偏好和阅读设置，无法撤销。建议先导出一份当前数据。`,
            label: "替换并导入",
        });
        if (!confirmed) return;
        restoreUserData(data);
        writeSessionStorage(IMPORT_NOTICE_KEY, `已导入 ${count} 项用户数据`);
        window.location.reload();
    } catch (error) {
        showToast(error.message || "导入失败", "error");
    }
});
