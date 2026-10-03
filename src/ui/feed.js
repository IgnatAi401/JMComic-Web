import { escapeHtml } from "./dom.js";

/**
 * Paged feed driven by a sentinel at the end of the list. Every reset bumps a
 * generation so late responses from an older query can never render.
 * `loadPage(page, isCurrent)` renders its own items and resolves `{ done }`.
 */
export class Feed {
    constructor({ footer, loadPage, endLabel = "已经到底了", rootMargin = "900px 0px" }) {
        this.footer = footer;
        this.loadPage = loadPage;
        this.endLabel = endLabel;
        this.generation = 0;
        this.page = 0;
        this.done = false;
        this.loading = false;
        this.failed = false;
        this.footer.innerHTML = '<div class="feed-status"></div><div class="feed-sentinel" aria-hidden="true"></div>';
        this.status = this.footer.querySelector(".feed-status");
        this.sentinel = this.footer.querySelector(".feed-sentinel");
        this.footer.addEventListener("click", (event) => {
            if (event.target.closest("[data-feed-retry]")) this.loadNext();
        });
        this.observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) this.loadNext();
        }, { rootMargin });
        this.observer.observe(this.sentinel);
        window.addEventListener("online", () => {
            if (this.failed) this.loadNext();
        });
    }

    reset() {
        this.generation += 1;
        this.page = 0;
        this.done = false;
        this.loading = false;
        this.failed = false;
        this.renderStatus("idle");
    }

    restart() {
        this.reset();
        return this.loadNext();
    }

    isCurrent(generation) {
        return generation === this.generation;
    }

    async loadNext() {
        if (this.loading || this.done) return false;
        const generation = this.generation;
        const page = this.page + 1;
        this.loading = true;
        this.failed = false;
        this.renderStatus("loading");
        try {
            const result = await this.loadPage(page, () => this.isCurrent(generation));
            if (!this.isCurrent(generation)) return false;
            this.page = page;
            this.done = Boolean(result?.done);
            this.loading = false;
            this.renderStatus(this.done ? (page > 1 || result?.count ? "end" : "idle") : "idle");
            if (!this.done) requestAnimationFrame(() => this.continueIfVisible(generation));
            return true;
        } catch (error) {
            if (!this.isCurrent(generation)) return false;
            this.loading = false;
            this.failed = true;
            this.renderStatus("error", error?.message);
            return false;
        }
    }

    continueIfVisible(generation) {
        if (!this.isCurrent(generation) || this.loading || this.done) return;
        const rect = this.sentinel.getBoundingClientRect();
        if (rect.top < window.innerHeight + 900) this.loadNext();
    }

    renderStatus(state, message = "") {
        this.footer.dataset.state = state;
        if (state === "loading") {
            this.status.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>正在载入</span>';
        } else if (state === "error") {
            this.status.innerHTML = `<span>${escapeHtml(message || "载入失败")}</span><button class="btn btn-outline btn-sm" type="button" data-feed-retry>重新载入</button>`;
        } else if (state === "end") {
            this.status.textContent = this.endLabel;
        } else {
            this.status.replaceChildren();
        }
    }
}
