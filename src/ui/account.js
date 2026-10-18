import { authSession } from "../auth/AuthSession.js";
import { escapeHtml, setBusy } from "./dom.js";
import { icon } from "./icons.js";
import { showToast } from "./toast.js";

/**
 * JM account login form, rendered inside the shell's account sheet. The password is never
 * read back into the form; it is kept only when "remember password" is chosen.
 */
export class AccountPanel {
    constructor(container) {
        this.container = container;
    }

    mount() {
        this.container.innerHTML = `
            <section class="account-block" data-block="account">
                <div class="account-identity">
                    <span class="avatar" data-account-avatar>${icon("user")}</span>
                    <div><strong data-account-name>未登录</strong><small data-account-state>登录后可签到</small></div>
                </div>
                <form class="form auth-form" novalidate>
                    <label class="field"><span class="field-label">账号</span><input class="input" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required placeholder="用户名或邮箱" /></label>
                    <label class="field"><span class="field-label">密码</span><input class="input" name="password" type="password" autocomplete="current-password" required placeholder="输入密码" /></label>
                    <label class="switch"><input name="remember" type="checkbox" /><span class="switch-copy"><strong>记住密码</strong><small>登录过期后自动重新登录</small></span></label>
                    <p class="status-line is-error auth-error" role="alert"></p>
                    <div class="form-actions">
                        <button class="btn btn-primary auth-submit" type="submit">登录</button>
                        <button class="btn btn-ghost btn-danger logout-btn" type="button" hidden>退出登录</button>
                    </div>
                    <p class="field-hint">账号只保存在本浏览器，直接与 JM 服务器通信。记住密码时密码以明文保存，并会包含在导出的数据备份里，请只在自己的设备上开启。</p>
                </form>
            </section>`;
        this.form = this.container.querySelector(".auth-form");
        this.form.addEventListener("submit", (event) => this.handleLogin(event));
        this.form.querySelector(".logout-btn").addEventListener("click", () => this.logout());
        window.addEventListener("jm-auth-change", () => this.render());
        this.load();
        return this;
    }

    /** Reset the form from the saved account; call whenever the panel becomes visible. */
    load() {
        this.form.querySelector(".auth-error").textContent = "";
        this.form.elements.username.value = authSession.username;
        this.form.elements.password.value = "";
        this.form.elements.remember.checked = authSession.remembersPassword;
        this.render();
    }

    clearSecrets() {
        this.form.elements.password.value = "";
    }

    render() {
        const user = authSession.user;
        const name = authSession.username;
        const avatar = this.container.querySelector("[data-account-avatar]");
        avatar.classList.toggle("is-configured", Boolean(user));
        avatar.innerHTML = user && name ? escapeHtml(name.slice(0, 1).toUpperCase()) : icon("user");
        this.container.querySelector("[data-account-name]").textContent = user ? name : "未登录";
        this.container.querySelector("[data-account-state]").textContent = user
            ? `已登录 · ${user.levelName || "会员"}${authSession.remembersPassword ? " · 已记住密码" : ""}`
            : (name ? "登录已失效，请重新登录" : "登录后可签到");
        this.form.querySelector(".auth-submit").textContent = user ? "重新登录" : "登录";
        this.form.querySelector(".logout-btn").hidden = !user && !name;
    }

    async handleLogin(event) {
        event.preventDefault();
        const submit = this.form.querySelector(".auth-submit");
        const errorNode = this.form.querySelector(".auth-error");
        const { username, password, remember } = this.form.elements;
        errorNode.textContent = "";
        if (!username.value.trim() || !password.value) {
            errorNode.textContent = "请填写账号和密码";
            return;
        }
        setBusy(submit, true);
        try {
            await authSession.login(username.value, password.value, { remember: remember.checked });
            password.value = "";
            showToast("登录成功", "success");
        } catch (error) {
            errorNode.textContent = error.message || "登录失败，请稍后重试";
        } finally {
            setBusy(submit, false);
            this.render();
        }
    }

    logout() {
        authSession.logout();
        this.form.reset();
        this.render();
        showToast("已退出登录，本地账号信息已清除");
    }
}
