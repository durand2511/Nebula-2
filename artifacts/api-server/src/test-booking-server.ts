/**
 * Integration test for the booking app's SERVER MODE (step 3b). Runs the generated inline <script>
 * in a minimal DOM shim with a mocked fetch returning a canned /studio/state, then asserts the app
 * hydrates from the server and the agenda renders the server-provided lesson + free-spots count.
 */
import { buildBookingAppPage } from "./lib/booking-app.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, extra = "") => c ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗ FAIL:", n, extra));

// today as yyyy-mm-dd (so the lesson falls in the currently displayed week)
const d = new Date();
const today = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

const page = buildBookingAppPage({ title: "Saha", accounts: [{ role: "admin", name: "Eva", email: "eva@saha.nl", password: "Geheim1" }] });
const script = (page.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || "";

// ── minimal DOM/localStorage/fetch shim ──
const mkEl = () => ({ _html: "", style: {} as Record<string, string>, __init: undefined as unknown, children: [] as unknown[],
  set innerHTML(v: string) { this._html = v; }, get innerHTML() { return this._html; },
  appendChild(c: unknown) { this.children.push(c); return c; }, addEventListener() {}, removeChild() {},
  querySelector() { return null; }, querySelectorAll() { return []; } });
const loginEl = mkEl(), appEl = mkEl(), hostEl = mkEl(), root = mkEl();
(root as Record<string, unknown>).querySelector = (sel: string) => {
  if (sel.indexOf('data-screen="login"') >= 0) return loginEl;
  if (sel.indexOf('data-screen="app"') >= 0) return appEl;
  if (sel === ".ba-host") return hostEl;
  return null;
};
const store: Record<string, string> = {};
const localStorage = { getItem: (k: string) => (k in store ? store[k] : null), setItem: (k: string, v: string) => { store[k] = String(v); }, removeItem: (k: string) => { delete store[k]; } };
const documentShim = { getElementById: (id: string) => (id === "booking-app" ? root : null) };
const location = { pathname: "/api/projects/999/preview-page", search: "", href: "http://localhost/api/projects/999/preview-page", hostname: "localhost" };

const STATE = {
  user: { id: 1, role: "admin", name: "Eva", email: "eva@saha.nl", phone: "" },
  classes: [{ id: 7, title: "Vinyasa Flow", teacherEmail: "eva@saha.nl", teacher: "Eva", date: today, time: "09:00", cap: 5, price: 15, mode: "fysiek", onlineLink: "", onlineInfo: "", bookDays: 0, cancelHours: 0 }],
  members: [], counts: { ["7|" + today]: { booked: 2, waitlist: 0 } },
  wallet: { credits: 3, membership: null, unlimited: false, monthlyLimit: null, monthlyRemaining: null, validUntil: null, needsPayment: false },
  myBookings: [], bookings: [], users: [{ id: 1, role: "admin", name: "Eva", email: "eva@saha.nl", phone: "" }], purchases: [],
};
let seededAccounts = -1;
const fetchShim = (url: string, opts?: { method?: string; body?: string }) => {
  const res = (status: number, data: unknown) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(data) });
  if (url.indexOf("/studio/seed-staff") >= 0) { try { seededAccounts = JSON.parse(opts?.body || "{}").accounts.length; } catch { /* */ } return res(200, { ok: true, created: 0 }); }
  if (url.indexOf("/studio/state") >= 0) return res(200, STATE);
  return res(200, {});
};

async function main() {
  ok("extracted the inline script", script.length > 1000);
  let ran = false, err = "";
  try {
    const fn = new Function("document", "localStorage", "location", "fetch", "alert", "confirm", "navigator", "setTimeout", "window",
      script + "\n//# sourceURL=bookingapp.js");
    fn(documentShim, localStorage, location, fetchShim, () => {}, () => true, {}, setTimeout, globalThis);
    ran = true;
  } catch (e) { err = (e as Error).message; }
  ok("script runs in the shim without throwing", ran, err);

  // let the async boot chain (seed-staff → state → render) settle
  await new Promise((r) => setTimeout(r, 80));

  ok("boot seeded the baked staff account", seededAccounts === 1, "seeded=" + seededAccounts);
  ok("token-less boot still hydrated (admin session from /state)", appEl.style.display === "" );
  const html = hostEl.innerHTML || appEl.innerHTML || "";
  ok("agenda rendered the server lesson title", html.indexOf("Vinyasa Flow") >= 0);
  ok("free-spots reflect server counts (cap 5 - 2 booked = 3 vrij)", html.indexOf("3 vrij") >= 0);
  ok("server wallet credits shown (3 credits)", html.indexOf("3 credits") >= 0);

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
}
main();
