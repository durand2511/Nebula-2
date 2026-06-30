/** Unit test for the brute-force login guard. */
import { loginBlocked, loginFailure, loginSuccess } from "./lib/login-guard.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => c ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗ FAIL:", n));

const k = ["test:user@example.nl"];
ok("start: niet geblokkeerd", loginBlocked(k) === 0);
for (let i = 0; i < 9; i++) loginFailure(k);
ok("na 9 mislukte pogingen: nog niet geblokkeerd", loginBlocked(k) === 0);
loginFailure(k); // 10e
ok("na 10 mislukte pogingen: geblokkeerd", loginBlocked(k) > 0);
ok("blokkade geeft seconden terug (~15 min)", loginBlocked(k) > 600 && loginBlocked(k) <= 900);
loginSuccess(k);
ok("succesvolle login wist de blokkade", loginBlocked(k) === 0);

// onafhankelijke keys blokkeren elkaar niet
const a = ["test:a@x.nl"], b = ["test:b@x.nl"];
for (let i = 0; i < 10; i++) loginFailure(a);
ok("blokkade van account a raakt account b niet", loginBlocked(a) > 0 && loginBlocked(b) === 0);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
