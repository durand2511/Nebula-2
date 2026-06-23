/**
 * URL classification for the preview iframe navigation system.
 * This module contains the pure logic (no DOM) so it can be unit-tested.
 */

export type NavDecision =
  | { kind: "same-site"; pathname: string } // postMessage to parent, route within preview
  | { kind: "external" }                    // blocked, toast shown
  | { kind: "ignored" };                    // hash link, mailto, tel, etc. — pass through

/** Normalize a hostname by stripping leading www. and lowercasing. */
export function normHost(h: string): string {
  return (h || "").replace(/^www\./, "").toLowerCase();
}

/**
 * Given a raw href attribute value, decide whether the link handler should
 * intercept it at all (true) or let it pass through (false).
 * Passed-through: empty, hash-only, mailto/tel/sms/javascript: schemes.
 */
export function shouldInterceptLink(raw: string): boolean {
  if (!raw) return false;
  if (raw.charAt(0) === "#") return false;
  if (/^(mailto:|tel:|sms:|javascript:)/i.test(raw)) return false;
  return true;
}

/**
 * Classify a navigation target for an IMPORTED site preview.
 *
 * @param href    The resolved absolute href (a.href, or URL passed to window.open etc.)
 * @param host    The primary host of the imported site (e.g. "example.com")
 * @param base    The current page URL (used to resolve relative hrefs)
 */
export function classifyNavigation(
  href: string,
  host: string,
  base = "https://null/"
): NavDecision {
  let u: URL;
  try {
    u = new URL(String(href || ""), base);
  } catch {
    return { kind: "ignored" };
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { kind: "ignored" };
  }

  if (host && normHost(u.hostname) === normHost(host)) {
    return { kind: "same-site", pathname: u.pathname + u.search + u.hash };
  }

  return { kind: "external" };
}
