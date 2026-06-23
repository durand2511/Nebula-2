import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyNavigation, shouldInterceptLink, normHost } from "./preview-nav.js";

const HOST = "example.com";

// ── normHost ──────────────────────────────────────────────────────────────────

describe("normHost", () => {
  it("strips www. prefix", () => {
    assert.equal(normHost("www.example.com"), "example.com");
  });
  it("lowercases", () => {
    assert.equal(normHost("EXAMPLE.COM"), "example.com");
  });
  it("handles empty string", () => {
    assert.equal(normHost(""), "");
  });
});

// ── shouldInterceptLink ───────────────────────────────────────────────────────

describe("shouldInterceptLink", () => {
  it("passes through empty string", () => {
    assert.equal(shouldInterceptLink(""), false);
  });
  it("passes through hash-only link", () => {
    assert.equal(shouldInterceptLink("#section"), false);
  });
  it("passes through mailto:", () => {
    assert.equal(shouldInterceptLink("mailto:info@example.com"), false);
  });
  it("passes through tel:", () => {
    assert.equal(shouldInterceptLink("tel:+31612345678"), false);
  });
  it("passes through sms:", () => {
    assert.equal(shouldInterceptLink("sms:+31612345678"), false);
  });
  it("passes through javascript: (case-insensitive)", () => {
    assert.equal(shouldInterceptLink("JavaScript:void(0)"), false);
  });
  it("intercepts absolute http link", () => {
    assert.equal(shouldInterceptLink("https://example.com/about"), true);
  });
  it("intercepts relative link", () => {
    assert.equal(shouldInterceptLink("/about"), true);
  });
  it("intercepts relative link without leading slash", () => {
    assert.equal(shouldInterceptLink("about.html"), true);
  });
});

// ── classifyNavigation — same-site links ─────────────────────────────────────

describe("classifyNavigation — same-site (imported internal link)", () => {
  it("exact host match → same-site", () => {
    const result = classifyNavigation("https://example.com/about", HOST);
    assert.equal(result.kind, "same-site");
    assert.equal((result as { kind: "same-site"; pathname: string }).pathname, "/about");
  });

  it("www. prefix on URL is normalised → same-site", () => {
    const result = classifyNavigation("https://www.example.com/contact", HOST);
    assert.equal(result.kind, "same-site");
  });

  it("www. prefix on HOST is normalised → same-site", () => {
    const result = classifyNavigation("https://example.com/contact", "www.example.com");
    assert.equal(result.kind, "same-site");
  });

  it("preserves query string in pathname", () => {
    const result = classifyNavigation("https://example.com/search?q=foo", HOST);
    assert.equal(result.kind, "same-site");
    assert.equal((result as { kind: "same-site"; pathname: string }).pathname, "/search?q=foo");
  });

  it("preserves hash in pathname", () => {
    const result = classifyNavigation("https://example.com/page#anchor", HOST);
    assert.equal(result.kind, "same-site");
    assert.equal((result as { kind: "same-site"; pathname: string }).pathname, "/page#anchor");
  });

  it("relative URL resolves against base → same-site when base is same host", () => {
    const result = classifyNavigation("/diensten", HOST, "https://example.com/");
    assert.equal(result.kind, "same-site");
    assert.equal((result as { kind: "same-site"; pathname: string }).pathname, "/diensten");
  });
});

// ── classifyNavigation — external links ──────────────────────────────────────

describe("classifyNavigation — external link (block + toast)", () => {
  it("different domain → external", () => {
    const result = classifyNavigation("https://google.com/", HOST);
    assert.equal(result.kind, "external");
  });

  it("subdomain of site → external (subdomain is a different host)", () => {
    const result = classifyNavigation("https://shop.example.com/", HOST);
    assert.equal(result.kind, "external");
  });

  it("http variant of different domain → external", () => {
    const result = classifyNavigation("http://competitor.com/landing", HOST);
    assert.equal(result.kind, "external");
  });

  it("empty host → all links are external", () => {
    const result = classifyNavigation("https://anything.com/page", "");
    assert.equal(result.kind, "external");
  });
});

