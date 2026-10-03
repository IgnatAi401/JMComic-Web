const read = (storageName, key, fallback = null) => {
    try {
        const value = window[storageName].getItem(key);
        return value === null ? fallback : value;
    } catch {
        return fallback;
    }
};

const write = (storageName, key, value) => {
    try {
        window[storageName].setItem(key, value);
        return true;
    } catch {
        return false;
    }
};

const remove = (storageName, key) => {
    try {
        window[storageName].removeItem(key);
        return true;
    } catch {
        return false;
    }
};

export const readLocalStorage = (key, fallback = null) => read("localStorage", key, fallback);
export const writeLocalStorage = (key, value) => write("localStorage", key, value);
export const removeLocalStorage = (key) => remove("localStorage", key);
export const readSessionStorage = (key, fallback = null) => read("sessionStorage", key, fallback);
export const writeSessionStorage = (key, value) => write("sessionStorage", key, value);
export const removeSessionStorage = (key) => remove("sessionStorage", key);
