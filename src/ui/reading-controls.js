import { setting } from "../core/Setting.js";
import { showToast } from "./toast.js";

const SOURCE_COUNT = 6;
const BATCH_VALUES = [1, 2, 5, 10, 20, 50, 100];

/**
 * Image source (1–6) and parallel image loading pickers.
 * Both are device-local settings; every mounted instance stays in sync through
 * the `jm-image-server-change` / `jm-settings-change` events Setting dispatches.
 */
export function mountReadingControls(container, { compact = false } = {}) {
    container.innerHTML = `
        <div class="reading-control">
            <div class="field-label" id="${container.id || "reading"}-source-label">图片线路</div>
            <div class="source-picker" role="radiogroup" aria-labelledby="${container.id || "reading"}-source-label">
                ${Array.from({ length: SOURCE_COUNT }, (_, index) => `<button type="button" role="radio" data-source="${index}" aria-label="图源 ${index + 1}">${index + 1}</button>`).join("")}
            </div>
            ${compact ? "" : '<p class="picker-note">图片加载慢或失败时换一条线路；阅读页会自动在失败时依次尝试其他线路。</p>'}
        </div>
        <div class="reading-control">
            <div class="field-label" id="${container.id || "reading"}-batch-label">同时加载页数</div>
            <div class="batch-picker" role="radiogroup" aria-labelledby="${container.id || "reading"}-batch-label">
                ${BATCH_VALUES.map((value) => `<button type="button" role="radio" data-batch="${value}">${value}</button>`).join("")}
            </div>
            ${compact ? "" : '<p class="picker-note">优先加载当前页附近；数值越大越快，但更占内存。仅保存在此设备。</p>'}
        </div>`;

    const render = () => {
        const source = Number(setting.using_imgserver_index) || 0;
        container.querySelectorAll("[data-source]").forEach((button) => {
            const checked = Number(button.dataset.source) === source;
            button.setAttribute("aria-checked", String(checked));
            button.tabIndex = checked ? 0 : -1;
        });
        const batch = setting.image_load_batch_size;
        container.querySelectorAll("[data-batch]").forEach((button) => {
            const checked = Number(button.dataset.batch) === batch;
            button.setAttribute("aria-checked", String(checked));
            button.tabIndex = checked ? 0 : -1;
        });
    };

    container.addEventListener("click", async (event) => {
        const sourceButton = event.target.closest("[data-source]");
        if (sourceButton) {
            setting.setOption("using_imgserver_index", Number(sourceButton.dataset.source));
            return;
        }
        const batchButton = event.target.closest("[data-batch]");
        if (batchButton) {
            try {
                await setting.setImageLoadBatchSize(Number(batchButton.dataset.batch));
            } catch (error) {
                showToast(error.message, "warning");
            }
        }
    });

    // Arrow keys move within each radio group, as native radios do.
    container.addEventListener("keydown", (event) => {
        const current = event.target.closest?.("[role=radio]");
        if (!current) return;
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        const group = [...current.parentElement.children];
        const next = group[(group.indexOf(current) + step + group.length) % group.length];
        next.focus();
        next.click();
    });

    window.addEventListener("jm-image-server-change", render);
    window.addEventListener("jm-settings-change", render);
    render();
}
