export const DEFAULT_LISTING_FILTERS = Object.freeze({
    order: "mv",
    time: "a",
    category: "0",
    mainTag: "0",
    subcategorySlug: "",
    hideSerial: false,
});

const VALID_ORDERS = new Set(["mv", "mr", "tf", "mp"]);
const VALID_TIMES = new Set(["a", "t", "w", "m"]);

export const ORDER_LABELS = Object.freeze({
    mv: "观看量",
    mr: "发布时间",
    tf: "点赞量",
    mp: "图片数量",
});

export const TIME_LABELS = Object.freeze({
    a: "全部时间",
    t: "今天",
    w: "本周",
    m: "本月",
});

export function normalizeListingFilters(value = {}) {
    return {
        order: VALID_ORDERS.has(value.order) ? value.order : DEFAULT_LISTING_FILTERS.order,
        time: VALID_TIMES.has(value.time) ? value.time : DEFAULT_LISTING_FILTERS.time,
        category: String(value.category || "0"),
        mainTag: String(value.mainTag || "0"),
        subcategorySlug: String(value.subcategorySlug || ""),
        hideSerial: Boolean(value.hideSerial),
    };
}

export function reconcileListingFilters(value, changedFilter = "") {
    const filters = normalizeListingFilters(value);
    // JM's mobile listing API only supports period suffixes for view ranking.
    // Keep the period as the hard filter and never expose an ignored combination.
    if (changedFilter === "time" && filters.time !== "a") filters.order = "mv";
    if (changedFilter === "order" && filters.order !== "mv") filters.time = "a";
    if (filters.time !== "a" && filters.order !== "mv") filters.order = "mv";
    return filters;
}

export function listingApiOrder(value) {
    const filters = normalizeListingFilters(value);
    return filters.time === "a" ? filters.order : `mv_${filters.time}`;
}

export function listingCategoryPath(value) {
    const filters = normalizeListingFilters(value);
    return filters.subcategorySlug
        ? `${filters.category}_${filters.subcategorySlug}`
        : filters.category;
}

export function listingFilterSummary(value) {
    const filters = normalizeListingFilters(value);
    return `${TIME_LABELS[filters.time]} · ${ORDER_LABELS[filters.order]}`;
}
