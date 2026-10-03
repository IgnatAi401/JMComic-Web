const GOOGLE_TRANSLATE_ENDPOINT = "https://clients5.google.com/translate_a/t";
const titleCache = new Map();

/** Translate a short title with Google Translate's keyless web endpoint. */
export async function translateTitleToSimplifiedChinese(value) {
    const title = String(value ?? "").trim();
    if (!title) throw new Error("没有可翻译的标题");
    if (titleCache.has(title)) return titleCache.get(title);

    const query = new URLSearchParams({
        client: "dict-chrome-ex",
        sl: "auto",
        tl: "zh-CN",
        q: title,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    try {
        const response = await fetch(`${GOOGLE_TRANSLATE_ENDPOINT}?${query}`, {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`谷歌翻译服务返回 HTTP ${response.status}`);

        const payload = await response.json();
        const result = payload?.[0];
        const translatedTitle = (typeof result?.[0] === "string"
            ? result[0]
            : (Array.isArray(result) ? result : [])
                .map((segment) => Array.isArray(segment) ? segment[0] : "")
                .filter((segment) => typeof segment === "string")
                .join(""))
            .trim();
        if (!translatedTitle) throw new Error("谷歌翻译未返回有效结果");

        titleCache.set(title, translatedTitle);
        return translatedTitle;
    } catch (error) {
        if (error?.name === "AbortError") throw new Error("谷歌翻译请求超时，请稍后重试");
        if (String(error?.message || "").startsWith("谷歌翻译")) throw error;
        throw new Error("无法连接谷歌翻译服务，请稍后重试");
    } finally {
        clearTimeout(timer);
    }
}