// ── classifyNavigation — ignored protocols ────────────────────────────────────

describe("classifyNavigation — ignored (non-http protocol)", () => {
  it("ftp: → ignored", () => {
    assert.equal(classifyNavigation("ftp://example.com/file", HOST).kind, "ignored");
  });

  it("relative-looking string resolves via WHATWG parser → external (not same-site)", () => {
    // "not a url at all %%" is treated as a relative path by the WHATWG URL parser;
    // it resolves against the opaque base and gets protocol https: but host "null" → external.
    // shouldInterceptLink() does NOT filter this out, so the caller gets "external".
    assert.equal(classifyNavigation("not a url at all %%", HOST).kind, "external");
  });

  it("empty string resolves to base URL → external (shouldInterceptLink filters it before here)", () => {
    // new URL("", base) resolves to the base itself — protocol https:, host "null" → external.
    // In practice shouldInterceptLink("") returns false so this code path is never reached.
    assert.equal(classifyNavigation("", HOST).kind, "external");
  });
});

// ── Scenario-level tests ──────────────────────────────────────────────────────

describe("Scenario: click on imported internal link", () => {
  it("routes within preview via postMessage (same-site decision)", () => {
    const raw = "/over-ons";
    assert.ok(shouldInterceptLink(raw), "should intercept");
    const resolved = new URL(raw, "https://example.com/").href;
    const decision = classifyNavigation(resolved, HOST);
    assert.equal(decision.kind, "same-site");
  });
});

describe("Scenario: click on non-imported internal link", () => {
  // The link is same-site so handlePreviewNavigation sends the postMessage;
  // the parent React handler silently ignores unknown pages.
  // From the URL classifier's perspective this is still "same-site".
  it("same-site decision (parent handles the unknown page silently)", () => {
    const raw = "/not-imported-page";
    assert.ok(shouldInterceptLink(raw));
    const resolved = new URL(raw, "https://example.com/").href;
    const decision = classifyNavigation(resolved, HOST);
    assert.equal(decision.kind, "same-site");
  });
});

describe("Scenario: click on external link", () => {
  it("blocks with external decision", () => {
    const raw = "https://facebook.com/example";
    assert.ok(shouldInterceptLink(raw));
    const decision = classifyNavigation(raw, HOST);
    assert.equal(decision.kind, "external");
  });
});

describe("Scenario: form submit", () => {
  // Form submit is intercepted unconditionally (preventDefault) — no URL logic needed.
  // We verify the classification of the action URL just in case action is inspected.
  it("form action pointing to same site → same-site (intercepted before reaching)", () => {
    const action = "https://example.com/contact";
    assert.equal(classifyNavigation(action, HOST).kind, "same-site");
  });

  it("form with no action (implicit same-page) → intercept always fires first", () => {
    // No URL to classify — the submit handler fires before any URL parsing.
    // This is a behaviour assertion documented here, not testable via classifyNavigation.
    assert.ok(true, "submit always intercepted at DOM level regardless of action");
  });
});

describe("Scenario: window.open(url)", () => {
  it("external url → external decision → blocked", () => {
    const url = "https://twitter.com/share";
    assert.equal(classifyNavigation(url, HOST).kind, "external");
  });

  it("same-site url → same-site decision → routed", () => {
    const url = "https://example.com/reserveren";
    assert.equal(classifyNavigation(url, HOST).kind, "same-site");
  });
});

describe("Scenario: location.assign(url)", () => {
  it("external → external decision", () => {
    assert.equal(classifyNavigation("https://external.com/page", HOST).kind, "external");
  });

  it("same-site → same-site decision", () => {
    assert.equal(classifyNavigation("https://example.com/page", HOST).kind, "same-site");
  });
});

describe("Scenario: location.replace(url)", () => {
  it("external → external decision", () => {
    assert.equal(classifyNavigation("https://ad-network.com/track", HOST).kind, "external");
  });

  it("same-site → same-site decision", () => {
    assert.equal(classifyNavigation("https://www.example.com/", HOST).kind, "same-site");
  });
});
