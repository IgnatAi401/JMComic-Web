import { Sheet } from "./overlay.js";
import { escapeHtml } from "./dom.js";

export function confirmAction({ title, message, label = "确认" }) {
    return new Promise((resolve) => {
        let confirmed = false;
        const sheet = new Sheet({ title, onClose: () => {
            resolve(confirmed);
            setTimeout(() => sheet.root.remove(), 400);
        } });
        sheet.body.innerHTML = `<p>${escapeHtml(message)}</p><div class="page-actions confirm-actions"><button class="btn btn-outline" type="button" data-cancel>取消</button><button class="btn btn-danger" type="button" data-confirm>${escapeHtml(label)}</button></div>`;
        sheet.body.querySelector("[data-cancel]").onclick = () => sheet.close();
        sheet.body.querySelector("[data-confirm]").onclick = () => { confirmed = true; sheet.close(); };
        sheet.open();
    });
}
