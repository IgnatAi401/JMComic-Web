import { jmApi } from "../api/JmcomicApi.js";
import { ImageCutter } from "./ImageCutter.js";

const MB = 1024 * 1024;
const userAgent = navigator.userAgent || "";
const isIOSWebKit = /iPad|iPhone|iPod/.test(userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isSafari = /Safari/.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/.test(userAgent);

export class EagerComicImageLoader {
    constructor(id, { batchSize = 5, onLayoutChange = null } = {}) {
        this.id = String(id);
        this.cutter = new ImageCutter();
        this.onLayoutChange = typeof onLayoutChange === "function" ? onLayoutChange : null;
        this.containers = [];
        this.renderQueue = [];
        this.renderQueued = new Set();
        this.activeLoads = 0;
        this.suspended = false;
        this.layoutFrames = new Set();
        this.currentIndex = 0;
        this.desiredIndexes = new Set();
        this.memoryBudget = (isIOSWebKit ? 112 : isSafari ? 160 : 256) * MB;
        this.unknownImageEstimate = (isIOSWebKit || isSafari ? 16 : 24) * MB;
        this.maxBefore = isIOSWebKit ? 2 : 4;
        this.maxAfter = isIOSWebKit ? 4 : 8;
        this.setBatchSize(batchSize);
    }

    start(containers) {
        this.containers = containers;
        this.setCurrent(0);
        this.handlePageHide = () => this.suspend();
        this.handlePageShow = (event) => {
            if (!event.persisted || !this.suspended) return;
            this.suspended = false;
            this.setCurrent(this.currentIndex);
        };
        window.addEventListener("jm-image-server-change", () => {
            if (this.suspended) return;
            this.desiredIndexes.forEach((index) => this.release(this.containers[index]));
            this.updateRenderWindow();
        });
        window.addEventListener("pagehide", this.handlePageHide);
        window.addEventListener("pageshow", this.handlePageShow);
    }

    suspend() {
        if (this.suspended) return;
        this.suspended = true;
        this.renderQueue.length = 0;
        this.renderQueued.clear();
        this.layoutFrames.forEach((frame) => cancelAnimationFrame(frame));
        this.layoutFrames.clear();
        this.desiredIndexes.forEach((index) => this.release(this.containers[index]));
        this.desiredIndexes.clear();
    }

    setBatchSize(value) {
        const number = Number(value);
        this.batchSize = Number.isInteger(number) && number >= 1 && number <= 100 ? number : 5;
        this.pumpRenderQueue();
    }

    setCurrent(index) {
        if (!this.containers.length || this.suspended) return;
        this.currentIndex = Math.min(this.containers.length - 1, Math.max(0, Math.trunc(Number(index) || 0)));
        this.updateRenderWindow();
    }

    candidateIndexes() {
        const indexes = [this.currentIndex];
        for (let distance = 1; distance <= Math.max(this.maxBefore, this.maxAfter); distance++) {
            if (distance <= this.maxAfter && this.currentIndex + distance < this.containers.length) {
                indexes.push(this.currentIndex + distance);
            }
            if (distance <= this.maxBefore && this.currentIndex - distance >= 0) {
                indexes.push(this.currentIndex - distance);
            }
        }
        return indexes;
    }

    calculateDesiredIndexes() {
        const desired = new Set();
        let estimatedBytes = 0;
        for (const index of this.candidateIndexes()) {
            const storedEstimate = Number(this.containers[index].dataset.decodedBytes);
            const estimate = Number.isFinite(storedEstimate) && storedEstimate > 0
                ? storedEstimate
                : this.unknownImageEstimate;
            if (!desired.size || estimatedBytes + estimate <= this.memoryBudget) {
                desired.add(index);
                estimatedBytes += estimate;
            }
        }
        return desired;
    }

    updateRenderWindow() {
        if (this.suspended) return;
        const nextDesired = this.calculateDesiredIndexes();
        this.desiredIndexes.forEach((index) => {
            if (!nextDesired.has(index)) this.release(this.containers[index]);
        });
        this.desiredIndexes = nextDesired;
        this.renderQueue.length = 0;
        this.renderQueued.clear();
        [...nextDesired]
            .sort((a, b) => Math.abs(a - this.currentIndex) - Math.abs(b - this.currentIndex))
            .forEach((index) => {
                const container = this.containers[index];
                this.enqueueRender(container);
            });
    }

    enqueueRender(container) {
        const index = Number(container.dataset.index);
        if (
            container.dataset.state === "loaded"
            || container.dataset.state === "rendering"
            || container.dataset.state === "error"
            || this.renderQueued.has(index)
        ) return;
        this.renderQueued.add(index);
        this.renderQueue.push(container);
        this.renderQueue.sort((a, b) => (
            Math.abs(Number(a.dataset.index) - this.currentIndex)
            - Math.abs(Number(b.dataset.index) - this.currentIndex)
        ));
        this.pumpRenderQueue();
    }

    pumpRenderQueue() {
        while (!this.suspended && this.activeLoads < this.batchSize && this.renderQueue.length) {
            const container = this.renderQueue.shift();
            const index = Number(container.dataset.index);
            this.renderQueued.delete(index);
            if (!this.desiredIndexes.has(index) || container.dataset.state !== "pending") continue;
            this.activeLoads++;
            this.render(container).catch(() => {}).finally(() => {
                this.activeLoads--;
                this.pumpRenderQueue();
            });
        }
    }

    isLayoutStableBefore(index) {
        const targetIndex = Number(index);
        return [...this.desiredIndexes]
            .filter((candidate) => candidate < targetIndex)
            .every((candidate) => {
                const container = this.containers[candidate];
                return container.dataset.state === "loaded"
                    || container.dataset.state === "error";
            });
    }

    notifyLayoutChange(container) {
        const generation = container.dataset.generation;
        const frame = requestAnimationFrame(() => {
            this.layoutFrames.delete(frame);
            if (this.suspended || container.dataset.generation !== generation) return;
            const renderedHeight = container.getBoundingClientRect().height;
            if (renderedHeight > 0) container.dataset.renderedHeight = String(renderedHeight);
            this.onLayoutChange?.(Number(container.dataset.index));
        });
        this.layoutFrames.add(frame);
    }

    async render(container) {
        const index = Number(container.dataset.index);
        const generation = (Number(container.dataset.generation) || 0) + 1;
        container.dataset.generation = String(generation);
        container.dataset.state = "rendering";
        try {
            if (!this.desiredIndexes.has(index) || Number(container.dataset.generation) !== generation) return;
            await this.decodeIntoContainer(container, generation);
        } catch (error) {
            if (Number(container.dataset.generation) === generation) {
                container.dataset.state = "error";
                this.renderError(container, error);
            }
            throw error;
        }
    }

    renderError(container, error) {
        const panel = document.createElement("div");
        panel.className = "reader-image-error";
        const message = document.createElement("span");
        message.textContent = error?.message || `第 ${Number(container.dataset.index) + 1} 页加载失败`;
        const retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = "重新加载";
        retry.addEventListener("click", () => {
            if (this.suspended) return;
            container.dataset.state = "pending";
            container.replaceChildren();
            this.enqueueRender(container);
        }, { once: true });
        panel.append(message, retry);
        container.replaceChildren(panel);
        this.notifyLayoutChange(container);
    }

    decodeIntoContainer(container, generation) {
        // Plain <img> loading allows cross-origin display and Canvas drawing
        // without requiring readable response bytes or CORS-enabled exports.
        const sources = jmApi.getChapterImageURLs(this.id, container.dataset.path);
        return new Promise((resolve, reject) => {
            let settled = false;
            let timer;
            let image = null;
            let sourceIndex = 0;
            const isCurrent = () => !settled && !this.suspended
                && this.desiredIndexes.has(Number(container.dataset.index))
                && Number(container.dataset.generation) === generation;
            const detach = () => {
                clearTimeout(timer);
                if (!image) return;
                image.onload = null;
                image.onerror = null;
                image.removeAttribute("src");
            };
            const finish = (error = null) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (image) { image.onload = null; image.onerror = null; }
                if (container.cancelDecode === cancelDecode) delete container.cancelDecode;
                if (error) { detach(); reject(error); }
                else resolve(container);
            };
            const cancelDecode = () => { detach(); finish(); };
            container.cancelDecode = cancelDecode;
            const tryNext = () => {
                detach();
                if (!isCurrent()) { finish(); return; }
                if (sourceIndex >= sources.length) {
                    finish(new Error(`第 ${Number(container.dataset.index) + 1} 页所有图片线路均加载失败，请重试或换线`));
                    return;
                }
                const attemptImage = document.createElement("img");
                image = attemptImage;
                image.alt = "";
                image.decoding = "async";
                image.referrerPolicy = "no-referrer";
                container.replaceChildren(image);
                const isAttemptCurrent = () => isCurrent() && image === attemptImage;
                image.onload = () => {
                    if (!isAttemptCurrent()) return;
                    const width = image.naturalWidth;
                    const height = image.naturalHeight;
                    if (!width || !height) { tryNext(); return; }
                    // Size the whole page, including all decoded canvas slices.
                    container.style.setProperty("--reader-image-ratio", String(width / height));
                    const isGif = container.dataset.path.toLowerCase().endsWith(".gif");
                    container.dataset.decodedBytes = String(width * height * 4 * (isGif ? 2 : 1));
                    try {
                        if (Number(this.id) >= 220980 && !isGif) {
                            container.replaceChildren(this.cutter.cutImage(image, this.id, container.dataset.path));
                            detach();
                        } else {
                            image.style.filter = "none";
                        }
                        container.style.height = "";
                        delete container.dataset.placeholder;
                        container.dataset.state = "loaded";
                        finish();
                        this.updateRenderWindow();
                        this.notifyLayoutChange(container);
                    } catch (error) { finish(error); }
                };
                image.onerror = () => { if (isAttemptCurrent()) tryNext(); };
                timer = setTimeout(() => { if (isAttemptCurrent()) tryNext(); }, 15000);
                image.src = sources[sourceIndex++];
            };
            tryNext();
        });
    }

    release(container) {
        if (!container) return;
        const height = container.getBoundingClientRect().height || Number(container.dataset.renderedHeight) || 0;
        if (height > 0) {
            container.dataset.renderedHeight = String(height);
            container.dataset.placeholder = "true";
            container.style.height = `${height}px`;
        }
        container.dataset.generation = String((Number(container.dataset.generation) || 0) + 1);
        if (typeof container.cancelDecode === "function") container.cancelDecode();
        container.querySelectorAll("img").forEach((image) => {
            image.onload = null;
            image.onerror = null;
            image.removeAttribute("src");
        });
        container.querySelectorAll("canvas").forEach((canvas) => {
            canvas.width = 0;
            canvas.height = 0;
        });
        container.replaceChildren();
        container.dataset.state = "pending";
    }
}
