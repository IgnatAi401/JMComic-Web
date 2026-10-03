import { jmApi } from "../api/JmcomicApi.js";
import { escapeHtml, plainText } from "./dom.js";
import { stateHtml } from "./states.js";

export class Comments {
    constructor(root, id, { title = "读者评论", total = null } = {}) {
        this.root = root; this.id = id; this.title = title; this.total = total; this.page = 0; this.items = [];
    }
    mount({ lazy = false } = {}) {
        this.root.innerHTML = `<div class="section-head"><h2 class="section-title">${escapeHtml(this.title)}</h2><span class="section-meta">${this.total ?? ""}</span></div><div class="comment-list"></div><button class="btn btn-outline" type="button" data-more-comments>${lazy ? "载入本话评论" : "加载更多评论"}</button>`;
        this.button = this.root.querySelector("[data-more-comments]");
        this.button.onclick = () => this.load();
        if (!lazy) this.load();
        return this;
    }
    async load() {
        if (this.loading) return;
        this.loading = true; this.button.disabled = true; this.button.textContent = "正在载入…";
        try {
            const data = await jmApi.getComicComments(this.id, this.page + 1);
            const incoming = (data.list || []).filter((item) => !this.items.some((old) => (old.CID || old.id) && String(old.CID || old.id) === String(item.CID || item.id)));
            this.items.push(...incoming); this.page++;
            this.total = Math.max(Number(data.total) || 0, this.total || 0);
            this.root.querySelector(".section-meta").textContent = this.total;
            this.root.querySelector(".comment-list").innerHTML = this.items.length ? this.items.map((item) => `<article class="comment-item"><span class="comment-avatar" aria-hidden="true">${escapeHtml(String(item.username || "读者").slice(0, 1))}</span><div><h3>${escapeHtml(item.username || "读者")}</h3><p>${escapeHtml(plainText(item.content))}</p></div></article>`).join("") : stateHtml({ title: "暂时没有评论", compact: true });
            this.button.hidden = !incoming.length || this.items.length >= this.total || (data.list || []).length < 10;
            this.button.textContent = "加载更多评论";
        } catch (error) {
            if (!this.items.length) this.root.querySelector(".comment-list").innerHTML = stateHtml({ tone: "error", title: "评论载入失败", message: error.message, compact: true });
            this.button.hidden = false; this.button.textContent = "重试载入评论";
        } finally { this.loading = false; this.button.disabled = false; }
    }
}
