/**
 * Minimal service worker — its only job is to make Nebula installable as a PWA ("Zet op beginscherm").
 * Deliberately does NOT cache app responses: the editor + Claude terminal are live, server-driven, and a
 * stale cached shell would be worse than a network fetch. We take control immediately and pass every
 * request straight through to the network.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => { /* network passthrough — no caching */ });
