/**
 * Unit test for SMTP provider detection + password encryption (PURE — no DB, no network).
 * Run: esbuild-bundle this file and execute with node.
 */
import { detectProvider, encryptSecret, decryptSecret, transientConfig, UNSUPPORTED_DOMAIN_MSG } from "./lib/email-config.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, extra = "") => c ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗ FAIL:", n, extra));

ok("Gmail → smtp.gmail.com:587 (STARTTLS)", (() => { const p = detectProvider("studio@gmail.com"); return !!p && p.host === "smtp.gmail.com" && p.port === 587 && p.secure === false; })());
ok("Outlook → smtp-mail.outlook.com:587", (() => { const p = detectProvider("a@outlook.com"); return !!p && p.host === "smtp-mail.outlook.com" && p.port === 587; })());
ok("Hotmail uses the Outlook host", detectProvider("a@hotmail.com")?.host === "smtp-mail.outlook.com");
ok("Live uses the Outlook host", detectProvider("a@live.com")?.host === "smtp-mail.outlook.com");
ok("case-insensitive detection", detectProvider("A@GMAIL.COM")?.host === "smtp.gmail.com");
ok("unsupported domain → null", detectProvider("a@yahoo.com") === null && detectProvider("a@mycompany.nl") === null);
ok("unsupported message is the exact required string", UNSUPPORTED_DOMAIN_MSG === "Momenteel ondersteunt de app alleen Gmail, Outlook, Hotmail en Live e-mailaccounts.");

const secret = "s3cr3t-app-password 1234";
const enc = encryptSecret(secret);
ok("encrypted form is not plaintext", !enc.includes(secret) && enc.split(":").length === 3);
ok("decrypt round-trips", decryptSecret(enc) === secret);
ok("two encryptions differ (random IV)", encryptSecret(secret) !== encryptSecret(secret));
ok("tampered ciphertext fails to decrypt", (() => { try { const parts = enc.split(":"); decryptSecret(parts[0] + ":" + parts[1] + ":" + Buffer.from("xxxx").toString("base64")); return false; } catch { return true; } })());

ok("transientConfig builds a usable config for supported domains", (() => { const c = transientConfig("s@gmail.com", "pw"); return !!c && c.host === "smtp.gmail.com" && c.user === "s@gmail.com" && c.from === "s@gmail.com" && c.pass === "pw"; })());
ok("transientConfig refuses unsupported domains / empty pass", transientConfig("a@yahoo.com", "pw") === null && transientConfig("s@gmail.com", "") === null);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
