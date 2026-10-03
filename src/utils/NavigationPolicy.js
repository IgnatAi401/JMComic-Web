const SAME_TAB_SCOPE = '[data-navigation-scope="same-tab"]';
const SAME_TAB_LINK = '[data-navigation="same-tab"]';

const isPageNavigation = (anchor) => {
    if (anchor.hasAttribute("download")) return false;
    const href = anchor.getAttribute("href")?.trim();
    if (!href || href === "#" || href.startsWith("#")) return false;
    if (/^(?:javascript|mailto|tel):/i.test(href)) return false;

    try {
        const destination = new URL(href, location.href);
        const current = new URL(location.href);
        const sameDocument = destination.origin === current.origin
            && destination.pathname === current.pathname
            && destination.search === current.search;
        return !(sameDocument && destination.hash);
    } catch {
        return false;
    }
};

const staysInCurrentPage = (anchor) => (
    anchor.matches(SAME_TAB_LINK)
    || Boolean(anchor.closest(SAME_TAB_SCOPE))
);

const configureLink = (anchor) => {
    if (!(anchor instanceof HTMLAnchorElement) || !isPageNavigation(anchor)) return;

    if (staysInCurrentPage(anchor)) {
        anchor.target = "_self";
        return;
    }

    anchor.target = "_blank";
    const rel = new Set((anchor.rel || "").split(/\s+/).filter(Boolean));
    rel.add("noopener");
    rel.add("noreferrer");
    anchor.rel = [...rel].join(" ");
};

const configureLinksWithin = (root) => {
    if (root instanceof HTMLAnchorElement) configureLink(root);
    root.querySelectorAll?.("a[href]").forEach(configureLink);
};

let installed = false;

export const installNavigationPolicy = () => {
    if (installed) return;
    installed = true;

    configureLinksWithin(document);
    document.addEventListener("click", (event) => {
        const anchor = event.target.closest?.("a[href]");
        if (!anchor) return;
        configureLink(anchor);
    }, true);

    new MutationObserver((records) => {
        records.forEach((record) => {
            if (record.type === "attributes") configureLink(record.target);
            else record.addedNodes.forEach((node) => {
                if (node instanceof Element) configureLinksWithin(node);
            });
        });
    }).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["href", "data-navigation", "data-navigation-scope"],
    });
};

export const openInNewPage = (url) => {
    window.open(String(url), "_blank", "noopener");
};
