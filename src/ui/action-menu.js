import { escapeHtml } from "./dom.js";
import { icon } from "./icons.js";

/**
 * 列表工具栏右侧的“⋯”菜单：放清空、新建收藏夹等不常用的操作，避免和常用按钮挤在一起被误点。
 * 点菜单外或按 Esc 关闭；没有可用操作时整个按钮隐藏。
 */
export class ActionMenu {
    items = [];

    constructor({ label = "更多操作" } = {}) {
        this.root = document.createElement("div");
        this.root.className = "action-menu";
        this.root.innerHTML = `<button class="icon-btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${icon("more")}</button>
            <div class="action-menu-list" role="menu" hidden></div>`;
        this.button = this.root.querySelector("button");
        this.list = this.root.querySelector("[role=menu]");
        this.button.addEventListener("click", () => this.toggle());
        this.list.addEventListener("click", (event) => {
            const item = event.target.closest("[data-index]");
            if (!item) return;
            const entry = this.items[Number(item.dataset.index)];
            this.close();
            entry?.onSelect?.();
        });
        document.addEventListener("click", (event) => {
            if (this.isOpen && !this.root.contains(event.target)) this.close();
        });
        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape" || !this.isOpen) return;
            this.close();
            this.button.focus();
        });
    }

    get isOpen() { return !this.list.hidden; }

    /** items: [{ label, icon?, danger?, onSelect }] */
    setItems(items) {
        this.items = items.filter(Boolean);
        this.root.hidden = !this.items.length;
        if (!this.items.length) this.close();
        this.list.innerHTML = this.items.map((item, index) => `<button class="action-menu-item${item.danger ? " is-danger" : ""}" type="button" role="menuitem" data-index="${index}">${item.icon ? icon(item.icon) : ""}<span>${escapeHtml(item.label)}</span></button>`).join("");
    }

    open() {
        this.list.hidden = false;
        this.button.setAttribute("aria-expanded", "true");
        this.list.querySelector("button")?.focus({ preventScroll: true });
    }

    close() {
        this.list.hidden = true;
        this.button.setAttribute("aria-expanded", "false");
    }

    toggle() { if (this.isOpen) this.close(); else this.open(); }
}
