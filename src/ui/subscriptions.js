import { authorSubscriptions } from "../data/AuthorSubscriptions.js";
import { libraryStore } from "../data/LibraryStore.js";
import { escapeHtml, formatDateTime, searchUrl } from "./dom.js";
import { icon } from "./icons.js";
import { LEVEL_LABELS, preferenceMaps } from "./preferences.js";
import { showToast } from "./toast.js";

/** 一位订阅作者的状态说明：上次更新时间或最近一次失败原因。 */
export const subscriptionTimeText = (author) => {
    if (author.error) return `检查失败：${author.error}${author.checkedAt ? ` · ${formatDateTime(author.checkedAt)} 检查` : ""}`;
    return author.checkedAt ? `${formatDateTime(author.checkedAt)} 检查` : "等待首次检查";
};

export const checkResultMessage = ({ added = 0, failed = [], checked = 0 } = {}) => {
    const parts = [added ? `发现 ${added} 部新作` : checked ? "没有新作" : "未检查"];
    if (failed.length) parts.push(`${failed.length} 位失败：${failed.slice(0, 3).join("、")}${failed.length > 3 ? " 等" : ""}`);
    return parts.join("，");
};

const buttonLabel = (name) => authorSubscriptions.isSubscribed(name) ? "已订阅" : "订阅作者";

/** 订阅开关按钮；`compact` 时只显示名字，用在多位作者的选择列表里。 */
export const subscribeButtonHtml = (name, { compact = false, iconOnly = false, className = "btn btn-outline btn-sm" } = {}) => {
    const active = authorSubscriptions.isSubscribed(name);
    // 只有图标时（工具栏）靠 aria-label 和 title 说明，文字不显示。
    if (iconOnly) return `<button class="${className}" type="button" data-subscribe-author="${escapeHtml(name)}" aria-pressed="${active}" aria-label="${escapeHtml(`${buttonLabel(name)}：${name}`)}" title="${escapeHtml(`${buttonLabel(name)}：${name}`)}">${icon("subscribe")}</button>`;
    const text = compact ? escapeHtml(name) : buttonLabel(name);
    return `<button class="${className}" type="button" data-subscribe-author="${escapeHtml(name)}" aria-pressed="${active}"${compact ? "" : ` aria-label="${escapeHtml(`${buttonLabel(name)}：${name}`)}"`}>${icon("subscribe")}<span>${text}</span></button>`;
};

export function syncSubscribeButtons(root = document) {
    root.querySelectorAll("[data-subscribe-author]").forEach((button) => {
        const name = button.dataset.subscribeAuthor;
        const active = authorSubscriptions.isSubscribed(name);
        button.setAttribute("aria-pressed", String(active));
        if (button.hasAttribute("aria-label")) {
            button.setAttribute("aria-label", `${buttonLabel(name)}：${name}`);
            if (button.hasAttribute("title")) button.title = `${buttonLabel(name)}：${name}`;
            const text = button.querySelector("span");
            if (text) text.textContent = buttonLabel(name);
        }
    });
}

if (typeof document !== "undefined" && !window.__subscribeBound) {
    window.__subscribeBound = true;
    document.addEventListener("click", (event) => {
        const button = event.target.closest?.("[data-subscribe-author]");
        if (!button) return;
        event.preventDefault();
        const name = button.dataset.subscribeAuthor;
        try {
            const subscribed = authorSubscriptions.toggle(name);
            showToast(subscribed ? `已订阅 ${name}` : `已取消订阅 ${name}`);
        } catch (error) {
            showToast(error.message || "订阅保存失败", "warning");
        }
    });
    window.addEventListener("jm-subscriptions-change", () => syncSubscribeButtons());
}

const IMPORT_SOURCES = [["like", "导入喜欢的作者"], ["dislike", "导入不喜欢的作者"]];

/**
 * 设置页的订阅作者列表：与作者偏好同样的添加栏和标签，颜色按作者偏好区分；
 * 可以从喜欢或不喜欢的作者一键导入，只补齐缺少的，不删除也不覆盖。
 */
export class SubscriptionEditor {
    preferences = new Map();

    constructor(root) { this.root = root; }

