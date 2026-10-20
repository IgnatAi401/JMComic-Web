import { readLocalStorage, removeLocalStorage, writeLocalStorage } from "../utils/BrowserStorage.js";

const ENABLED_KEY = "jm_auto_checkin";
const DONE_KEY = "jm_auto_checkin_done";
export const ATTEMPT_KEY = "jm_auto_checkin_attempt";
/* Skip auto check-in when another tab/page tried recently, so failures are not retried on every navigation. */
const RETRY_INTERVAL_MS = 10 * 60 * 1000;
const FAILURE_KEY = "jm_auto_checkin_failure";
/* Failed auto check-ins back off (10 min, 30 min, 90 min); a refusal (403/429) waits at least an hour.
   Repeated tries are what get JM to refuse, so auto check-in gives up for the day after a few failures. */
const MAX_AUTO_FAILURES = 4;
const REFUSED_DELAY_MS = 60 * 60 * 1000;
const MAX_DELAY_MS = 6 * 60 * 60 * 1000;

/* JM 的签到日按 UTC+8 切换，与设备时区无关。 */
const checkInDay = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

const readJson = (key) => {
    try {
        return JSON.parse(readLocalStorage(key, "null")) || null;
    } catch {
        return null;
    }
};

/** Today's failure record for this account, or null. */
const readFailure = (uid) => {
    const failure = readJson(FAILURE_KEY);
    return failure?.day === checkInDay() && failure?.uid === String(uid) ? failure : null;
};

export const autoCheckIn = {
    get enabled() {
        return readLocalStorage(ENABLED_KEY) !== "0";
    },

    setEnabled(enabled) {
        writeLocalStorage(ENABLED_KEY, enabled ? "1" : "0");
    },

    /** Whether today's check-in is already confirmed for this account. */
    isDone(uid) {
        const done = readJson(DONE_KEY);
        return Boolean(uid) && done?.day === checkInDay() && done?.uid === String(uid);
    },

    /** Whether the page should try an automatic check-in for this account now. */
    shouldRun(uid) {
        if (!this.enabled || !uid || this.isDone(uid)) return false;
        const failure = readFailure(uid);
        if (failure && (failure.count >= MAX_AUTO_FAILURES || Date.now() < Number(failure.retryAt || 0))) return false;
        const lastAttempt = Number(readLocalStorage(ATTEMPT_KEY, "0")) || 0;
        return Math.abs(Date.now() - lastAttempt) >= RETRY_INTERVAL_MS;
    },

    markAttempt() {
        writeLocalStorage(ATTEMPT_KEY, String(Date.now()));
    },

    /** Record a failed check-in and return whether auto check-in will try again today. */
    markFailure(uid, { refused = false } = {}) {
        const count = (Number(readFailure(uid)?.count) || 0) + 1;
        const backoff = RETRY_INTERVAL_MS * 3 ** (count - 1);
        const delay = Math.min(MAX_DELAY_MS, refused ? Math.max(REFUSED_DELAY_MS, backoff) : backoff);
        writeLocalStorage(FAILURE_KEY, JSON.stringify({ day: checkInDay(), uid: String(uid), count, retryAt: Date.now() + delay }));
        return count < MAX_AUTO_FAILURES;
    },

    /** Record that today's check-in is confirmed (succeeded or already done). */
    markDone(uid) {
        writeLocalStorage(DONE_KEY, JSON.stringify({ day: checkInDay(), uid: String(uid) }));
        removeLocalStorage(FAILURE_KEY);
        window.dispatchEvent(new CustomEvent("jm-checkin-change"));
    },
};
