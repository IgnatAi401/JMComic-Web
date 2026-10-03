import { crypto } from "../api/Crypto.js";

export class ImageCutter {
    constructor() {}
    cutImage(image, id, path) {
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        if (!width || !height) throw new Error("图片尺寸无效，无法还原");
        if (width > 16384) throw new Error("图片宽度超过 Safari 可安全处理的范围");

        const fragment = document.createDocumentFragment();
        const canvases = [];

        try {
            for (const slice of this.#slices(id, path, height)) {
                const canvas = document.createElement("canvas");
                canvases.push(canvas);
                canvas.width = width;
                canvas.height = slice.height;
                const context = canvas.getContext("2d", { alpha: false });
                if (!context) throw new Error("浏览器无法创建图片画布");
                context.drawImage(image, 0, slice.sourceY, width, slice.height, 0, 0, width, slice.height);
                fragment.append(canvas);
            }
            return fragment;
        } catch (error) {
            // Detached canvases still retain their backing stores in WebKit.
            // Include the current slice even if context creation or drawing failed.
            canvases.forEach((canvas) => {
                canvas.width = 0;
                canvas.height = 0;
            });
            throw error;
        }
    }

    /**
     * Restore a page into one downscaled canvas for thumbnails. Output taller than
     * `maxRatio` × width is cropped from the top so long strips stay small.
     */
    restoreThumbnail(image, id, path, { maxWidth = 480, maxRatio = 1.6, scrambled = true } = {}) {
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        if (!width || !height) throw new Error("图片尺寸无效，无法还原");
        const scale = Math.min(1, maxWidth / width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.min(Math.round(height * scale), Math.round(canvas.width * maxRatio)));
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) {
            canvas.width = 0;
            canvas.height = 0;
            throw new Error("浏览器无法创建图片画布");
        }
        const slices = scrambled ? this.#slices(id, path, height) : [{ sourceY: 0, height }];
        let outputY = 0;
        for (const slice of slices) {
            const top = Math.round(outputY * scale);
            if (top >= canvas.height) break;
            outputY += slice.height;
            const bottom = Math.round(outputY * scale);
            context.drawImage(image, 0, slice.sourceY, width, slice.height, 0, top, canvas.width, bottom - top);
        }
        return canvas;
    }

    /** Source rows in display order: the last strip first, then the rest bottom-up. */
    #slices(id, path, height) {
        const sliceCount = this.#getCuttingCount(id, path.substring(0,5));
        const sliceHeight = Math.floor(height / sliceCount);
        const remainingHeight = height % sliceCount;
        const slices = [{ sourceY: height - sliceHeight - remainingHeight, height: sliceHeight + remainingHeight }];
        for (let i = 0; i < sliceCount - 1; i++) {
            slices.push({ sourceY: sliceHeight * (sliceCount - i - 2), height: sliceHeight });
        }
        return slices;
    }

    #getCuttingCount(id, path) {
        if (id >= 220980 && id < 268850) {
            return 10;
        }
        const hashData = crypto.calculateMD5(id + path);
        let key = hashData.charCodeAt(hashData.length - 1);
        if (id >= 268850 && id <= 421925) {
            key = key % 10;
        } else {
            key = key % 8;
        }
        if (key >= 0 && key <= 9) {
            return key * 2 + 2;
        } else {
            return 10;
        }
    }
}