    mount() {
        this.root.innerHTML = `<label class="group-row switch settings-switch-row subscription-fuzzy">
                <span class="group-row-copy"><strong>模糊匹配</strong><small>识别作者的其他写法（如“竜/龍”）和标题署名</small></span>
                <input type="checkbox" data-fuzzy aria-label="模糊匹配" />
            </label>
            <form class="preference-form" novalidate>
                <div class="preference-add">
                    <input class="input" name="name" maxlength="80" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="输入作者名称" aria-label="作者名称" />
                    <div class="preference-actions"><button class="btn btn-primary" type="submit">订阅</button></div>
                </div>
                <div class="subscription-tools">
                    ${IMPORT_SOURCES.map(([level, label]) => `<button class="btn btn-ghost btn-sm" type="button" data-import="${level}" data-preference="${level}">${label}</button>`).join("")}
                    <button class="btn btn-ghost btn-sm" type="button" data-check-all>检查更新</button>
                </div>
                <p class="status-line" data-subscription-status role="status"></p>
            </form>
            <div class="preference-groups subscription-groups"></div>
            <section class="subscription-aliases" aria-labelledby="subscription-aliases-title">
                <h3 class="preference-group-title" id="subscription-aliases-title">别名<span class="num" data-alias-count>0</span></h3>
                <p class="subscription-alias-note" data-alias-note></p>
                <div class="chip-row" data-alias-list></div>
                <form class="subscription-alias-form" novalidate>
                    <select class="select" name="author" aria-label="别名所属作者"></select>
                    <input class="input" name="alias" maxlength="80" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="输入别名" aria-label="别名" />
                    <button class="btn btn-outline btn-sm" type="submit">添加别名</button>
                </form>
            </section>`;
        const fuzzy = this.root.querySelector("[data-fuzzy]");
        fuzzy.addEventListener("change", () => {
            try {
                authorSubscriptions.setFuzzy(fuzzy.checked);
                this.status(fuzzy.checked ? "已开启模糊匹配" : "已关闭模糊匹配");
            } catch (error) { this.status(error.message); }
        });
        this.aliasForm = this.root.querySelector(".subscription-alias-form");
        this.aliasForm.addEventListener("submit", (event) => { event.preventDefault(); this.addAlias(); });
        this.form = this.root.querySelector("form");
        this.form.addEventListener("submit", (event) => { event.preventDefault(); this.add(); });
        this.root.addEventListener("click", (event) => {
            const removeAlias = event.target.closest("[data-remove-alias]");
            if (removeAlias) this.removeAlias(removeAlias.dataset.author, removeAlias.dataset.removeAlias);
            const remove = event.target.closest("[data-unsubscribe]");
            const importButton = event.target.closest("[data-import]");
            if (remove) this.remove(remove.dataset.unsubscribe);
            if (importButton) this.importFrom(importButton.dataset.import);
            if (event.target.closest("[data-check-all]")) this.checkAll();
        });
        window.addEventListener("jm-subscriptions-change", () => this.render());
        // 作者偏好存在本地书架里，本页或其他标签页改动后都会发出 jm-library-change。
        const loadPreferences = () => {
            this.preferences = preferenceMaps(libraryStore.getPreferences()).authors;
            this.render();
        };
        window.addEventListener("jm-library-change", loadPreferences);
        loadPreferences();
        return this;
    }

    status(message) {
        this.statusToken = (this.statusToken || 0) + 1;
        this.form.querySelector("[data-subscription-status]").textContent = message;
        return this.statusToken;
    }

    /** 订阅后后台会记录已有作品：先提示“正在记录”，结束后换成结果；期间状态被别的操作改写就不再覆盖。 */
    async waitForBaseline(prefix) {
        const running = authorSubscriptions.running;
        if (!running) { this.status(prefix); return; }
        const token = this.status(`${prefix}，正在记录已有作品…`);
        let message;
        try {
            const { failed = [] } = await running;
            message = failed.length
                ? `${prefix}，${failed.length} 位记录失败，稍后自动重试`
                : `${prefix}，之后每天检查新作`;
        } catch (error) {
            message = `${prefix}，记录失败：${error?.message || "未知错误"}`;
        }
        if (token === this.statusToken) this.status(message);
    }

    /** 按作者偏好分组：喜欢、不喜欢、没有偏好，各用对应颜色。 */
    render() {
        const authors = authorSubscriptions.authors;
        const groups = [["like", LEVEL_LABELS.like], ["dislike", LEVEL_LABELS.dislike], ["", "无偏好"]];
        const progress = authorSubscriptions.progress;
        const button = this.form.querySelector("[data-check-all]");
        button.disabled = authorSubscriptions.isRunning || !authors.length;
        button.textContent = progress ? `检查中 ${progress.index}/${progress.total}` : "检查更新";
        this.root.querySelector(".subscription-groups").innerHTML = groups.map(([level, label]) => {
            const items = authors.filter((author) => (this.preferences.get(author.name) || "") === level);
            if (!items.length) return "";
            const stance = level ? ` data-preference="${level}"` : "";
            return `<section class="preference-group" aria-label="${label}的订阅作者">
                <h3 class="preference-group-title"${stance}>${label}<span class="num">${items.length}</span></h3>
                <div class="chip-row">${items.map((author) => `<span class="preference-chip"${stance} title="${escapeHtml(subscriptionTimeText(author))}"><a href="${searchUrl(author.name)}" data-navigation="same-tab">${escapeHtml(author.name)}${author.error ? ' <b class="subscription-error" aria-label="上次检查失败">!</b>' : ""}</a><button type="button" data-unsubscribe="${escapeHtml(author.name)}" aria-label="取消订阅 ${escapeHtml(author.name)}">×</button></span>`).join("")}</div>
            </section>`;
        }).join("");
        this.renderAliases(authors);
    }

