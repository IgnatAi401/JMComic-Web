/*
 * Overlay primitives: page scroll lock with multiple owners, and a Sheet that is a
 * bottom sheet on compact screens and a centred dialog elsewhere (layout lives in CSS).
 * Escape always closes the top-most sheet; focus returns to whatever opened it.
 */
import { icon } from "./icons.js";

const scrollLocks = new Set();
let scrollLockY = 0;
let previousBodyStyles = null;

export const lockPageScroll = (owner) => {
    if (scrollLocks.has(owner)) return;
    scrollLocks.add(owner);
    if (scrollLocks.size > 1) return;
    scrollLockY = window.scrollY;
    const style = document.body.style;
    previousBodyStyles = {
        position: style.position,
        top: style.top,
        left: style.left,
        right: style.right,
        width: style.width,
        overflow: style.overflow,
    };
    // iOS Safari ignores overflow:hidden on body; pinning the body is the reliable lock.
    Object.assign(style, {
        position: "fixed",
        top: `-${scrollLockY}px`,
        left: "0",
        right: "0",
        width: "100%",
        overflow: "hidden",
    });
};

export const unlockPageScroll = (owner) => {
    if (!scrollLocks.delete(owner) || scrollLocks.size) return;
    Object.assign(document.body.style, previousBodyStyles || {});
    previousBodyStyles = null;
    const root = document.documentElement;
    const behavior = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    window.scrollTo(0, scrollLockY);
    root.style.scrollBehavior = behavior;
};

export const isPageScrollLocked = () => scrollLocks.size > 0;

const openSheets = [];
const inertBeforeModal = new Map();
let escapeBound = false;

const syncModalBackground = () => {
    const active = openSheets.at(-1)?.root;
    if (active) {
        [...document.body.children].forEach((node) => {
            if (!inertBeforeModal.has(node)) inertBeforeModal.set(node, node.inert);
            node.inert = node !== active;
        });
    } else {
        inertBeforeModal.forEach((inert, node) => { node.inert = inert; });
        inertBeforeModal.clear();
    }
};

const bindEscape = () => {
    if (escapeBound) return;
    escapeBound = true;
    const viewport = window.visualViewport;
    if (viewport) {
        const syncViewport = () => {
            document.documentElement.style.setProperty("--visual-viewport-height", `${viewport.height}px`);
            document.documentElement.style.setProperty("--visual-viewport-top", `${viewport.offsetTop}px`);
        };
        viewport.addEventListener("resize", syncViewport);
        viewport.addEventListener("scroll", syncViewport);
        syncViewport();
    }
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !openSheets.length) return;
        event.preventDefault?.();
        openSheets[openSheets.length - 1].close();
    });
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let sheetCount = 0;

export class Sheet {
    constructor({ name, title = "", wide = false, onOpen = null, onClose = null } = {}) {
        bindEscape();
        const id = `sheet-${name || ++sheetCount}`;
        this.name = name;
        this.onOpen = onOpen;
        this.onClose = onClose;
        this.isOpen = false;
        this.root = document.createElement("div");
        this.root.className = `sheet${wide ? " is-wide" : ""}`;
        this.root.dataset.sheet = name || id;
        this.root.setAttribute("aria-hidden", "true");
        this.root.inert = true;
        this.root.innerHTML = `
            <button class="sheet-backdrop" type="button" tabindex="-1" aria-label="关闭"></button>
            <section class="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="${id}-title" tabindex="-1">
                <div class="sheet-grabber" aria-hidden="true"></div>
                <header class="sheet-head">
                    <h2 class="sheet-title" id="${id}-title"></h2>
                    <button class="icon-btn sheet-close" type="button" aria-label="关闭">${icon("close")}</button>
                </header>
                <div class="sheet-body"></div>
            </section>`;
        this.panel = this.root.querySelector(".sheet-panel");
        this.titleNode = this.root.querySelector(".sheet-title");
        this.body = this.root.querySelector(".sheet-body");
        this.setTitle(title);
        this.root.querySelector(".sheet-backdrop").addEventListener("click", () => this.close());
        this.root.querySelector(".sheet-close").addEventListener("click", () => this.close());
        this.panel.addEventListener("keydown", (event) => this.trapFocus(event));
        document.body.appendChild(this.root);
    }

    setTitle(title) {
        this.titleNode.textContent = title;
    }

    open({ opener = document.activeElement, focus = true } = {}) {
        if (this.isOpen) return;
        this.isOpen = true;
        this.opener = opener;
        openSheets.push(this);
        lockPageScroll(this);
        syncModalBackground();
        this.root.inert = false;
        this.root.classList.add("is-open");
        this.root.setAttribute("aria-hidden", "false");
        this.onOpen?.(this);
        clearTimeout(this.focusTimer);
        if (focus) {
            this.focusTimer = setTimeout(() => {
                if (!this.isOpen) return;
                const target = this.panel.querySelector("[data-autofocus]")
                    || this.body.querySelector?.(FOCUSABLE)
                    || this.panel;
                target?.focus?.({ preventScroll: true });
            }, 80);
        }
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        clearTimeout(this.focusTimer);
        const index = openSheets.indexOf(this);
        if (index >= 0) openSheets.splice(index, 1);
        syncModalBackground();
        if (this.opener?.isConnected) this.opener.focus?.({ preventScroll: true });
        this.root.classList.remove("is-open");
        this.root.setAttribute("aria-hidden", "true");
        this.root.inert = true;
        unlockPageScroll(this);
        this.onClose?.(this);
        this.opener = null;
    }

    toggle(options) {
        if (this.isOpen) this.close();
        else this.open(options);
    }

    trapFocus(event) {
        if (event.key !== "Tab") return;
        const items = [...this.panel.querySelectorAll(FOCUSABLE)].filter((item) => item.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }
}
