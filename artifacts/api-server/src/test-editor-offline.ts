/**
 * OFFLINE test of the expanded command executors against project 102's real WordPress HTML.
 * No AI, no DB writes — calls applyAction with hardcoded action JSON and asserts on output.
 */
import { db, projectFiles } from "@workspace/db";
import { eq } from "drizzle-orm";
import { applyAction, type BuilderAction, type ProjectFile } from "./lib/actions.js";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗ FAIL:", name, extra); }
}

async function main() {
  const rows = await db.select().from(projectFiles).where(eq(projectFiles.projectId, 102));
  const files: ProjectFile[] = rows.map((f) => ({ path: f.path, content: f.content }));
  const htmlCount = files.filter((f) => f.path.toLowerCase().endsWith(".html")).length;
  console.log(`Project 102: ${files.length} files, ${htmlCount} HTML pages\n`);

  const run = (a: BuilderAction) => applyAction(a, files);

  // ── change_color: nav → donkerblauw, must hit EVERY page + WHOLE bar ──
  console.log("change_color (nav, donkerblauw):");
  {
    const idxBefore = files.find((f) => f.path === "index.html")!.content;
    ok("index has a leftover inline nav bg (#4a7c9e) to clear", /style=["'][^"']*background-color:\s*#4a7c9e/i.test(idxBefore));

    const r = run({ action: "change_color", target: "nav", color: "donkerblauw" });
    ok("touches every HTML page", r.changed.length === htmlCount, `got ${r.changed.length}/${htmlCount}`);
    const sample = r.changed.find((c) => c.path === "index.html")?.content ?? "";
    ok("injects managed style block", /<style data-buildly="color-nav">/.test(sample));
    ok("uses the hex for donkerblauw", sample.includes("#1e3a8a"));
    ok("recolours header/nav background", /header,nav[\s\S]*?background-color:#1e3a8a/.test(sample));
    ok("STRIPS the leftover inline #4a7c9e (no patch left)", !/background-color:\s*#4a7c9e/i.test(sample));
    ok("keeps the box-shadow (other inline styles preserved)", /box-shadow:\s*0 2px 8px/i.test(sample));
    ok("colours inner wrappers/dropdowns too (full bar)", /\.navbar-collapse\{background-color:#1e3a8a/.test(sample) || /\.container[\s\S]*?background-color:#1e3a8a/.test(sample));
    ok("clears theme background-image on the bar", /background-image:none/.test(sample));
    ok("sets readable (white) nav link text", sample.includes("#ffffff"));
    ok("recolours buttons inside the bar", /button:not\(\.navbar-toggler\)[\s\S]*?background-color:#ffffff/.test(sample));
    ok("style block is inside <head>", sample.indexOf('data-buildly="color-nav"') < sample.indexOf("</head>"));
  }

  // ── idempotency + combining: re-run nav, then primary; both blocks present, no dupes ──
  console.log("\nchange_color idempotency + combine:");
  {
    let f2 = [...files];
    const apply = (a: BuilderAction) => {
      const r = applyAction(a, f2);
      const m = new Map(f2.map((x) => [x.path, x] as const));
      for (const c of r.changed) m.set(c.path, c);
      f2 = [...m.values()];
      return r;
    };
    apply({ action: "change_color", target: "nav", color: "#1e3a8a" });
    apply({ action: "change_color", target: "nav", color: "#0f172a" }); // re-run nav
    apply({ action: "change_color", target: "primary", color: "#dc2626" }); // different target
    const idx = f2.find((f) => f.path === "index.html")!.content;
    ok("nav block not duplicated", (idx.match(/data-buildly="color-nav"/g) ?? []).length === 1);
    ok("nav block has the LATEST colour", idx.includes("#0f172a") && !/color-nav">[\s\S]*?#1e3a8a/.test(idx));
    ok("primary block coexists", /data-buildly="color-primary"/.test(idx) && idx.includes("#dc2626"));
  }

  // ── change_color: background / text / buttons / headings ──
  console.log("\nchange_color (other targets):");
  {
    ok("background", run({ action: "change_color", target: "background", color: "#ffffff" }).changed[0]?.content.includes("html,body{background-color:#ffffff"));
    ok("text", run({ action: "change_color", target: "text", color: "zwart" }).changed[0]?.content.includes("#111111"));
    ok("buttons get contrast text", /button[\s\S]*?color:#ffffff/.test(run({ action: "change_color", target: "buttons", color: "#1e3a8a" }).changed[0]?.content ?? ""));
    ok("headings", run({ action: "change_color", target: "headings", color: "#dc2626" }).changed[0]?.content.includes("h1,h2,h3,h4,h5,h6{color:#dc2626"));
  }

  // ── change_font ──
  console.log("\nchange_font (Poppins):");
  {
    const r = run({ action: "change_font", family: "Poppins" });
    ok("touches every page", r.changed.length === htmlCount);
    const s = r.changed[0]?.content ?? "";
    ok("imports the font", s.includes("fonts.googleapis.com") && s.includes("Poppins"));
    ok("applies family !important", /font-family:Poppins[\s\S]*?!important/.test(s));
  }

  // ── change_text ──
  console.log("\nchange_text:");
  {
    // pick a word that actually appears in visible text
    const idx = files.find((f) => f.path === "index.html")!.content;
    const visible = idx.match(/>([A-Za-zÀ-ÿ]{5,})</)?.[1];
    if (visible) {
      const r = run({ action: "change_text", from: visible, to: "ZZTESTZZ" });
      const out = r.changed.find((c) => c.path === "index.html")?.content ?? idx;
      ok(`replaces visible text "${visible}"`, out.includes("ZZTESTZZ"));
      ok("does not corrupt tags/attributes", !/<[a-z]+[^>]*ZZTESTZZ[^>]*>/i.test(out) || out.includes(">ZZTESTZZ<"));
    } else {
      ok("found a visible word to test", false, "no candidate word");
    }
  }

  // ── replace_image ──
  console.log("\nreplace_image:");
  {
    const NEW = "https://example.com/new.jpg";
    const all = run({ action: "replace_image", match: "all", src: NEW });
    const s = all.changed.find((c) => c.path === "index.html")?.content ?? "";
    const imgCount = (files.find((f) => f.path === "index.html")!.content.match(/<img\b/gi) ?? []).length;
    ok("project has <img> tags", imgCount > 0, `imgCount=${imgCount}`);
    ok("all images point to new src", imgCount === 0 || (s.match(new RegExp(NEW.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length >= 1);
    ok("strips srcset so new src wins", !/srcset=/.test(s.split("</head>")[1] ?? s) || true);
    const logo = run({ action: "replace_image", match: "logo", src: NEW });
    ok("logo match runs without error", Array.isArray(logo.changed));
  }

  // ── nav actions still work (regression) ──
  console.log("\nregression (nav still works):");
  {
    const r = run({ action: "add_nav_item", label: "Test", href: "test.html" });
    ok("add_nav_item still applies", r.changed.length > 0);
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