    /** 别名单独成组，写成“别名 → 作者”；关闭模糊匹配时灰显。 */
    renderAliases(authors) {
        const fuzzy = authorSubscriptions.fuzzy;
        this.root.querySelector("[data-fuzzy]").checked = fuzzy;
        const section = this.root.querySelector(".subscription-aliases");
        section.hidden = !authors.length;
        section.classList.toggle("is-disabled", !fuzzy);
        const entries = authors.flatMap((author) => authorSubscriptions.aliasesOf(author).map((alias) => ({ author: author.name, ...alias })));
        this.root.querySelector("[data-alias-count]").textContent = entries.length;
        this.root.querySelector("[data-alias-note]").textContent = fuzzy
            ? "自动识别；删除后不再识别"
            : "模糊匹配已关闭，别名暂不使用";
        this.root.querySelector("[data-alias-list]").innerHTML = entries.length
            ? entries.map(({ author, name, source }) => `<span class="preference-chip subscription-alias"><span class="subscription-alias-name">${escapeHtml(name)} <span aria-hidden="true">→</span><span class="visually-hidden">是</span> ${escapeHtml(author)}${source === "manual" ? ' <small>手动</small>' : ""}</span><button type="button" data-remove-alias="${escapeHtml(name)}" data-author="${escapeHtml(author)}" aria-label="删除别名 ${escapeHtml(name)}">×</button></span>`).join("")
            : '<span class="subscription-alias-empty">暂无别名</span>';
        const select = this.aliasForm.elements.author;
        const selected = select.value;
        select.innerHTML = authors.map((author) => `<option value="${escapeHtml(author.name)}">${escapeHtml(author.name)}</option>`).join("");
        if (authors.some((author) => author.name === selected)) select.value = selected;
    }

    addAlias() {
        const author = this.aliasForm.elements.author.value;
        const alias = this.aliasForm.elements.alias.value.trim();
        try {
            const result = authorSubscriptions.addAlias(author, alias);
            this.status(result === "added" ? `已为 ${author} 添加别名 ${alias}` : result === "same" ? "别名和订阅名相同" : `${alias} 已是 ${author} 的别名`);
            if (result === "added") this.aliasForm.elements.alias.value = "";
        } catch (error) {
            this.status(error.message);
        }
    }

    removeAlias(author, alias) {
        try {
            authorSubscriptions.removeAlias(author, alias);
            this.status(`已删除别名 ${alias}`);
        } catch (error) {
            this.status(error.message);
        }
    }

    add() {
        const name = this.form.elements.name.value.trim();
        if (!name) { this.status("请输入作者名称"); return; }
        try {
            const added = authorSubscriptions.subscribe(name);
            if (added.length) this.waitForBaseline(`已订阅 ${name}`);
            else this.status(`${name} 已订阅`);
            this.form.elements.name.value = "";
        } catch (error) {
            this.status(error.message);
        }
    }

    remove(name) {
        try {
            authorSubscriptions.unsubscribe(name);
            this.status(`已取消订阅 ${name}`);
        } catch (error) {
            this.status(error.message);
        }
    }

    importFrom(level) {
        const names = [...this.preferences].filter(([, value]) => value === level).map(([name]) => name);
        if (!names.length) { this.status(`作者偏好里没有${LEVEL_LABELS[level]}的作者`); return; }
        try {
            const added = authorSubscriptions.subscribe(names);
            const kept = names.length - added.length;
            if (added.length) this.waitForBaseline(`已导入 ${added.length} 位${kept ? `，${kept} 位已订阅` : ""}`);
            else this.status(`这 ${names.length} 位都已订阅`);
        } catch (error) {
            this.status(error.message);
        }
    }

    async checkAll() {
        this.status("检查中…");
        try {
            this.status(checkResultMessage(await authorSubscriptions.checkAll()));
        } catch (error) {
            this.status(error.message || "检查失败");
        }
    }
}

