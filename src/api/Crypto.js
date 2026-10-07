import CryptoJS from "../utils/crypto.js";

// JM may prefix JSON (and its encrypted payloads) with a UTF-8 BOM; accept it either way.
export const stripBom = (text) => String(text ?? "").replace(/^[\s\uFEFF]+/, "");
export const parseJsonText = (text) => JSON.parse(stripBom(text));

class Crypto {
    predefinedKeyTemplates = ["185Hcomic3PAPP7R", "18comicAPPContent"];
    constructor() {}
    calculateMD5(inputStr) {
        return CryptoJS.MD5(inputStr).toString();
    }
    decryptData(key, cipherText) {
        for (const template of this.predefinedKeyTemplates) {
            try {
                const dynamicKey = this.calculateMD5(key + template);
                const decryptedData = CryptoJS.AES.decrypt(
                    stripBom(cipherText).trim(),
                    CryptoJS.enc.Utf8.parse(dynamicKey),
                    { mode: CryptoJS.mode.ECB },
                );
                return parseJsonText(decryptedData.toString(CryptoJS.enc.Utf8));
            } catch (error) {
                continue;
            }
        }
        throw new Error("Decryption failed");
    }
    decryptCurrentApi(text) {
        text = stripBom(text).trim();
        const dynamicKey = this.calculateMD5("diosfjckwpqpdfjkvnqQjsik");
        const decryptedData = CryptoJS.AES.decrypt(
            text,
            CryptoJS.enc.Utf8.parse(dynamicKey),
            { mode: CryptoJS.mode.ECB },
        );
        return parseJsonText(decryptedData.toString(CryptoJS.enc.Utf8));
    }
}
export const crypto = new Crypto();
