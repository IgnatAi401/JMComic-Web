import { jmApi } from "../api/JmcomicApi.js";
import { mountShell } from "../ui/shell.js";
import { Feed } from "../ui/feed.js";
import { comicCardHtml } from "../ui/comic-card.js";
import { hydrateCovers } from "../ui/covers.js";
import { hydrateRichCards } from "../ui/rich-cards.js";
import { renderPageError, stateHtml } from "../ui/states.js";
mountShell();
const grid = document.querySelector("[data-results]");
const seen = new Set();
async function init() {
    await jmApi.init();
    const feed = new Feed({ footer: document.querySelector("[data-feed]"), loadPage: async (page, current) => {
        const result = await jmApi.getLatestContent(page);
        if (!current()) return {};
        const items = Array.isArray(result) ? result : result?.content || [];
        const unique = items.filter((item) => { const id = String(item.id); if (seen.has(id)) return false; seen.add(id); return true; });
        grid.querySelector(".state")?.remove();
        grid.insertAdjacentHTML("beforeend", unique.map((item) => comicCardHtml(item)).join(""));
        if (!seen.size) grid.innerHTML = stateHtml({title:"暂时没有更新"});
        hydrateCovers(grid);
        hydrateRichCards(grid);
        return { done: !items.length || !unique.length, count: unique.length };
    }});
    document.querySelector("[data-refresh]").addEventListener("click", () => { grid.replaceChildren(); seen.clear(); feed.restart(); });
    await feed.restart();
}
init().catch((error) => renderPageError(grid, error));
