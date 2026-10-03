import { mountShell } from "../ui/shell.js";
import { mountReadingControls } from "../ui/reading-controls.js";
import { clearCache } from "../utils/BrowserCache.js";
import { showToast } from "../ui/toast.js";

mountShell();
mountReadingControls(document.querySelector("#settings-reading"));

document.querySelector("[data-clear-cache]")?.addEventListener("click", () => {
    const count = clearCache();
    showToast(count ? `已清除 ${count} 项接口缓存` : "当前没有接口缓存", "success");
});
