import { jmApi } from "../api/JmcomicApi.js";
import { readLocalStorage, removeLocalStorage, writeLocalStorage } from "../utils/BrowserStorage.js";

/*
 * The JM account lives only in this browser:
 * - ACCOUNT_KEY: the username, plus the password when the user chose to remember it
 *   (plain text, included in data backups) so an expired session can log in again.
 * - SESSION_KEY: the JM session and public profile; left out of data backups.
 */
const ACCOUNT_KEY = "jm_account";
export const SESSION_KEY = "jm_account_session";

const readJson = (key) => {
    try {
        const value = JSON.parse(readLocalStorage(key, "null"));
        return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
};

const normalizeProfile = (profile, fallbackUsername = "") => ({
    uid: String(profile.uid),
    username: String(profile.username || fallbackUsername),
    levelName: String(profile.level_name || profile.levelName || "会员"),
});

class AuthSession {
    loginPromise = null;

    constructor() {
        // Keep every open tab in step with logins and logouts elsewhere.
        window.addEventListener("storage", (event) => {
            if (event.key === ACCOUNT_KEY || event.key === SESSION_KEY || event.key === null) this.dispatchChange();
        });
    }

    get account() {
        const value = readJson(ACCOUNT_KEY);
        return {
            username: String(value?.username || ""),
            password: String(value?.password || ""),
        };
    }

    /** The logged-in session ({ uid, username, levelName, session }) or null. */
    get session() {
        const value = readJson(SESSION_KEY);
        return value?.uid && value?.session ? value : null;
    }

    get user() { return this.session; }
    get isLoggedIn() { return Boolean(this.session); }
    get username() { return this.session?.username || this.account.username; }
    get remembersPassword() { return Boolean(this.account.password); }

    async login(username, password, { remember = false } = {}) {
        const cleanUsername = String(username || "").trim();
        const cleanPassword = String(password || "");
        if (!cleanUsername || !cleanPassword) throw new Error("账号和密码不能为空");
        const profile = await jmApi.login(cleanUsername, cleanPassword);
        writeLocalStorage(ACCOUNT_KEY, JSON.stringify(remember
            ? { username: cleanUsername, password: cleanPassword }
            : { username: cleanUsername }));
        this.#saveSession(profile, cleanUsername);
        return this.session;
    }

    /** Log in again with the remembered password after JM rejected the session. */
    async relogin() {
        if (this.loginPromise) return this.loginPromise;
        this.loginPromise = (async () => {
            const { username, password } = this.account;
            if (!username || !password) {
                this.#clearSession();
                throw Object.assign(new Error("登录已失效（可能已过期或在其他地方登录），请重新登录；开启“记住密码”后可自动重新登录"), { needsLogin: true });
            }
            try {
                this.#saveSession(await jmApi.login(username, password), username);
            } catch (error) {
                this.#clearSession();
                throw error;
            }
            return this.session;
        })().finally(() => {
            this.loginPromise = null;
        });
        return this.loginPromise;
    }

    /** Forget the session; `forgetAccount` also removes the saved username and password. */
    logout({ forgetAccount = true } = {}) {
        removeLocalStorage(SESSION_KEY);
        if (forgetAccount) removeLocalStorage(ACCOUNT_KEY);
        this.dispatchChange();
    }

    async checkIn() {
        const session = this.session;
        if (!session) throw new Error("请先登录账号");
        return jmApi.dailyCheckIn(session, { relogin: () => this.relogin() });
    }

    #saveSession(profile, fallbackUsername) {
        writeLocalStorage(SESSION_KEY, JSON.stringify({
            ...normalizeProfile(profile, fallbackUsername),
            session: String(profile.s),
            savedAt: Date.now(),
        }));
        this.dispatchChange();
    }

    #clearSession() {
        removeLocalStorage(SESSION_KEY);
        this.dispatchChange();
    }

    dispatchChange() {
        window.dispatchEvent(new CustomEvent("jm-auth-change", { detail: { user: this.session } }));
    }
}

export const authSession = new AuthSession();
