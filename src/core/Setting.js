import { readLocalStorage, writeLocalStorage } from "../utils/BrowserStorage.js";
import { installNavigationPolicy } from "../utils/NavigationPolicy.js";

const normalizeBatchSize = (value) => {
    const number = Number(value);
    if (![1, 2, 5, 10, 20, 50, 100].includes(number)) return null;
    return number;
};

class Setting {
    #settingValues = {
        using_imgserver_index: ["0", "1", "2", "3", "4", "5"],
    };

    #options = {
        using_imgserver_index: "0",
        image_load_batch_size: 5,
    };

    init() {
        installNavigationPolicy();
        this.#loadBrowserOptions();
        this.#options.image_load_batch_size = normalizeBatchSize(readLocalStorage("jm_reader_concurrency")) || 5;
        return Promise.resolve(this.#options);
    }

    #loadBrowserOptions() {
        for (const key of Object.keys(this.#settingValues)) {
            const value = readLocalStorage(key);
            if (value === null) continue;
            if (this.#settingValues[key].includes(value)) {
                this.#options[key] = value;
            } else {
                writeLocalStorage(key, this.#options[key]);
            }
        }
    }

    setOption(key, value) {
        const values = this.#settingValues[key];
        const normalized = typeof value === "number" ? value.toString() : value;
        if (values?.includes(normalized)) {
            this.#options[key] = normalized;
            writeLocalStorage(key, normalized);
            window.dispatchEvent(new CustomEvent("jm-image-server-change"));
        }
    }

    async setImageLoadBatchSize(value) {
        const batchSize = normalizeBatchSize(value);
        if (batchSize == null) throw new Error("并发加载数量必须是 1、2、5、10、20、50 或 100");
        writeLocalStorage("jm_reader_concurrency", String(batchSize));
        this.#options.image_load_batch_size = batchSize;
        this.#dispatchChange();
        return this.#options.image_load_batch_size;
    }

    #dispatchChange() {
        window.dispatchEvent(new CustomEvent("jm-settings-change", {
            detail: { imageLoadBatchSize: this.#options.image_load_batch_size },
        }));
    }

    get using_imgserver_index() {
        return this.#options.using_imgserver_index;
    }

    get image_load_batch_size() {
        return this.#options.image_load_batch_size;
    }
}

export const setting = new Setting();
