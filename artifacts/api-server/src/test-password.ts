/** Unit test for scrypt password hashing (PURE — no DB). */
import { hashPassword, verifyPassword, newSessionToken } from "./lib/password.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => c ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗ FAIL:", n));

const h = hashPassword("Geheim123");
ok("hash has scrypt$salt$hash shape", /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test(h));
ok("correct password verifies", verifyPassword("Geheim123", h) === true);
ok("wrong password rejected", verifyPassword("geheim123", h) === false);
ok("empty password rejected", verifyPassword("", h) === false);
ok("garbage stored value rejected (no throw)", verifyPassword("x", "not-a-hash") === false);
ok("two hashes of same pw differ (random salt)", hashPassword("a") !== hashPassword("a"));
ok("session token is 64 hex chars", /^[0-9a-f]{64}$/.test(newSessionToken()));
ok("two tokens differ", newSessionToken() !== newSessionToken());

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
