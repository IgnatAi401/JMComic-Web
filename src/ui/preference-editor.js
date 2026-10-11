import { libraryStore } from "../data/LibraryStore.js";
import { escapeHtml } from "./dom.js";
import { LEVEL_LABELS, preferenceMaps } from "./preferences.js";

/**
 * Settings editor for one preference kind ("tag" or "author"). Entries are grouped
 * by level; picking an entry loads it into the form to rename or re-level it,
 * and × removes it. Every change is saved to this browser immediately.
 */
export class PreferenceEditor {
    constructor(root, { kind, levels, noun }) {
        this.root = root;
        this.kind = kind;
        this.levels = levels;
        this.noun = noun;
        this.entries = new Map();
        this.editing = "";
        this.level = levels[0];
    }

    mount(entries = new Map()) {
        const id = `${this.kind}-preference`;
        this.root.innerHTML = `<form class="preference-form" novalidate>
                <div class="preference-add">
                    <input class="input" name="name" maxlength="80" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="输入${this.noun}名称" aria-label="${this.noun}名称" />
                    <div class="segmented" role="group" aria-label="偏好">${this.levels.map((level) => `<button type="button" data-level="${level}" data-preference="${level}" aria-pressed="false">${LEVEL_LABELS[level]}</button>`).join("")}</div>
                    <div class="preference-actions"><button class="btn btn-primary" type="submit" data-preference-submit>添加</button><button class="btn btn-ghost" type="button" data-preference-cancel hidden>取消</button><button class="btn btn-ghost btn-danger" type="button" data-preference-delete hidden>删除</button></div>
                </div>
                <p class="status-line" data-preference-status role="status"></p>
            </form>
            <div class="preference-groups"></div>`;
        this.form = this.root.querySelector("form");
        this.form.addEventListener("submit", (event) => { event.preventDefault(); this.submit(); });
        this.form.querySelector("[data-preference-cancel]").onclick = () => this.edit("");
        this.form.querySelector("[data-preference-delete]").onclick = () => this.remove(this.editing);
        this.root.addEventListener("click", (event) => {
            const level = event.target.closest("[data-level]");
            const edit = event.target.closest("[data-edit]");
            const remove = event.target.closest("[data-remove]");
            if (level) { this.level = level.dataset.level; this.renderForm(); }
            if (edit) this.edit(edit.dataset.edit);
            if (remove) this.remove(remove.dataset.remove);
        });
        this.render(entries);
        this.renderForm();
        return this;
    }

    render(entries) {
        this.entries = entries;
        this.root.querySelector(".preference-groups").innerHTML = this.levels.map((level) => {
            const names = [...entries].filter(([, value]) => value === level).map(([name]) => name);
            return `<section class="preference-group" aria-label="${LEVEL_LABELS[level]}的${this.noun}">
                <h3 class="preference-group-title" data-preference="${level}">${LEVEL_LABELS[level]}<span class="num">${names.length}</span></h3>
                <div class="chip-row">${names.map((name) => `<span class="preference-chip" data-preference="${level}"><button type="button" data-edit="${escapeHtml(name)}" aria-pressed="${name === this.editing}" aria-label="编辑 ${escapeHtml(name)}">${escapeHtml(name)}</button><button type="button" data-remove="${escapeHtml(name)}" aria-label="删除 ${escapeHtml(name)}">×</button></span>`).join("") || '<span class="preference-empty">暂无</span>'}</div>
            </section>`;
        }).join("");
    }

    renderForm() {
        this.form.querySelectorAll("[data-level]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.level === this.level)));
        this.form.querySelector("[data-preference-submit]").textContent = this.editing ? "保存修改" : "添加";
        this.form.querySelector("[data-preference-cancel]").hidden = !this.editing;
        this.form.querySelector("[data-preference-delete]").hidden = !this.editing;
    }

    edit(name) {
        this.editing = this.entries.has(name) ? name : "";
        this.form.elements.name.value = this.editing;
        if (this.editing) this.level = this.entries.get(name);
        this.renderForm();
        this.render(this.entries);
        if (this.editing) this.form.elements.name.focus({ preventScroll: true });
    }

    status(message) { this.form.querySelector("[data-preference-status]").textContent = message; }

    async submit() {
        const name = this.form.elements.name.value.trim();
        if (!name) { this.status(`请输入${this.noun}名称`); return; }
        const previous = this.editing;
        if (await this.save({ kind: this.kind, name, level: this.level, previous }, `${name} · ${LEVEL_LABELS[this.level]}`)) this.edit("");
    }

    async remove(name) {
        if (!name) return;
        if (await this.save({ kind: this.kind, name, level: null }, `已删除 ${name}`) && name === this.editing) this.edit("");
    }

    async save(value, message) {
        if (this.busy) return false;
        this.busy = true;
        this.root.setAttribute("aria-busy", "true");
        try {
            const preferences = preferenceMaps(await libraryStore.savePreference(value));
            this.render(this.kind === "tag" ? preferences.tags : preferences.authors);
            this.status(message);
            return true;
        } catch (error) {
            this.status(`保存失败：${error.message}`);
            return false;
        } finally {
            this.busy = false;
            this.root.setAttribute("aria-busy", "false");
        }
    }
}
