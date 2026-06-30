import { useState, useRef, useEffect, useCallback, useMemo, Fragment } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetProject,
  getGetProjectQueryKey,
  useListMessages,
  getListMessagesQueryKey,
  useListFiles,
  getListFilesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Send,
  Loader2,
  FileCode,
  ChevronLeft,
  Code2,
  MonitorPlay,
  FolderOpen,
  File as FileIcon,
  RefreshCw,
  AlertTriangle,
  Wand2,
  X,
  Square,
  ImagePlus,
  Maximize2,
  Minimize2,
  Download,
  Check,
  FileText,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  RotateCcw,
  Sparkles,
  MousePointerClick,
  Rocket,
  Globe,
  Copy,
} from "lucide-react";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
// ScrollArea removed — using a plain div for scroll control
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeViewer } from "@/components/code-viewer";
import { formatFileContent } from "@/lib/format-code";
import { buildWordPressExport } from "@/lib/wxr-export";
import {
  fileToReferenceImage,
  MAX_ATTACHED_IMAGES,
  REFERENCE_IMAGE_PROMPT,
  type AttachedImage,
} from "@/lib/image";

type ProjectFile = { id: number; path: string; content: string; language: string };

// Prepares project files for publishing/export:
// - Inlines all data-include component references so the HTML works without a server
// - Leaves CSS, JS, and asset files untouched (they're referenced by relative path)
function processFilesForExport(files: ProjectFile[]): Map<string, string> {
  const out = new Map<string, string>();
  const isExternal = (u: string) => /^(https?:)?\/\//i.test(u) || u.startsWith("data:");

  for (const file of files) {
    if (!file.path.endsWith(".html")) {
      out.set(file.path, file.content ?? "");
      continue;
    }
    const pageDir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
    const resolve = (href: string): string => {
      const parts = [...(pageDir ? pageDir.split("/") : []), ...href.split("/")];
      const res: string[] = [];
      for (const p of parts) {
        if (p === "..") res.pop();
        else if (p !== "." && p !== "") res.push(p);
      }
      return res.join("/");
    };

    // Inline data-include components — required for the HTML to work without Nebula
    let html = (file.content ?? "").replace(
      /<(\w+)([^>]*?)\s+data-include=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/\1>/gi,
      (_m, tag: string, before: string, inc: string, after: string) => {
        if (isExternal(inc)) return _m;
        const resolved = resolve(inc);
        const comp = files.find(f => f.path === resolved);
        if (!comp) return _m;
        const body = comp.content?.match(/<body[^>]*>([\s\S]*?)<\/body>/is);
        const content = body ? body[1].trim() : (comp.content ?? "");
        return `<${tag}${before}${after}>\n${content}\n</${tag}>`;
      }
    );
    out.set(file.path, html);
  }
  return out;
}

interface FileTreeGroup {
  folder: string | null; // null = root level (no directory prefix)
  files: ProjectFile[];
}

function groupFilesByFolder(files: ProjectFile[]): FileTreeGroup[] {
  const map = new Map<string | null, ProjectFile[]>();
  for (const file of files) {
    const slashIdx = file.path.indexOf("/");
    const folder = slashIdx > 0 ? file.path.slice(0, slashIdx) : null;
    const group = map.get(folder) ?? [];
    group.push(file);
    map.set(folder, group);
  }
  const result: FileTreeGroup[] = [];
  const rootFiles = map.get(null);
  if (rootFiles?.length) {
    result.push({ folder: null, files: rootFiles.sort((a, b) => a.path.localeCompare(b.path)) });
  }
  const sortedFolders = [...map.keys()]
    .filter((f): f is string => f !== null)
    .sort();
  for (const folder of sortedFolders) {
    result.push({ folder, files: map.get(folder)!.sort((a, b) => a.path.localeCompare(b.path)) });
  }
  return result;
}

interface VirtualFolderGroup {
  name: string;
  label: string;
  emptyState: string;
  files: ProjectFile[];
}

function groupFilesVirtually(files: ProjectFile[]): VirtualFolderGroup[] {
  const pages: ProjectFile[] = [];
  const components: ProjectFile[] = [];
  const styles: ProjectFile[] = [];
  const scripts: ProjectFile[] = [];
  const assets: ProjectFile[] = [];

  for (const file of files) {
    const p = file.path;
    if (p.startsWith("components/")) {
      components.push(file);
    } else if (p.startsWith("styles/") || p.endsWith(".css")) {
      styles.push(file);
    } else if (p.startsWith("scripts/") || p.endsWith(".js")) {
      scripts.push(file);
    } else if (p.startsWith("assets/") || /\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|mp4|mp3)$/i.test(p)) {
      assets.push(file);
    } else {
      pages.push(file);
    }
  }

  const sort = (arr: ProjectFile[]) => [...arr].sort((a, b) => a.path.localeCompare(b.path));

  return [
    { name: "pages",      label: "pages",      emptyState: "Nog geen pagina's",           files: sort(pages) },
    { name: "components", label: "components",  emptyState: "Nog geen componenten",        files: sort(components) },
    { name: "styles",     label: "styles",      emptyState: "Nog geen lokale stylesheets", files: sort(styles) },
    { name: "scripts",    label: "scripts",     emptyState: "Nog geen lokale scripts",     files: sort(scripts) },
    { name: "assets",     label: "assets",      emptyState: "Nog geen lokale assets",      files: sort(assets) },
  ];
}

type DiffLine = { kind: "same" | "add" | "del"; line: string };

function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText ? oldText.split("\n") : [];
  const b = newText ? newText.split("\n") : [];
  if (a.length === 0) return b.map(line => ({ kind: "add" as const, line }));
  if (b.length === 0) return a.map(line => ({ kind: "del" as const, line }));
  // Fall back for huge files — LCS would be too slow
  if (a.length * b.length > 1_500_000) {
    return b.map(line => ({ kind: "add" as const, line }));
  }
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
  const result: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i-1] === b[j-1]) {
      result.unshift({ kind: "same", line: a[i-1] }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      result.unshift({ kind: "add", line: b[j-1] }); j--;
    } else {
      result.unshift({ kind: "del", line: a[i-1] }); i--;
    }
  }
  return result;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/^---+\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Strip FILE: ... ``` ... ``` blocks from AI text (safety net — server already cleans). */
function cleanContent(raw: string): string {
  const cleaned = raw
    .replace(/FILE:\s*[^\n]+\nLANGUAGE:\s*[^\n]+\n```[^\n]*\n[\s\S]*?```/g, "")
    .trim();
  return stripMarkdown(cleaned) || "Ja, het is af. Alstublieft.";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type StreamSegment =
  | { kind: "text"; content: string }
  | { kind: "file";  file: string; code: string; changes: string[]; active: boolean }
  | { kind: "patch"; file: string; op: string;   code: string;       active: boolean };

function extractFileChanges(file: string, code: string): string[] {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  const out: string[] = [];
  if (ext === "html" || ext === "htm") {
    for (const m of code.matchAll(/<section[^>]*\bid=["']([^"']+)["']/gi)) out.push(`section #${m[1]}`);
    for (const m of code.matchAll(/<div[^>]*\bid=["']([^"']+)["']/gi)) out.push(`div #${m[1]}`);
    const inputTypes = [...new Set([...code.matchAll(/<input[^>]*\btype=["']([^"']+)["']/gi)].map(m => m[1]))];
    if (inputTypes.length) out.push(`input[${inputTypes.join(", ")}]`);
    for (const m of code.matchAll(/<select[^>]*\bid=["']([^"']+)["']/gi)) out.push(`select #${m[1]}`);
    const btns = [...code.matchAll(/<button[^>]*>([^<]{1,30})<\/button>/gi)].slice(0, 3);
    for (const m of btns) out.push(`button "${m[1].trim()}"`);
  }
  if (ext === "js") {
    const fns = [...code.matchAll(/function\s+(\w+)\s*\(/g)].slice(0, 8);
    for (const m of fns) out.push(`${m[1]}()`);
    const arrows = [...code.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/g)].slice(0, 4);
    for (const m of arrows) if (!out.some(c => c.startsWith(m[1]))) out.push(`${m[1]}()`);
    const evts = [...new Set([...code.matchAll(/addEventListener\s*\(\s*['"](\w+)['"]/g)].map(m => m[1]))];
    for (const e of evts) out.push(`on${e}`);
    if (/localStorage/.test(code)) out.push("localStorage");
    if (/fetch\s*\(/.test(code)) out.push("fetch");
  }
  if (ext === "css") {
    const classes = [...new Set([...code.matchAll(/\.([a-z][a-z0-9_-]+)\s*\{/gi)].map(m => m[1]))].slice(0, 6);
    for (const c of classes) out.push(`.${c}`);
    const ids = [...new Set([...code.matchAll(/#([a-z][a-z0-9_-]+)\s*\{/gi)].map(m => m[1]))].slice(0, 3);
    for (const id of ids) out.push(`#${id}`);
    if (/@keyframes|animation\s*:/.test(code)) out.push("@keyframes");
    if (/@media/.test(code)) out.push("@media");
  }
  return out;
}

function parseStreamSegments(raw: string): StreamSegment[] {
  if (!raw) return [];
  const segments: StreamSegment[] = [];
  type RawBlock =
    | { kind: "file";  index: number; end: number; file: string; code: string }
    | { kind: "patch"; index: number; end: number; file: string; op: string; code: string };
  const blocks: RawBlock[] = [];
  const fileRe  = /^FILE:\s*([^\n]+)\n```[^\n]*\n([\s\S]*?)^```[ \t]*$/gm;
  const patchRe = /^PATCH:\s*([^\n]+)\n(?:OP:\s*([^\n]+)\n)?(?:ANCHOR:\s*([^\n]+)\n)?```[^\n]*\n([\s\S]*?)^```[ \t]*$/gm;
  let m: RegExpExecArray | null;
  fileRe.lastIndex = 0;
  while ((m = fileRe.exec(raw)) !== null)
    blocks.push({ kind: "file", index: m.index, end: m.index + m[0].length, file: m[1].trim(), code: m[2] ?? "" });
  patchRe.lastIndex = 0;
  while ((m = patchRe.exec(raw)) !== null)
    blocks.push({ kind: "patch", index: m.index, end: m.index + m[0].length, file: m[1].trim(), op: (m[2] ?? "").trim(), code: m[4] ?? "" });
  blocks.sort((a, b) => a.index - b.index);
  let cursor = 0;
  for (const block of blocks) {
    const textBefore = raw.slice(cursor, block.index).trim();
    if (textBefore) segments.push({ kind: "text", content: textBefore });
    if (block.kind === "file")
      segments.push({ kind: "file", file: block.file, code: block.code, changes: extractFileChanges(block.file, block.code), active: false });
    else
      segments.push({ kind: "patch", file: block.file, op: block.op, code: block.code, active: false });
    cursor = block.end;
  }
  const tail = raw.slice(cursor);
  const fileIdx  = tail.search(/^FILE:/m);
  const patchIdx = tail.search(/^PATCH:/m);
  const hasFile  = fileIdx !== -1;
  const hasPatch = patchIdx !== -1;
  if (hasFile && (!hasPatch || fileIdx <= patchIdx)) {
    const textBefore = tail.slice(0, fileIdx).trim();
    if (textBefore) segments.push({ kind: "text", content: textBefore });
    const inc = tail.match(/^FILE:\s*([^\n]+)\n```[^\n]*\n([\s\S]*)$/m);
    if (inc) {
      const file = inc[1].trim(); const code = inc[2] ?? "";
      segments.push({ kind: "file", file, code, changes: extractFileChanges(file, code), active: true });
    }
  } else if (hasPatch) {
    const textBefore = tail.slice(0, patchIdx).trim();
    if (textBefore) segments.push({ kind: "text", content: textBefore });
    const inc = tail.match(/^PATCH:\s*([^\n]+)\n(?:OP:\s*([^\n]+)\n)?(?:ANCHOR:\s*([^\n]+)\n)?```[^\n]*\n([\s\S]*)$/m);
    if (inc) {
      segments.push({ kind: "patch", file: inc[1].trim(), op: (inc[2] ?? "").trim(), code: inc[4] ?? "", active: true });
    } else {
      const ph = tail.match(/^PATCH:\s*([^\n]+)/m);
      const op = tail.match(/^OP:\s*([^\n]+)/m);
      if (ph) segments.push({ kind: "patch", file: ph[1].trim(), op: op ? op[1].trim() : "", code: "", active: true });
    }
  } else {
    const cleaned = tail
      .replace(/^(FILE|PATCH|OP|ANCHOR):[^\n]*/gm, "")
      .replace(/\n{3,}/g, "\n\n").trim();
    if (cleaned) segments.push({ kind: "text", content: cleaned });
  }
  return segments;
}

/** Combine separate files into one self-contained HTML doc so the iframe preview works. */
function buildPreviewHtml(
  files: ProjectFile[] | undefined,
  isImported: boolean,
  currentPage?: string | null,
): string {
  if (!files || files.length === 0) return "";
  const index =
    (currentPage ? files.find((f) => f.path === currentPage) : undefined) ??
    files.find((f) => f.path === "index.html") ??
    files.find((f) => f.path === "pages/index.html") ??
    files.find((f) => f.path.endsWith("index.html")) ??
    files.find((f) => f.path.endsWith(".html") && !f.path.startsWith("components/"));
  if (!index) return "";
  // Inject a snippet right after <head> (or prepend it if the doc has no head).
  const injectHead = (doc: string, snippet: string): string =>
    /<head[^>]*>/i.test(doc) ? doc.replace(/<head[^>]*>/i, (m) => m + snippet) : snippet + doc;

  // Turn one stored page (the shell OR a sibling page of an imported site) into a
  // preview-ready, self-contained HTML doc. Handles nested paths (pages/foo.html
  // referencing ../styles/main.css) and data-include component inlining.
  const processPage = (raw: string, pagePath: string): string => {
    let html = raw;

    // Compute the directory prefix of the current page for relative path resolution.
    // e.g. "pages/foo.html" → pageDir = "pages"
    //      "index.html"     → pageDir = ""
    const pageDir = pagePath.includes("/")
      ? pagePath.slice(0, pagePath.lastIndexOf("/"))
      : "";

    // Resolve a href/src value relative to the page's directory into a flat project path.
    // e.g. pageDir="pages", href="../styles/main.css" → "styles/main.css"
    const resolveProjectPath = (href: string): string => {
      const parts = [...(pageDir ? pageDir.split("/") : []), ...href.split("/")];
      const result: string[] = [];
      for (const p of parts) {
        if (p === "..") result.pop();
        else if (p !== "." && p !== "") result.push(p);
      }
      return result.join("/");
    };

    const isExternal = (url: string) => /^(https?:)?\/\//i.test(url) || url.startsWith("data:");

    // ── Step 1: HTML component includes ──────────────────────────────────────
    // Replace <element data-include="components/Foo.html"></element> with the
    // component's content. Components should be HTML fragments (no DOCTYPE/html/body).
    html = html.replace(
      /<(\w+)([^>]*?)\s+data-include=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/\1>/gi,
      (_match, tag: string, before: string, includePath: string, after: string) => {
        const resolved = isExternal(includePath) ? "" : resolveProjectPath(includePath);
        const component = resolved ? files.find((f) => f.path === resolved) : undefined;
        if (!component) return _match;
        const bodyMatch = component.content.match(/<body[^>]*>([\s\S]*?)<\/body>/is);
        const content = bodyMatch ? bodyMatch[1].trim() : component.content;
        return `<${tag}${before}${after}>\n${content}\n</${tag}>`;
      }
    );

    // ── Step 2: Inline project CSS ────────────────────────────────────────────
    // Replace <link rel="stylesheet" href="..."> with inline <style> when the href
    // resolves to a project file. Handles ./ ../ and nested paths.
    html = html.replace(/<link([^>]*)>/gi, (match, attrs: string) => {
      if (!/rel\s*=\s*["']?\s*stylesheet/i.test(attrs)) return match;
      const hrefM = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
      if (!hrefM) return match;
      const href = hrefM[1];
      if (isExternal(href)) return match;
      const resolved = resolveProjectPath(href);
      const cssFile = files.find((f) => f.path === resolved);
      if (!cssFile) return match;
      return `<style>\n${cssFile.content}\n</style>`;
    });

    // ── Step 3: Inline project JS ─────────────────────────────────────────────
    html = html.replace(/<script([^>]*)>\s*<\/script>/gi, (match, attrs: string) => {
      const srcM = attrs.match(/src\s*=\s*["']([^"']+)["']/i);
      if (!srcM) return match;
      const src = srcM[1];
      if (isExternal(src)) return match;
      const resolved = resolveProjectPath(src);
      const jsFile = files.find((f) => f.path === resolved);
      if (!jsFile) return match;
      // Preserve `type="module"` when present: a self-contained module (or one
      // that imports a library from a CDN over https) only works if the inlined
      // tag stays a module. Downgrading it to a classic script makes any
      // top-level `import` throw and kills all interactivity (dead buttons).
      const isModule = /\btype\s*=\s*["']?module\b/i.test(attrs);
      return `<script${isModule ? ' type="module"' : ""}>\n${jsFile.content}\n</script>`;
    });

    // Neutralize any leftover references to LOCAL siblings we couldn't inline
    // (e.g. a file the AI referenced but didn't generate). In srcDoc there is no
    // base URL, so these would 404 and silently break the app. External URLs
    // (http(s)://, //, data:) are left untouched.
    html = html.replace(
      /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi,
      (m, href: string) => (/rel=["']?stylesheet/i.test(m) && !isExternal(href) ? "" : m),
    );
    html = html.replace(
      /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
      (m, src: string) => (isExternal(src) ? m : ""),
    );

    // Imported static sites (e.g. WordPress / Elementor) ship lazy-loaded images:
    // the real URL lives in data-src / data-srcset while `src` holds a 1x1 placeholder,
    // and a `.lazyload` class keeps the image at opacity:0 until the site's own
    // lazy-loader JS swaps it in. That script usually doesn't run in our sandbox, so
    // the images never appear (blank heroes, missing logo, empty quote cards). Promote
    // the real URLs — only on elements that actually carry them — so images render
    // without the original JS. (No-op for generated apps, which don't use data-src.)
    const delazy = (tag: string) => {
      if (!/\bdata-src=/i.test(tag) && !/\bdata-srcset=/i.test(tag)) return tag;
      // Strip the existing placeholder src/srcset (quoted OR unquoted) BEFORE
      // promoting data-src/data-srcset, otherwise a duplicate attribute would
      // survive and the browser keeps the first (placeholder) one.
      return tag
        .replace(/\ssrc=(?:"[^"]*"|'[^']*'|[^\s>]+)/i, "")
        .replace(/\ssrcset=(?:"[^"]*"|'[^']*'|[^\s>]+)/i, "")
        .replace(/\bdata-srcset=/i, "srcset=")
        .replace(/\bdata-src=/i, "src=")
        .replace(/\sloading=(?:"lazy"|'lazy'|lazy)(?=[\s>])/gi, "");
    };
    html = html.replace(/<img\b[^>]*>/gi, delazy);
    html = html.replace(/<source\b[^>]*>/gi, delazy);
    html = html.replace(/<video\b[^>]*>/gi, delazy);

    // Imported sites' <noscript> fallbacks were turned into ESCAPED text by the parser
    // (cheerio parses a noscript body as a raw text node), so the raw markup prints as
    // visible text — a lazy-image fallback under each image, or a hidden tracking
    // <iframe> (e.g. Google Tag Manager). Scripts run in our preview, so these no-JS
    // fallbacks are redundant. Strip the escaped artifacts, scoped to known fallback
    // signatures so we never remove escaped code a generated app intentionally shows.
    // (New imports no longer produce these — the importer now drops <noscript> — but
    // already-imported projects still carry them.)
    // Escaped images: only the lazy-load fallback signature (avoids touching an escaped
    // instructional snippet). Escaped iframes: tracker host or hidden/zero-size styling —
    // an escaped iframe in body text is virtually always a no-JS tracking fallback.
    const stripImg = (m: string) => /lazyload/i.test(m);
    const stripIframe = (m: string) =>
      /googletagmanager|google-analytics|doubleclick|facebook\.com\/tr|hotjar|visibility\s*:\s*hidden|display\s*:\s*none|(?:width|height)=["']?0\b/i.test(
        m,
      );
    html = html.replace(/&lt;img\b[\s\S]*?&gt;/gi, (m) => (stripImg(m) ? "" : m));
    html = html.replace(/&lt;iframe\b[\s\S]*?&lt;\/iframe&gt;/gi, (m) => (stripIframe(m) ? "" : m));

    return html;
  };

  let html = processPage(index.content, index.path);

  // The preview runs in a sandbox WITHOUT allow-same-origin (opaque origin) so
  // generated code can't reach Buildly's storage/cookies. A side effect is that
  // window.localStorage/sessionStorage THROW a SecurityError on access, which made
  // every generated app's save flow fail ("could not save"). Install an in-memory
  // shim (only when native storage is unavailable) so apps work for the session
  // without weakening the sandbox. Must run before any app code.
  const storageShim = `<script>(function(){function mk(){var d={};return{getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[String(k)]=String(v)},removeItem:function(k){delete d[String(k)]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}function ok(n){try{var s=window[n];if(!s)return false;s.setItem("__b","1");s.removeItem("__b");return true}catch(e){return false}}["localStorage","sessionStorage"].forEach(function(n){if(!ok(n)){var s=mk();try{Object.defineProperty(window,n,{value:s,configurable:true})}catch(e){try{window[n]=s}catch(e2){}}}});})();</script>`;

  // Inject a tiny reporter (first thing in the doc) that forwards runtime errors
  // to the parent window so Buildly can surface them and offer an auto-fix.
  // DEBUG version: also builds an in-iframe overlay showing script/click/error counts.
  const reporter = `<script>(function(){
// ── Error forwarding to parent ────────────────────────────────────────────
function r(p){try{parent.postMessage({__buildlyError:true,message:String(p.message||"Error"),source:p.source||"",line:p.line||0},"*")}catch(e){}}
window.addEventListener("error",function(e){r({message:e.message,source:e.filename,line:e.lineno});dbg("ERR","JS: "+e.message.slice(0,80));});
window.addEventListener("unhandledrejection",function(e){var m=e.reason&&e.reason.message?e.reason.message:e.reason;r({message:"Unhandled promise rejection: "+m});dbg("ERR","Promise: "+String(m).slice(0,80));});

// ── DEBUG overlay (remove after debugging) ───────────────────────────────
var _clicks=0,_links=0,_forms=0,_xhr=0,_xhrErr=0,_panel=null;
function dbgPanel(){
  if(_panel)return _panel;
  var p=document.createElement("div");
  p.id="__bd_dbg";
  p.style.cssText="position:fixed;top:8px;right:8px;z-index:2147483647;"+
    "background:rgba(0,0,20,.85);color:#7fff7f;font:11px/1.5 monospace;"+
    "padding:8px 12px;border-radius:6px;min-width:200px;pointer-events:none;"+
    "border:1px solid rgba(0,255,0,.3);max-height:60vh;overflow:auto;";
  document.body.appendChild(p);
  _panel=p;return p;
}
function dbg(cat,msg){
  var p=dbgPanel();
  var row=document.createElement("div");
  row.style.cssText=(cat==="ERR"?"color:#ff7f7f;":"")+"word-break:break-all;";
  row.textContent="["+cat+"] "+msg;
  p.appendChild(row);
  if(p.children.length>40)p.removeChild(p.children[0]);
}
function updateStats(){
  var scripts=document.querySelectorAll("script[src]").length;
  var inline=document.querySelectorAll("script:not([src])").length;
  var links=document.querySelectorAll("a[href]").length;
  var forms=document.querySelectorAll("form").length;
  var p=dbgPanel();
  var hdr=document.getElementById("__bd_dbg_hdr");
  if(!hdr){hdr=document.createElement("div");hdr.id="__bd_dbg_hdr";hdr.style.cssText="color:#fff;border-bottom:1px solid #444;margin-bottom:4px;padding-bottom:4px;";p.insertBefore(hdr,p.firstChild);}
  hdr.textContent="scripts:"+scripts+" inline:"+inline+" a:"+links+" forms:"+forms+" | clicks:"+_clicks+" links:"+_links+" subs:"+_forms+" xhr:"+_xhr+"/"+_xhrErr+"err";
}

// Intercept XHR to monitor CORS errors
var _origOpen=XMLHttpRequest.prototype.open,_origSend=XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open=function(m,u){this.__bd_url=u;return _origOpen.apply(this,arguments);};
XMLHttpRequest.prototype.send=function(){
  _xhr++;updateStats();
  var url=this.__bd_url||"?";
  this.addEventListener("load",function(){if(this.status===0){_xhrErr++;dbg("XHR","CORS/net error: "+url.slice(0,60));}else{dbg("XHR","OK "+this.status+": "+url.slice(0,50));}updateStats();});
  this.addEventListener("error",function(){_xhrErr++;dbg("XHR","FAIL: "+url.slice(0,60));updateStats();});
  return _origSend.apply(this,arguments);
};

// Intercept fetch to monitor CORS errors
var _origFetch=window.fetch;
if(_origFetch){window.fetch=function(input,init){_xhr++;updateStats();var url=typeof input==="string"?input:(input&&input.url)||"?";return _origFetch.apply(this,arguments).then(function(r){dbg("FETCH","OK "+r.status+": "+url.slice(0,50));updateStats();return r;}).catch(function(e){_xhrErr++;dbg("FETCH","FAIL("+e.message+"): "+url.slice(0,50));updateStats();return Promise.reject(e);});};}

// Count all clicks and link clicks
document.addEventListener("click",function(e){
  _clicks++;
  var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;
  if(a)_links++;
  updateStats();
  if(a)dbg("NAV","a href="+( a.getAttribute("href")||"").slice(0,60));
},true);

// Count form submissions
document.addEventListener("submit",function(e){
  _forms++;
  dbg("FORM","submit action="+(e.target&&e.target.action||"(none)").slice(0,60));
  updateStats();
},true);

window.addEventListener("DOMContentLoaded",function(){
  dbg("DOM","ready — initialising debug overlay");
  updateStats();
  // Show which scripts are in the page
  var ss=document.querySelectorAll("script[src]");
  ss.forEach(function(s){dbg("SCR",s.src.slice(0,70));});
});
})();</script>`;
  // Enforce the native semantics of the `hidden` attribute. Generated apps often
  // toggle modals/dialogs/drawers via `el.hidden = true/false` but then style the
  // base class with `display:grid/flex`, which overrides `[hidden]` and leaves a
  // full-screen `position:fixed; inset:0` overlay permanently on top — swallowing
  // every click and making the whole app feel "dead". Forcing [hidden] to stay
  // hidden robustly neutralizes that bug class (beats normal app CSS via
  // !important; a hostile `display:... !important` could still override it).
  const baseStyle = `<style>[hidden]{display:none !important}img.lazyload,img.lazyloading,.lazyload,.lazyloading{opacity:1 !important}</style>`;
  // Detect the imported site's primary host. First priority: the <base href> injected
  // by prepareImportedHtml() — it's the most reliable source. Fallback: count <a href>
  // navigation links only (excluding <link href> CDN stylesheets, which would skew the
  // count toward cdn.shopify.com, cdn.jsdelivr.net, etc.).
  let primaryHost = "";
  const baseHrefMatch = html.match(/<base\s[^>]*href=["']([^"']+)["']/i);
  if (baseHrefMatch) {
    try { primaryHost = new URL(baseHrefMatch[1]).hostname.replace(/^www\./, "").toLowerCase(); } catch {}
  }
  if (!primaryHost) {
    const hostCounts: Record<string, number> = {};
    const aHrefRe = /<a\b[^>]*\bhref=["']https?:\/\/([^/"'?#]+)/gi;
    for (let mm = aHrefRe.exec(html); mm; mm = aHrefRe.exec(html)) {
      const hh = mm[1].toLowerCase().replace(/^www\./, "");
      hostCounts[hh] = (hostCounts[hh] || 0) + 1;
    }
    for (const k in hostCounts)
      if (hostCounts[k] > (hostCounts[primaryHost] || 0)) primaryHost = k;
  }

  // The preview iframe is sandboxed WITHOUT allow-same-origin, so inside it
  // location.origin is the opaque "null" — useless for telling a dead self-link
  // ("/sangha", "about.html") apart from a real external site. But the iframe's
  // document base URL is this builder page's origin, so a relative link's resolved
  // .href points HERE. We capture the builder origin now (parent context) and inject
  // it so the generated-app guard below can classify links correctly.
  const previewOrigin =
    typeof window !== "undefined" ? window.location.origin : "";

  // Browser-like link handling. The preview iframe is a single srcDoc document, so any
  // link that triggers a real top-level navigation either loads a frame-blocked live
  // site (X-Frame-Options/CSP -> WHITE SCREEN) or a dead route -> blank. Both branches
  // below run in capture phase WITHOUT stopPropagation, so the app's/site's own JS click
  // handlers still run; we only cancel the browser's default navigation.
  //
  // IMPORTED sites: the `router` script (added BEFORE this one) intercepts same-site
  // links that map to an imported page and calls preventDefault + postMessage. So here,
  // if e.defaultPrevented the router already handled it -> skip. Everything else that the
  // router did NOT claim — external links AND internal links whose page wasn't imported
  // (e.g. "/contact/" with no contact.html) — would blank the frame by loading the live
  // site, so we open it in a NEW TAB instead. In-page "#" anchors and mailto/tel/sms/
  // javascript: schemes keep their default behavior.
  //
  // GENERATED apps (single self-contained doc, no sibling pages): in-page "#" anchors
  // and mailto/tel/sms/javascript: pass through; truly external links open in a new tab;
  // every other navigation (relative paths, router-style "/route" links, same-origin) is
  // cancelled so the app can never blank itself. The sandbox has no allow-same-origin so
  // location.origin is opaque ("null"); we inject the builder ORIGIN (relative links
  // resolve against it) to classify self-links vs. genuinely external ones.
  const linkHandler = isImported
    // ─── IMPORTED SITES ────────────────────────────────────────────────────────
    // handlePreviewNavigation(url) is the single decision point:
    //   • same-site URL  → postMessage(__buildlyNav) so parent routes within preview
    //   • non-imported   → blocked + toast "Deze pagina is niet geïmporteerd"
    //   • external       → blocked + toast "Externe link geblokkeerd"
    //
    // Also patched: window.open, location.assign, location.replace, location.href setter
    // Also blocked: all form submissions + toast feedback
    ? `<script>(function(){
"use strict";
var HOST=${JSON.stringify(primaryHost)};
function norm(h){return(h||"").replace(/^www\./,"").toLowerCase();}

// ── Toast ──────────────────────────────────────────────────────────────────────
function showToast(msg){
  var id="__bd_toast";
  var prev=document.getElementById(id);
  if(prev){clearTimeout(prev.__t);prev.parentNode&&prev.parentNode.removeChild(prev);}
  var el=document.createElement("div");
  el.id=id;
  el.setAttribute("role","status");
  el.setAttribute("aria-live","polite");
  el.textContent=msg;
  el.style.cssText="position:fixed;bottom:24px;left:50%;transform:translateX(-50%);"+
    "background:rgba(20,20,30,.92);color:#fff;padding:10px 20px;border-radius:8px;"+
    "font-size:13px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;"+
    "z-index:2147483647;pointer-events:none;max-width:80vw;text-align:center;"+
    "box-shadow:0 4px 16px rgba(0,0,0,.35);opacity:0;transition:opacity .15s;";
  document.body.appendChild(el);
  requestAnimationFrame(function(){el.style.opacity="1";});
  el.__t=setTimeout(function(){
    el.style.opacity="0";
    setTimeout(function(){el.parentNode&&el.parentNode.removeChild(el);},200);
  },3000);
}

// ── Central navigation handler ─────────────────────────────────────────────────
function handlePreviewNavigation(href){
  var u;
  try{u=new URL(String(href||""),location.href);}catch(e){return;}
  if(u.protocol!=="http:"&&u.protocol!=="https:")return;
  if(HOST&&norm(u.hostname)===norm(HOST)){
    // Same-site: silently route within the preview (no toast — page will change, or nothing happens if not imported)
    try{parent.postMessage({__buildlyNav:u.pathname+u.search+u.hash},"*");}catch(e){}
  } else {
    // External domain — block and inform the user
    showToast("Externe link geblokkeerd in previewmodus.");
  }
}

// ── 1. Intercept <a> clicks ────────────────────────────────────────────────────
document.addEventListener("click",function(e){
  var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;
  if(!a)return;
  var raw=(a.getAttribute("href")||"").trim();
  if(!raw||raw.charAt(0)==="#")return;
  if(e.defaultPrevented)return; // in-page router already handled it
  if(/^(mailto:|tel:|sms:|javascript:)/i.test(raw))return;
  e.preventDefault();
  handlePreviewNavigation(a.href);
},true);

// ── 2. Intercept form submissions ──────────────────────────────────────────────
// Bubble phase so site's own AJAX handlers (WooCommerce etc.) run first.
// If they already called preventDefault(), the form is handled — skip.
// Only block traditional forms that would navigate the iframe to a new URL.
document.addEventListener("submit",function(e){
  if(e.defaultPrevented)return;
  e.preventDefault();
  showToast("Formulieren zijn uitgeschakeld in previewmodus.");
},false);

// ── 3. Patch window.open ───────────────────────────────────────────────────────
try{
  window.open=function(url){
    if(url)handlePreviewNavigation(String(url));
    else showToast("Navigatie geblokkeerd in previewmodus.");
    return null;
  };
}catch(e){}

// ── 4. Patch location.assign / replace ────────────────────────────────────────
try{location.assign=function(url){handlePreviewNavigation(url);};}catch(e){}
try{location.replace=function(url){handlePreviewNavigation(url);};}catch(e){}

// ── 5. Patch location.href setter ─────────────────────────────────────────────
try{
  var _hd=Object.getOwnPropertyDescriptor(Location.prototype,"href");
  if(_hd&&_hd.set){
    Object.defineProperty(Location.prototype,"href",{
      get:_hd.get,
      set:function(url){
        var u;
        try{u=new URL(String(url),location.href);}catch(e){return;}
        if((u.protocol==="http:"||u.protocol==="https:")&&!(HOST&&norm(u.hostname)===norm(HOST))){
          showToast("Navigatie geblokkeerd in previewmodus.");
        } else {
          handlePreviewNavigation(url);
        }
      },
      configurable:true
    });
  }
}catch(e){}

})();</script>`

    // ─── GENERATED APPS ────────────────────────────────────────────────────────
    // External links open in a new tab. Relative/same-origin links are blocked so
    // the app can never blank itself — EXCEPT links the multi-page router above
    // already claimed (e.defaultPrevented). Forms are intentionally NOT blocked.
    : `<script>(function(){var ORIGIN=${JSON.stringify(previewOrigin)};document.addEventListener("click",function(e){if(e.defaultPrevented)return;var t=e.target,a=t&&t.closest?t.closest("a[href]"):null;if(!a)return;var raw=(a.getAttribute("href")||"").trim();if(raw===""||raw==="#"){e.preventDefault();return;}if(raw.charAt(0)==="#")return;if(/^(mailto:|tel:|sms:|javascript:)/i.test(raw))return;var u;try{u=new URL(a.href,location.href);}catch(err){e.preventDefault();return;}if(u.protocol!=="http:"&&u.protocol!=="https:"){e.preventDefault();return;}if(!ORIGIN||u.origin===ORIGIN){e.preventDefault();return;}e.preventDefault();try{window.open(a.href,"_blank","noopener");}catch(err){}},true);})();</script>`;

  // Mobile hamburger toggle — IMPORTED SITES ONLY. Imported themes render a hamburger
  // + a hidden dropdown <nav>/<ul> of internal pages, but their toggle JS (Elementor,
  // etc.) was stripped on import, so tapping it does nothing. We re-implement a toggle:
  // on a hamburger click, find its menu (aria-controls -> Elementor dropdown nav in the
  // same widget -> nearest nav/menu) and FORCE it open/closed with inline !important
  // styles, beating whatever CSS hid it. The menu's page links stay <a> tags, so the
  // link handler above keeps same-site navigation INSIDE the preview.
  // Gated to imports (generated apps ship their own working menu JS — we must NOT
  // intercept it). Selectors are limited to real hamburger classes, the resolved
  // target must be a nav/menu, and we never stopPropagation, so we can't swallow a
  // working control's own click logic.
  const menuToggle = isImported
    ? `<script>(function(){var OID="__buildlyMenuOverlay";function isMenu(el){if(!el)return false;var tag=el.tagName;if(tag==="NAV"||tag==="UL")return true;var c=el.className&&el.className.toString?el.className.toString():"";return /menu|nav/i.test(c)}function findMenu(t){var ac=t.getAttribute&&t.getAttribute("aria-controls");if(ac){var byId=document.getElementById(ac);if(byId&&isMenu(byId))return byId}var w=t.closest(".elementor-widget-nav-menu,.elementor-element");if(w){var dd=w.querySelector("nav.elementor-nav-menu--dropdown");if(dd)return dd}var p=t.parentElement,hops=0;while(p&&hops<6){var m=p.querySelector('nav,ul.menu,ul[class*="menu"],[class*="nav-menu"]');if(m&&isMenu(m)&&!m.contains(t)&&!t.contains(m))return m;p=p.parentElement;hops++}return null}function close(){var o=document.getElementById(OID);if(o&&o.parentNode)o.parentNode.removeChild(o)}function collect(menu){var out=[],seen={},as=menu.querySelectorAll("a[href]");for(var i=0;i<as.length;i++){var a=as[i],txt=(a.textContent||"").replace(/\\s+/g," ").trim(),href=(a.getAttribute("href")||"").trim();if(!txt||!href)continue;var k=txt+"|"+href;if(seen[k])continue;seen[k]=1;out.push({text:txt,href:href})}return out}function open(menu){close();var links=collect(menu);if(!links.length)return;var ov=document.createElement("div");ov.id=OID;ov.style.cssText="position:fixed;inset:0;z-index:2147483647;background:rgba(15,15,20,.55);display:flex;justify-content:flex-end;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";var panel=document.createElement("div");panel.style.cssText="width:min(340px,85vw);max-width:85vw;height:100%;background:#fff;color:#18181b;overflow-y:auto;-webkit-overflow-scrolling:touch;box-shadow:-8px 0 30px rgba(0,0,0,.25);display:flex;flex-direction:column;padding:14px 0;box-sizing:border-box;";var top=document.createElement("div");top.style.cssText="display:flex;justify-content:flex-end;padding:0 16px 6px;";var x=document.createElement("button");x.type="button";x.setAttribute("aria-label","Sluiten");x.textContent="\u00d7";x.style.cssText="border:0;background:transparent;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif !important;font-size:30px;line-height:1;cursor:pointer;color:#18181b;padding:2px 8px;";x.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();close()});top.appendChild(x);panel.appendChild(top);var nav=document.createElement("nav");nav.style.cssText="display:flex;flex-direction:column;";links.forEach(function(l){var a=document.createElement("a");a.href=l.href;a.textContent=l.text;a.style.cssText="display:block;padding:14px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif !important;font-size:17px !important;font-weight:500 !important;letter-spacing:normal !important;text-transform:none !important;font-feature-settings:normal !important;font-variant-ligatures:none !important;line-height:1.4;color:#18181b !important;text-decoration:none !important;border-bottom:1px solid #eee;white-space:normal;word-break:break-word;";a.addEventListener("click",function(){setTimeout(close,0)});nav.appendChild(a)});panel.appendChild(nav);ov.appendChild(panel);ov.addEventListener("click",function(e){if(e.target===ov)close()});document.body.appendChild(ov)}var SEL='.elementor-menu-toggle,.menu-toggle,[class*="menu-toggle"],.menu-toggle-button,.navbar-toggler,.navbar-toggle,[class*="hamburger"],[class*="burger-menu"]';document.addEventListener("click",function(e){var hit=e.target&&e.target.closest?e.target.closest(SEL):null;if(!hit)return;if(document.getElementById(OID)){e.preventDefault();close();return}var menu=findMenu(hit);if(!menu)return;e.preventDefault();open(menu)},true);document.addEventListener("click",function(e){var op=document.querySelectorAll('[data-bd-open="1"]');for(var i=0;i<op.length;i++){var s=op[i],pli=s.closest("li");if(!pli||!pli.contains(e.target)){s.removeAttribute("data-bd-open");s.style.cssText="";var pa=pli?pli.querySelector(":scope > a"):null;if(pa)pa.setAttribute("aria-expanded","false")}}var a=e.target&&e.target.closest?e.target.closest('li.menu-item-has-children > a,li[class*="has-children"] > a,a.elementor-item-anchor'):null;if(!a)return;var raw=(a.getAttribute("href")||"").trim();if(raw&&raw!=="#")return;var li=a.closest("li");if(!li)return;var sub=li.querySelector(":scope > ul");if(!sub)return;e.preventDefault();if(sub.getAttribute("data-bd-open")==="1"){sub.removeAttribute("data-bd-open");sub.style.cssText="";a.setAttribute("aria-expanded","false")}else{sub.setAttribute("data-bd-open","1");sub.style.cssText="display:block !important;opacity:1 !important;visibility:visible !important;pointer-events:auto !important;height:auto !important;max-height:none !important;overflow:visible !important;transform:none !important;clip:auto !important";a.setAttribute("aria-expanded","true")}},true);document.addEventListener("keydown",function(e){if(e.key==="Escape")close()})})();</script>`
    : "";
  // Multi-page navigation for imported sites. The preview iframe uses srcDoc (opaque
  // origin, no real URLs/routing), so an internal link can't load a sibling page on
  // its own. We intercept clicks whose path maps to another imported page and ask the
  // parent (React) to re-render the preview for that page — keeping only ONE page in
  // the iframe at a time (embedding every page would bloat srcDoc into the megabytes).
  // The host guard (same as linkHandler) is essential: WITHOUT it an external link
  // whose path happens to match a stored key — e.g. a footer credit "https://other.tld/"
  // (path "/" -> index.html) — would be hijacked into the preview instead of opening a
  // new tab. So we only intercept SAME-SITE links; everything else falls to linkHandler.
  let router = "";
  const htmlFiles = files.filter((f) => f.path.endsWith(".html"));
  if (isImported && htmlFiles.length > 1) {
    const keysJson = JSON.stringify(htmlFiles.map((f) => f.path));
    router = `<script>(function(){var KEYS=${keysJson};var HOST=${JSON.stringify(primaryHost)};function norm(h){return h.replace(/^www\\./,"")}function key(pn){var p;try{p=decodeURIComponent(pn)}catch(e){p=pn}p=p.split("?")[0].split("#")[0].replace(/^\\/+|\\/+$/g,"").replace(/\\.(html?|php|aspx?)$/i,"");if(!p)return"index";var k=p.replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").toLowerCase();return k||"index"}document.addEventListener("click",function(e){var t=e.target,a=t&&t.closest?t.closest("a[href]"):null;if(!a)return;var raw=(a.getAttribute("href")||"").trim();if(!raw||raw.charAt(0)==="#")return;var u;try{u=new URL(a.href)}catch(err){return}if(u.protocol!=="http:"&&u.protocol!=="https:")return;if(!HOST||norm(u.hostname.toLowerCase())!==norm(HOST))return;var fk=key(u.pathname)+".html";if(KEYS.indexOf(fk)>-1){e.preventDefault();try{parent.postMessage({__buildlyNav:fk},"*")}catch(err){}}},true);})();</script>`;
  } else if (!isImported && htmlFiles.length > 1) {
    // Multi-page router for generated (non-imported) projects.
    // The preview iframe uses srcDoc so relative links like <a href="pages/bookings.html">
    // resolve against the parent's URL (same origin) and get silently blocked by the
    // generated-app linkHandler. This router intercepts those clicks first (capture phase)
    // and routes to the correct project page via postMessage instead.
    const pathsJson = JSON.stringify(htmlFiles.map((f) => f.path));
    const currentDir = index.path.includes("/") ? index.path.slice(0, index.path.lastIndexOf("/")) : "";
    const currentDirJson = JSON.stringify(currentDir);
    router = `<script>(function(){
var PATHS=${pathsJson};
var CDIR=${currentDirJson};
function resolve(href){
  href=(href||"").split("?")[0].split("#")[0];
  if(!href)return null;
  var parts=CDIR?CDIR.split("/"):[];
  href.split("/").forEach(function(p){
    if(p==="..")parts.pop();
    else if(p&&p!==".")parts.push(p);
  });
  return parts.join("/");
}
document.addEventListener("click",function(e){
  var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;
  if(!a)return;
  var raw=(a.getAttribute("href")||"").trim();
  if(!raw||raw.charAt(0)==="#")return;
  if(/^(https?:)?\/\//i.test(raw)||/^(mailto:|tel:|sms:|javascript:)/i.test(raw))return;
  var resolved=resolve(raw);
  if(resolved&&PATHS.indexOf(resolved)>-1){
    e.preventDefault();
    try{parent.postMessage({__buildlyNav:resolved},"*");}catch(err){}
  }
},true);
})();</script>`;
  }

  // Re-implements the most common UI interaction patterns for imported sites,
  // whose original JS was stripped on import. Injected BEFORE linkHandler so that
  // e.preventDefault() inside here triggers linkHandler's "if(e.defaultPrevented)return"
  // guard and prevents double-handling of <a data-bs-toggle="..."> elements.
  // Hamburger buttons are excluded — menuToggle already handles them.
  const interactiveRevival = isImported ? `<script>(function(){
"use strict";
var HB='.elementor-menu-toggle,.menu-toggle,[class*="menu-toggle"],.menu-toggle-button,.navbar-toggler,.navbar-toggle,[class*="hamburger"],[class*="burger-menu"]';
function qs(s,c){try{return(c||document).querySelector(s)}catch(e){return null}}
function getTarget(el){
  var t=el.getAttribute("data-bs-target")||el.getAttribute("data-target")||"";
  if(!t){var h=(el.getAttribute("href")||"").trim();if(h&&h.charAt(0)==="#"&&h.length>1)t=h;}
  return t&&t!=="#"?qs(t):null;
}

// ── 1. Bootstrap / generic collapse ───────────────────────────────────────
function collapseToggle(trig){
  var target=getTarget(trig);if(!target)return;
  var open=target.classList.contains("show")||target.classList.contains("in");
  var parentSel=trig.getAttribute("data-bs-parent")||trig.getAttribute("data-parent");
  if(parentSel&&!open){
    var p=qs(parentSel);
    if(p){
      p.querySelectorAll(".collapse.show,.collapse.in").forEach(function(c){c.classList.remove("show","in");c.style.cssText="";});
      p.querySelectorAll("[aria-expanded='true']").forEach(function(b){b.setAttribute("aria-expanded","false");b.classList.add("collapsed");});
    }
  }
  if(open){
    target.classList.remove("show","in");target.style.cssText="";
    trig.setAttribute("aria-expanded","false");trig.classList.add("collapsed");trig.classList.remove("active");
  }else{
    target.classList.add("show","in");target.style.removeProperty("display");target.style.removeProperty("height");
    trig.setAttribute("aria-expanded","true");trig.classList.remove("collapsed");trig.classList.add("active");
  }
}

// ── 2. Bootstrap / generic tabs ───────────────────────────────────────────
function tabActivate(trig){
  var target=getTarget(trig);if(!target)return;
  var list=trig.closest('[role="tablist"],ul.nav,ul.tabs,.tab-list,.wc-tabs,.product-tabs');
  if(list){
    list.querySelectorAll('[data-bs-toggle="tab"],[data-toggle="tab"],[data-bs-toggle="pill"],[data-toggle="pill"],[role="tab"]').forEach(function(t){
      t.classList.remove("active","current","is-active");t.setAttribute("aria-selected","false");
    });
  }
  trig.classList.add("active","current","is-active");trig.setAttribute("aria-selected","true");
  var cont=target.closest('.tab-content,.tabs-content,.panel-container');
  if(cont){
    cont.querySelectorAll('[role="tabpanel"],.tab-pane,.tabs-panel').forEach(function(p){
      p.classList.remove("active","show","current","is-active");p.hidden=true;
    });
  }
  target.classList.add("active","show","current","is-active");target.hidden=false;
}

// ── 3. Modal (open / close) ────────────────────────────────────────────────
var BG="__bd_mbg";
function modalOpen(target){
  if(!target)return;
  target.classList.add("show","active","is-open","open");target.removeAttribute("hidden");
  target.style.cssText="display:flex !important;opacity:1 !important;visibility:visible !important;pointer-events:auto !important;position:fixed !important;inset:0 !important;z-index:9000 !important;align-items:center !important;justify-content:center !important;overflow:auto !important;background:rgba(0,0,0,.5) !important;";
  document.body.classList.add("modal-open");
  var bg=document.getElementById(BG);
  if(!bg){bg=document.createElement("div");bg.id=BG;bg.style.cssText="position:fixed;inset:0;z-index:8998;";bg.onclick=function(){modalClose(target);};document.body.appendChild(bg);}
}
function modalClose(target){
  if(!target)return;
  target.classList.remove("show","active","is-open","open");target.style.cssText="";
  document.body.classList.remove("modal-open");
  var bg=document.getElementById(BG);if(bg)bg.remove();
}

// ── 4. ARIA expanded generic toggle ───────────────────────────────────────
function ariaToggle(trig){
  var open=trig.getAttribute("aria-expanded")==="true";
  var tid=trig.getAttribute("aria-controls");
  var target=tid?document.getElementById(tid):getTarget(trig);
  trig.setAttribute("aria-expanded",open?"false":"true");
  if(!target)return;
  if(open){target.hidden=true;target.classList.remove("open","show","active","expanded","visible");target.style.cssText="";}
  else{target.hidden=false;target.classList.add("open","show","active","expanded","visible");target.style.removeProperty("display");}
}

// ── 5. Elementor accordion ────────────────────────────────────────────────
function elemAccToggle(titleEl){
  var item=titleEl.closest(".elementor-accordion-item,.elementor-tab,.e-accordion__item");if(!item)return;
  var isOpen=titleEl.getAttribute("aria-expanded")==="true"||item.classList.contains("e--active")||item.classList.contains("elementor-active");
  var wrapper=item.parentElement;
  if(wrapper&&!isOpen){
    wrapper.querySelectorAll(".elementor-accordion-item,.elementor-tab,.e-accordion__item").forEach(function(s){
      if(s===item)return;
      var t2=s.querySelector(".elementor-tab-title,.elementor-accordion-title,.e-accordion__item__title");
      var c2=s.querySelector(".elementor-tab-content,.elementor-accordion-content,.e-accordion__item__content");
      if(t2)t2.setAttribute("aria-expanded","false");
      if(c2){c2.style.cssText="";c2.hidden=true;}
      s.classList.remove("e--active","elementor-active");
    });
  }
  var content=item.querySelector(".elementor-tab-content,.elementor-accordion-content,.e-accordion__item__content");
  if(isOpen){
    titleEl.setAttribute("aria-expanded","false");
    if(content){content.style.cssText="";content.hidden=true;}
    item.classList.remove("e--active","elementor-active");
  }else{
    titleEl.setAttribute("aria-expanded","true");
    if(content){content.style.cssText="display:block !important;height:auto !important;overflow:visible !important;max-height:none !important;";content.hidden=false;}
    item.classList.add("e--active","elementor-active");
  }
}

// ── 6. Generic accordion (non-framework, FAQ patterns) ────────────────────
function genericAccToggle(trig){
  var panel=null;
  var s=trig.nextElementSibling;
  while(s){if(/content|body|panel|answer|collapse|detail/i.test(s.className||"")){panel=s;break;}s=s.nextElementSibling;}
  if(!panel){var par=trig.parentElement;if(par){s=par.nextElementSibling;while(s){if(/content|body|panel|answer|collapse/i.test(s.className||"")){panel=s;break;}s=s.nextElementSibling;}}}
  if(!panel)return;
  var isOpen=panel.offsetParent!==null&&panel.style.display!=="none";
  if(isOpen){panel.style.display="none";trig.classList.remove("active","is-active","open");trig.setAttribute("aria-expanded","false");}
  else{panel.style.display="block";trig.classList.add("active","is-active","open");trig.setAttribute("aria-expanded","true");}
}

// ── 7. Carousel step ──────────────────────────────────────────────────────
function carouselStep(btn,dir){
  var wrap=btn.closest('.slick-slider,.owl-carousel,.swiper-wrapper,.carousel-inner,.slides')||btn.parentElement;
  if(!wrap)return;
  var slides=Array.from(wrap.querySelectorAll('.slick-slide:not(.slick-cloned),.owl-item:not(.cloned),.swiper-slide,.carousel-item,[class*="slide-item"]'));
  if(slides.length<2)return;
  var cur=slides.findIndex(function(s){return s.classList.contains("slick-current")||s.classList.contains("active")||s.classList.contains("is-active")||s.classList.contains("current");});
  if(cur<0)cur=0;
  var nxt=(cur+dir+slides.length)%slides.length;
  slides.forEach(function(s){s.classList.remove("slick-current","active","is-active","current");});
  slides[nxt].classList.add("slick-current","active","is-active","current");
}

// ── Main delegation ───────────────────────────────────────────────────────
document.addEventListener("click",function(e){
  var el=e.target;if(!el||!el.closest)return;
  // Detect Bootstrap 4/5 at click time (scripts load async, may not exist yet at
  // script-parse time). When Bootstrap is active, let IT handle its own data-bs-toggle
  // elements in bubble phase — our capture-phase handlers would cause double-toggle.
  var hasBS=!!(window.bootstrap&&window.bootstrap.Collapse)||(typeof jQuery!=="undefined"&&jQuery.fn&&!!jQuery.fn.collapse);

  // 1. Collapse — skip hamburger togglers (menuToggle handles those)
  if(!hasBS){
    var colTrig=el.closest('[data-bs-toggle="collapse"],[data-toggle="collapse"]');
    if(colTrig&&!colTrig.closest(HB)){e.preventDefault();collapseToggle(colTrig);return;}
  }

  // 2. Tabs / pills
  if(!hasBS){
    var tabTrig=el.closest('[data-bs-toggle="tab"],[data-toggle="tab"],[data-bs-toggle="pill"],[data-toggle="pill"]');
    if(tabTrig){e.preventDefault();tabActivate(tabTrig);return;}
  }

  // 3. Modal open
  if(!hasBS){
    var modTrig=el.closest('[data-bs-toggle="modal"],[data-toggle="modal"],[data-popup-id],[data-open-popup]');
    if(modTrig){
      e.preventDefault();
      var mid=modTrig.getAttribute("data-bs-target")||modTrig.getAttribute("data-target")||("#"+(modTrig.getAttribute("data-popup-id")||modTrig.getAttribute("data-open-popup")||""));
      modalOpen(mid&&mid!=="#"?qs(mid):null);return;
    }
  }

  // 4. Modal close
  if(!hasBS){
    var cTrig=el.closest('[data-bs-dismiss="modal"],[data-dismiss="modal"],[class*="modal-close"],[class*="popup-close"],[class*="lightbox-close"]');
    if(cTrig){e.preventDefault();modalClose(cTrig.closest('.modal,.popup,.lightbox,[role="dialog"]'));return;}
  }

  // 5. Elementor accordion
  var eAcc=el.closest('.elementor-tab-title,.elementor-accordion-title,.e-accordion__item__title');
  if(eAcc){e.preventDefault();elemAccToggle(eAcc);return;}

  // 6. Generic FAQ / accordion buttons
  var gAcc=el.closest('[class*="accordion-button"],[class*="accordion-header"],[class*="accordion-title"],[class*="faq-question"],[class*="faq-btn"],[class*="faq-title"],[class*="toggle-title"],[class*="toggle-btn"]');
  if(gAcc&&!gAcc.closest('[data-bs-toggle],[data-toggle]')&&!gAcc.closest(HB)){e.preventDefault();genericAccToggle(gAcc);return;}

  // 7. ARIA expanded generic toggle — not hamburger, not already handled above
  var aTrig=el.closest('[aria-expanded][aria-controls]');
  if(aTrig&&!aTrig.closest(HB)&&!aTrig.closest('[data-bs-toggle],[data-toggle]')){e.preventDefault();ariaToggle(aTrig);return;}

  // 8. Carousel prev / next
  var prev=el.closest('.slick-prev,.owl-prev,.swiper-button-prev,.splide__arrow--prev,[class*="carousel-prev"],[class*="slider-prev"],[class*="prev-arrow"]');
  if(prev){e.preventDefault();carouselStep(prev,-1);return;}
  var nxt=el.closest('.slick-next,.owl-next,.swiper-button-next,.splide__arrow--next,[class*="carousel-next"],[class*="slider-next"],[class*="next-arrow"]');
  if(nxt){e.preventDefault();carouselStep(nxt,1);return;}

  // 9. Scroll to top
  var st=el.closest('[class*="scroll-top"],[class*="back-to-top"],[id*="scroll-top"],[id*="back-to-top"]');
  if(st){e.preventDefault();window.scrollTo({top:0,behavior:"smooth"});return;}

},true);

// ── Init: hide non-active Bootstrap tab panes on load ─────────────────────
document.querySelectorAll('.tab-pane:not(.active,.show)').forEach(function(p){p.hidden=true;});

})();</script>` : "";

  // Patches fetch() and XMLHttpRequest inside the iframe so same-site AJAX calls
  // (WooCommerce add-to-cart, search, contact forms, etc.) are tunnelled through our
  // server-side proxy instead of going directly to the original domain. Direct calls
  // would fail with a CORS error because the srcDoc iframe's origin is opaque ("null").
  // The proxy also maintains a session-scoped cookie store so login state is preserved
  // across calls within the same preview tab.
  const proxyBase = typeof window !== "undefined" ? window.location.origin + "/api/proxy" : "";
  const ajaxProxy = isImported && primaryHost && proxyBase
    ? `<script>(function(){
"use strict";
var H=${JSON.stringify(primaryHost)};
var P=${JSON.stringify(proxyBase)};
var SID=(function(){
  try{var k="__pv_sid",v=sessionStorage.getItem(k);
    if(!v){v=Math.random().toString(36).slice(2)+Date.now().toString(36);sessionStorage.setItem(k,v);}
    return v;
  }catch(e){return "s";}
})();
function nm(h){return(h||"").replace(/^www\./,"").toLowerCase();}
// document.baseURI respects <base href> and is evaluated at call time (after DOM is parsed).
// location.href is "about:srcdoc" in a srcDoc iframe and cannot resolve relative paths.
function docBase(){
  var b=document.baseURI;
  return(b&&(b.startsWith("http://")||b.startsWith("https://")))?b:"https://"+H+"/";
}
function shouldProxy(url){
  if(!H||!P)return false;
  var u;try{u=new URL(String(url),docBase());}catch(e){return false;}
  return(u.protocol==="http:"||u.protocol==="https:")&&nm(u.hostname)===nm(H);
}
function toProxy(url){
  var u;try{u=new URL(String(url),docBase());}catch(e){return url;}
  return P+"?url="+encodeURIComponent(u.href);
}
function addSid(headers){
  if(!headers)headers={};
  if(typeof Headers!=="undefined"&&headers instanceof Headers){
    headers.set("X-Preview-Session",SID);
  }else{
    headers=Object.assign({},headers,{"X-Preview-Session":SID});
  }
  return headers;
}
if(typeof fetch!=="undefined"){
  var _f=window.fetch.bind(window);
  window.fetch=function(inp,ini){
    var url=typeof inp==="string"?inp:(inp&&inp.url!=null?String(inp.url):String(inp));
    if(shouldProxy(url)){
      ini=ini?Object.assign({},ini):{};
      ini.headers=addSid(ini.headers);
      ini.credentials="omit";
      return _f(toProxy(url),ini);
    }
    return _f(inp,ini);
  };
}
if(typeof XMLHttpRequest!=="undefined"){
  var _op=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url){
    var args=Array.prototype.slice.call(arguments);
    if(shouldProxy(url)){args[1]=toProxy(url);this.__pvProxy=true;}
    _op.apply(this,args);
    if(this.__pvProxy){try{this.setRequestHeader("X-Preview-Session",SID);}catch(e){}}
  };
}
})();</script>`
    : "";

  // Router runs before linkHandler so it can intercept imported-page links; for
  // non-imported (external) links the router no-ops and linkHandler takes over.
  // interactiveRevival comes before linkHandler so its e.preventDefault() triggers
  // linkHandler's "if(e.defaultPrevented)return" guard on <a data-bs-toggle> elements.
  // ajaxProxy runs first so the patched fetch/XHR is in place before any inline scripts.
  const inject = ajaxProxy + baseStyle + storageShim + reporter + router + interactiveRevival + linkHandler + menuToggle;
  return injectHead(html, inject);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Decode a JSON string body that may be incomplete (it streams in live). Stops cleanly
// at the closing quote or at a truncated escape, so partial content renders without errors.
function decodePartialJsonString(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "\\") {
      const n = raw[i + 1];
      if (n === undefined) break; // truncated escape at the streaming edge
      if (n === "n") out += "\n";
      else if (n === "t") out += "\t";
      else if (n === "r") out += "\r";
      else if (n === '"') out += '"';
      else if (n === "\\") out += "\\";
      else if (n === "/") out += "/";
      else if (n === "u") {
        const hex = raw.slice(i + 2, i + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      } else out += n;
      i++;
    } else if (c === '"') {
      break; // end of the JSON string
    } else {
      out += c;
    }
  }
  return out;
}

// Pull the file path and the content-being-written out of a partial tool-call JSON
// buffer (write_file → "content", edit_file → "new_string").
function extractLiveCode(buf: string): { path: string | null; content: string } {
  const pathM = buf.match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/);
  const path = pathM ? decodePartialJsonString(pathM[1] + '"') : null;
  for (const key of ['"content"', '"new_string"']) {
    const idx = buf.indexOf(key);
    if (idx >= 0) {
      const after = buf.slice(idx + key.length);
      const q = after.indexOf('"');
      if (q >= 0) return { path, content: decodePartialJsonString(after.slice(q + 1)) };
    }
  }
  return { path, content: "" };
}

// Renders the file content as it streams in, auto-scrolling to the newest line so the
// user watches the code being written. Kept deliberately simple (no syntax highlighting)
// because the content is incomplete until the write finishes.
function LiveCodeView({ content }: { content: string }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [content]);
  const lines = content.split("\n");
  return (
    <pre className="text-[13px] leading-[1.6] font-mono m-0 min-w-max p-0 text-gray-300">
      {lines.map((line, i) => (
        <div key={i} className="flex">
          <span className="select-none w-12 text-right pr-3 py-px text-gray-600 shrink-0 text-[11px]">{i + 1}</span>
          <span className="py-px pr-8 whitespace-pre">{line}</span>
        </div>
      ))}
      <div ref={endRef} />
    </pre>
  );
}

export function ProjectWorkspace() {
  const [, params] = useRoute("/projects/:id");
  const projectId = Number(params?.id);
  const queryClient = useQueryClient();

  const [prompt, setPrompt] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"code" | "preview">("preview");
  const [isDownloading, setIsDownloading] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  // Full-screen "web viewer" for the preview. There is no zoom/scaling: the site always
  // renders at its real, fixed size (exactly how it looks in a real browser). This toggle
  // just makes the preview take over the whole window so the user can see it full size.
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  // Visual "select & edit" mode: click an element in the preview to edit it directly
  // (deterministic, coupled to the code — no AI vision). `selection` holds the clicked element.
  const [selectMode, setSelectMode] = useState(false);
  // Manual blog editor (no AI): a small modal with title + body (+ optional image).
  const [publishOpen, setPublishOpen] = useState(false);
  const [pubBusy, setPubBusy] = useState(false);
  const [pubData, setPubData] = useState<any>(null);     // { platformHost, target, subdomain, domains }
  const [pubSlug, setPubSlug] = useState("");
  const [newDomain, setNewDomain] = useState("");
  const reloadPublish = () => fetch(`/api/projects/${projectId}/publish`).then((r) => r.json()).then(setPubData).catch(() => {});
  const [blogOpen, setBlogOpen] = useState(false);
  const [blogTitle, setBlogTitle] = useState("");
  const [blogBody, setBlogBody] = useState("");
  const [blogImage, setBlogImage] = useState("");
  const [blogBusy, setBlogBusy] = useState(false);
  const selectModeRef = useRef(false);
  selectModeRef.current = selectMode;
  type Selection = { kind: "text" | "image"; tag: string; selector: string; cls?: string; text?: string; src?: string; file?: string; alt?: string; w?: number; h?: number };
  const [selection, setSelection] = useState<Selection | null>(null);
  const [editValue, setEditValue] = useState("");
  const [applyingEdit, setApplyingEdit] = useState(false);
  // For imported multi-page sites: which page the preview currently shows (null = index).
  const [previewPage, setPreviewPage] = useState<string | null>(null);
  // Stable session ID for the reverse-proxy cookie jar — one per component mount.
  // The site-proxy and preview-page endpoints use this to associate cookie state
  // with this specific preview tab.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const previewSessionId = useMemo(() => crypto.randomUUID(), []);

  const [isStreaming, setIsStreaming] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  type AgentEvt =
    | { event: "file_read";         path: string; size: number }
    | { event: "target_found";      path: string; location: string }
    | { event: "patch_created";     path: string; linesInPatch: number }
    | { event: "patch_applied";     path: string }
    | { event: "file_saved";        path: string; op: "create" | "update"; linesAdded: number; linesRemoved: number; symbols: string[]; summary: string }
    | { event: "validation_passed"; path: string }
    | { event: "validation_error";  path: string; error: string };

  type BuildRecord = {
    assistantMsgId: number | null;
    events: AgentEvt[];
    segments: StreamSegment[];
    succeeded: boolean;
  };

  const [agentEvents, setAgentEvents] = useState<AgentEvt[]>([]);
  const [buildSucceeded, setBuildSucceeded] = useState(false);
  const [expandedCodeIndices, setExpandedCodeIndices] = useState<Set<number>>(new Set());
  const [expandedSegIndices, setExpandedSegIndices] = useState<Set<number>>(new Set());
  const [preBuildSnapshot, setPreBuildSnapshot] = useState<Map<string, string>>(new Map());
  const [codeDiffMode, setCodeDiffMode] = useState(false);
  const [activeDiffHunks, setActiveDiffHunks] = useState<Set<number>>(new Set());
  const [buildError, setBuildError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionResult, setExtractionResult] = useState<{ created: { path: string; source: string }[]; canonical: string } | null>(null);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [isAutoFixing, setIsAutoFixing] = useState(false);
  const autoFixAttemptsRef = useRef(0);
  const [streamedText, setStreamedText] = useState("");
  // Honest, always-moving progress for long builds: how many files have streamed in
  // so far, and how many seconds the build has been running. A capped phase timeline
  // alone looks frozen for the minutes a large/imported rebuild takes — these keep
  // visibly ticking so the user can see it is genuinely working, not stuck.
  const [filesWritten, setFilesWritten] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  // Latest backend progress message ("Bestand schrijven…", "Aan het werk…"). The
  // backend streams these as `status` events; showing them keeps long first-file
  // generations from looking frozen while no file has been saved yet.
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  // Live code buffer: the raw (still-streaming, possibly incomplete) tool-call JSON for
  // the file currently being written, so the code panel can show it being typed live.
  const [liveCodeBuf, setLiveCodeBuf] = useState<string | null>(null);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  // SEO/AEO content engine: auto-publish toggle + manual generate state.
  const [seoAuto, setSeoAuto] = useState(false);
  const [seoBusy, setSeoBusy] = useState(false);
  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/projects/${projectId}/seo`).then((r) => r.json()).then((d) => setSeoAuto(!!d.autoEnabled)).catch(() => {});
    void reloadPublish(); // load publish status for the header indicator
  }, [projectId]);

  // Permanent record of each past build, keyed by the assistant message id that triggered it.
  // Grows forever — never truncated — so code panels stay anchored to their message permanently.
  const [buildRecords, setBuildRecords] = useState<BuildRecord[]>([]);
  // Folders that are manually collapsed in the file tree (empty = all expanded)
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatTextareaRef = useRef<HTMLTextAreaElement>(null);
  const autoSentRef = useRef(false);
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  // Tracks the set of imported page file paths so the postMessage handler can
  // resolve a clicked pathname to an imported page without closing over stale state.
  const knownFilePathsRef = useRef<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const messagesLenRef = useRef(0);
  const messagesRef = useRef<typeof messages>(undefined);
  const pendingBaseRef = useRef(0);
  // Raw tokens received so far, and how many we've revealed to the UI. A rAF loop
  // closes the gap at a steady pace so bursty model output still types out live.
  const rawStreamRef = useRef("");
  const shownLenRef = useRef(0);
  // Stable refs so streamMessage can read current build state synchronously
  const agentEventsRef = useRef<AgentEvt[]>([]);
  const streamedTextRef = useRef("");
  const buildSucceededRef = useRef(false);

  const { data: project, isLoading: isLoadingProject } = useGetProject(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) },
  });

  const { data: messages, isLoading: isLoadingMessages } = useListMessages(projectId, {
    query: { enabled: !!projectId, queryKey: getListMessagesQueryKey(projectId) },
  });

  const { data: files, isLoading: isLoadingFiles } = useListFiles(projectId, {
    query: { enabled: !!projectId, queryKey: getListFilesQueryKey(projectId) },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingUser]);

  // Interval-based auto-scroll during streaming — fires every 200ms, respects user scroll.
  useEffect(() => {
    if (!isStreaming) {
      userScrolledUpRef.current = false;
      return;
    }
    const id = setInterval(() => {
      if (!userScrolledUpRef.current) {
        messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
      }
    }, 200);
    return () => clearInterval(id);
  }, [isStreaming]);

  // Scroll on new agent events (sparse, so smooth is fine).
  useEffect(() => {
    if (agentEvents.length === 0 || userScrolledUpRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agentEvents]);

  // Scroll to completion message and reset user-scroll flag.
  useEffect(() => {
    if (!buildSucceeded) return;
    userScrolledUpRef.current = false;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [buildSucceeded]);

  // Keep stable refs in sync so streamMessage can read current values synchronously.
  useEffect(() => { agentEventsRef.current = agentEvents; }, [agentEvents]);
  useEffect(() => { streamedTextRef.current = streamedText; }, [streamedText]);
  useEffect(() => { buildSucceededRef.current = buildSucceeded; }, [buildSucceeded]);

  // Let Escape exit the full-screen web viewer.
  useEffect(() => {
    if (!previewFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewFullscreen]);

  // Track the known message count so the optimistic user bubble can be dropped
  // only once the persisted message actually lands (handles repeated prompts).
  useEffect(() => {
    messagesLenRef.current = messages?.length ?? 0;
    messagesRef.current = messages;
  }, [messages]);

  // Smoothly reveal buffered tokens so the live code "types" out continuously,
  // even though the reasoning model emits text in bursts separated by pauses.
  // The pace accelerates with backlog so it never lags far behind real output.
  // NOTE: driven by setInterval, NOT requestAnimationFrame. Buildly runs inside an
  // embedded canvas iframe, and browsers heavily throttle/pause rAF callbacks for
  // iframes — which froze the live reveal for real users (it only animated when the
  // app was a foreground tab, e.g. during automated testing). A timer keeps the
  // typewriter advancing regardless of the iframe's paint scheduling.
  useEffect(() => {
    if (!isStreaming) return;
    let lastT = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = now - lastT;
      lastT = now;
      const target = rawStreamRef.current.length;
      const shown = shownLenRef.current;
      if (shown < target) {
        const backlog = target - shown;
        const cps = Math.max(600, backlog * 2);
        const next = Math.min(target, shown + Math.ceil((cps * dt) / 1000));
        shownLenRef.current = next;
        setStreamedText(rawStreamRef.current.slice(0, next));
      }
    }, 33);
    return () => clearInterval(id);
  }, [isStreaming]);

  // Tick a live elapsed-time counter while building. Large/imported rebuilds take a
  // few minutes; a visibly counting timer reassures the user the build is alive even
  // after the phase timeline has reached its final step.
  useEffect(() => {
    if (!isStreaming) return;
    const start = Date.now();
    setElapsedSec(0);
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isStreaming]);

  useEffect(() => {
    if (files && files.length > 0 && !selectedFile) {
      setSelectedFile(files[0].path);
    }
  }, [files, selectedFile]);

  // Listen for runtime errors forwarded by the preview iframe.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Only trust messages coming from our own preview iframe.
      if (!previewIframeRef.current || e.source !== previewIframeRef.current.contentWindow) return;
      const d = e.data as {
        __buildlyError?: boolean;
        __buildlyNav?: string;
        __buildlySelected?: boolean;
        kind?: "text" | "image";
        tag?: string;
        selector?: string;
        cls?: string;
        text?: string;
        src?: string;
        file?: string;
        alt?: string;
        w?: number;
        h?: number;
        message?: string;
        source?: string;
        line?: number;
      };
      if (!d) return;
      // Visual select mode: the user clicked an element in the preview to edit it.
      if (d.__buildlySelected && (d.kind === "text" || d.kind === "image")) {
        const sel: Selection = { kind: d.kind, tag: d.tag ?? "", selector: d.selector ?? "", cls: d.cls, text: d.text, src: d.src, file: d.file, alt: d.alt, w: d.w, h: d.h };
        setSelection(sel);
        setEditValue(d.kind === "text" ? (d.text ?? "") : "");
        return;
      }
      // Imported multi-page navigation: the preview asks to render a sibling page.
      // Accepts either a direct file key ("about.html" from the router script) or a
      // raw pathname ("/about/" from the linkHandler for non-imported same-site links).
      if (typeof d.__buildlyNav === "string") {
        const nav = d.__buildlyNav;
        if (/^[a-zA-Z0-9._\/-]+\.html$/.test(nav)) {
          // Direct file key from the in-page router (e.g. "about.html" or "pages/bookings.html")
          setPreviewPage(nav);
        } else if (nav.startsWith("/")) {
          // Path from the linkHandler — normalize to a key and find a matching page
          const normalizeKey = (pn: string) => {
            let p = pn.split("?")[0].split("#")[0].replace(/^\/+|\/+$/g, "").replace(/\.(html?|php|aspx?)$/i, "");
            if (!p) return "index";
            return p.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "index";
          };
          const key = normalizeKey(nav);
          const fileKey = `${key}.html`;
          if (knownFilePathsRef.current.has(fileKey) || knownFilePathsRef.current.has(key)) {
            setPreviewPage(fileKey);
          }
          // If page not found in imported set: silently ignore — user stays on current preview page
        }
        return;
      }
      if (!d.__buildlyError || typeof d.message !== "string") return;
      const file = d.source ? d.source.split("/").pop() : "";
      const detail = file ? `${d.message} (${file}:${d.line ?? "?"})` : d.message;
      setPreviewErrors((prev) => (prev.includes(detail) ? prev : [...prev, detail].slice(-4)));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Tell the preview iframe to enter/leave select mode. Also re-sent on iframe load (below).
  useEffect(() => {
    try { previewIframeRef.current?.contentWindow?.postMessage({ __buildlySelectMode: selectMode }, "*"); } catch { /* ignore */ }
    if (!selectMode) setSelection(null);
  }, [selectMode, previewKey, previewPage]);

  // Leaving select mode (or turning it off) clears any open edit popover.
  const closeSelection = () => setSelection(null);

  // Post a single deterministic action to the (AI-free) /action endpoint.
  const postAction = async (action: Record<string, unknown>): Promise<boolean> => {
    try {
      const res = await fetch(`/api/projects/${projectId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      return res.ok;
    } catch { return false; }
  };

  const refreshAfterEdit = async () => {
    await queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
    await queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(projectId) });
    setPreviewKey((k) => k + 1);
    void reloadPublish(); // refresh "unpublished changes" indicator after an edit
  };

  const currentPagePath = () => previewPage ?? "index.html";

  // Apply a per-element edit (this element only) via edit_element. No AI.
  const applyVisualEdit = async () => {
    if (!selection || !selection.selector) { closeSelection(); return; }
    const page = currentPagePath();
    let action: Record<string, unknown> | null = null;
    if (selection.kind === "text") {
      const to = editValue;
      if (to.trim() === (selection.text ?? "").trim()) { closeSelection(); return; }
      action = { action: "edit_element", page, selector: selection.selector, op: "text", value: to };
    } else if (selection.kind === "image") {
      const src = editValue.trim();
      if (!src) { closeSelection(); return; }
      action = { action: "edit_element", page, selector: selection.selector, op: "image", value: src };
    }
    if (!action) { closeSelection(); return; }
    setApplyingEdit(true);
    const ok = await postAction(action);
    if (ok) await refreshAfterEdit();
    setApplyingEdit(false);
    closeSelection();
  };

  // Is the selected element the nav/header bar itself? Then colour changes should be
  // site-wide (the nav must look the same on every page), not a one-element/one-page edit.
  const isNavLike = (s: Selection) =>
    /^(nav|header)$/i.test(s.tag) ||
    /(^|\s|-)(navbar|nav-bar|site-header|main-header|menu-bar|topbar|navigation|masthead)/i.test(s.cls || "") ||
    // Clicked an element inside the bar: its selector path starts at a nav/header ancestor.
    /(?:^|>)(?:#?header\b|#?nav\b|[\w-]*navbar[\w-]*|[\w-]*menu-?bar[\w-]*|[\w-]*site-header[\w-]*)/i.test(s.selector || "");

  // Per-element colour / background — applies immediately when a swatch is picked.
  // For the nav/header bar the background is applied to ALL pages via change_color.
  const applyElementColor = async (op: "color" | "background", value: string) => {
    if (!selection || !selection.selector) return;
    setApplyingEdit(true);
    const action =
      isNavLike(selection) && op === "background"
        ? { action: "change_color", target: "nav", color: value }
        : { action: "edit_element", page: currentPagePath(), selector: selection.selector, op, value };
    const ok = await postAction(action);
    if (ok) await refreshAfterEdit();
    setApplyingEdit(false);
    closeSelection();
  };

  // Hand the selected element's CHARACTERISTICS (not its pixels) to the chat, so the AI
  // knows exactly which element + its current code properties. Cheap, code-coupled context.
  const sendSelectionToChat = () => {
    if (!selection) return;
    const page = currentPagePath();
    const lines: string[] = [`Op pagina "${page}" heb ik dit element geselecteerd:`];
    lines.push(`- Type: ${selection.kind === "image" ? "afbeelding" : "tekst/element"} (<${selection.tag}>)`);
    if (selection.selector) lines.push(`- CSS-selector: ${selection.selector}`);
    if (selection.cls) lines.push(`- Klassen: ${selection.cls}`);
    if (selection.kind === "image") {
      if (selection.file) lines.push(`- Bestand: ${selection.file}`);
      if (selection.src) lines.push(`- Bron: ${selection.src}`);
      if (selection.alt) lines.push(`- Alt-tekst: "${selection.alt}"`);
      if (selection.w && selection.h) lines.push(`- Afmetingen: ${selection.w}×${selection.h}px`);
    } else if (selection.text) {
      lines.push(`- Huidige tekst: "${selection.text}"`);
    }
    const context = lines.join("\n") + "\n\nMijn wens: ";
    setSelectMode(false);
    closeSelection();
    setPrompt((prev) => (prev.trim() ? prev.trimEnd() + "\n\n" : "") + context);
    setTimeout(() => {
      const ta = chatTextareaRef.current;
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    }, 50);
  };

  // Reset captured errors and fix-attempt counter whenever the preview reloads.
  useEffect(() => {
    setPreviewErrors([]);
    autoFixAttemptsRef.current = 0;
  }, [previewKey]);

  // Auto-trigger: when a runtime error appears and we're idle, fix it automatically
  // after a short delay. Cap at 2 attempts per preview load to avoid infinite loops.
  useEffect(() => {
    if (previewErrors.length === 0 || isStreaming || isAutoFixing) return;
    // Imported sites run the ORIGINAL site's JS through the proxy in a sandbox, which
    // throws expected/noise errors (CORS, missing globals, 404s). Auto-fixing on those
    // kicks off a full rebuild after every build — "it repeats everything". Skip them;
    // only auto-fix generated apps where a runtime error means our code is broken.
    if ((project?.description ?? "").startsWith("Imported from")) return;
    if (autoFixAttemptsRef.current >= 2) return;
    const timer = setTimeout(() => void handleAutoFix(), 2500);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewErrors, isStreaming, isAutoFixing, project]);

  // Start each project's preview on its home page (imported multi-page nav state).
  useEffect(() => {
    setPreviewPage(null);
  }, [projectId]);

  // Restore persisted build records (code panels) from localStorage when the project loads.
  // Saved inside the setBuildRecords updater in streamMessage so no timing race is possible.
  useEffect(() => {
    if (!projectId) return;
    setBuildRecords([]);
    try {
      const stored = localStorage.getItem(`nebula_br_${projectId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) setBuildRecords(parsed as BuildRecord[]);
      }
    } catch { /* ignore corrupt data */ }
  }, [projectId]);

  // Promote the "pending" build record saved by finalizeStream once the assistant
  // message id is known (after React Query refetches messages). This ensures the
  // last build's code panels survive navigation even if the user never sends another
  // message (which is when streamMessage would normally archive the record).
  useEffect(() => {
    if (!projectId || isStreaming) return;
    const pendingKey = `nebula_br_pending_${projectId}`;
    let pending: BuildRecord | null = null;
    try {
      const stored = localStorage.getItem(pendingKey);
      if (stored) pending = JSON.parse(stored) as BuildRecord;
    } catch { localStorage.removeItem(pendingKey); return; }
    if (!pending) return;
    const lastAssistantId = messages?.filter(m => m.role === "assistant").at(-1)?.id ?? null;
    if (!lastAssistantId) return;
    const promoted: BuildRecord = { ...pending, assistantMsgId: lastAssistantId };
    setBuildRecords(prev => {
      if (prev.some(r => r.assistantMsgId === lastAssistantId)) return prev;
      const next = [...prev, promoted];
      try { localStorage.setItem(`nebula_br_${projectId}`, JSON.stringify(next)); } catch {}
      return next;
    });
    try { localStorage.removeItem(pendingKey); } catch {}
  }, [messages, projectId, isStreaming]);

  // The build now runs DETACHED on the server, so a refresh, navigation, or a
  // dropped SSE connection no longer wastes it — the build keeps running and
  // persists, and the client just (re)attaches to its progress. Unmounting only
  // closes our local connection; the server build lives on.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Consume one SSE stream (the initial POST or a reconnect GET). The server
  // replays its FULL progress buffer on every (re)connect, so callers reset the
  // accumulators before each attempt to avoid double-counting. Returns how the
  // stream ended so the driver can decide whether to reconnect.
  const consumeStream = useCallback(
    async (body: ReadableStream<Uint8Array>): Promise<"terminal" | "idle" | "dropped"> => {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let outcome: "terminal" | "idle" | "dropped" = "dropped";

      const handleEvent = (line: string) => {
        if (!line.startsWith("data:")) return;
        let event: { type: string; message?: string; path?: string; text?: string };
        try {
          event = JSON.parse(line.slice(5).trim());
        } catch {
          return;
        }
        if (event.type === "delta" && typeof event.text === "string") {
          rawStreamRef.current += event.text;
        } else if (event.type === "status" && typeof event.message === "string") {
          setLiveStatus(event.message);
        } else if (event.type === "code_start") {
          setLiveCodeBuf("");
          setActiveTab("code"); // surface the code panel so the user watches it being written
        } else if (event.type === "code_delta" && typeof event.text === "string") {
          setLiveCodeBuf((prev) => (prev ?? "") + event.text);
        } else if (event.type === "code_end") {
          // Keep the finished buffer visible until the file is saved and the real file loads.
        } else if (event.type === "agent") {
          const ae = event as unknown as AgentEvt;
          if (ae.event) {
            setAgentEvents((prev) => [...prev, ae]);
            if (ae.event === "file_saved") {
              setFilesWritten((n) => n + 1);
              setLiveStatus(null);
              setLiveCodeBuf(null);
              if (ae.path) setSelectedFile(ae.path); // follow along: show the just-saved file
              queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
              setPreviewKey((k) => k + 1);
            }
          }
        } else if (event.type === "error") {
          setBuildError(event.message ?? "Something went wrong");
          outcome = "terminal";
        } else if (event.type === "done") {
          const doneEv = event as { type: string; cancelled?: boolean };
          if (!doneEv.cancelled) setBuildSucceeded(true);
          outcome = "terminal";
        } else if (event.type === "idle") {
          outcome = "idle";
        }
      };

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) handleEvent(part.trim());
      }
      if (buffer.trim()) handleEvent(buffer.trim());
      return outcome;
    },
    [projectId, queryClient]
  );

  const finalizeStream = useCallback(async () => {
    abortRef.current = null;
    // Reveal any remaining buffered tail so the final narration isn't cut off.
    shownLenRef.current = rawStreamRef.current.length;
    setStreamedText(rawStreamRef.current);
    setIsStopping(false);
    setLiveStatus(null);
    setLiveCodeBuf(null);
    setPendingImages([]);
    if (projectId) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(projectId) }),
        queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) }),
        queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) }),
      ]);
    }
    // Flip streaming OFF only AFTER the persisted assistant message has been refetched,
    // so the live narration segments (gated on isStreaming) hand off to the saved message
    // without a gap or a duplicate.
    setIsStreaming(false);
    setPendingUser(null);
    setPreviewKey((k) => k + 1);
    // Build finished: if files were actually written, switch back to the preview so the
    // user sees the live result (they watched the code stream in during the build).
    if (agentEventsRef.current.some((ev) => ev.event === "file_saved")) {
      setActiveTab("preview");
    }
    // Save a pending record immediately so panels survive if the user navigates away
    // without sending another message. The promotion useEffect resolves assistantMsgId
    // once React Query delivers the refetched messages.
    if (projectId) {
      const hasBuildOutput = /\nFILE:|\nPATCH:/m.test(streamedTextRef.current) ||
        agentEventsRef.current.some(ev => ev.event === "file_saved");
      if (hasBuildOutput) {
        const pendingRecord: BuildRecord = {
          assistantMsgId: null,
          events: [...agentEventsRef.current],
          segments: parseStreamSegments(streamedTextRef.current).map(s =>
            (s.kind === "file" || s.kind === "patch") ? { ...s, code: (s.code ?? "").slice(0, 400) } : s
          ),
          succeeded: buildSucceededRef.current,
        };
        try { localStorage.setItem(`nebula_br_pending_${projectId}`, JSON.stringify(pendingRecord)); } catch { /* quota */ }
      }
    }
  }, [projectId, queryClient]);

  // Drive a build to completion across reconnects. A non-null `postBody` starts a
  // new build (POST); null attaches to a build already running on the server (GET).
  // If the connection drops mid-build we reconnect and replay until we see a
  // terminal event, the server reports the build is no longer running, or we
  // exhaust the retry budget.
  const drive = useCallback(
    async (postBody: { content: string; images?: string[] } | null) => {
      if (!projectId) return;
      let first = postBody !== null;
      let attempts = 0;
      const MAX_RECONNECTS = 30;
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const ac = new AbortController();
          abortRef.current = ac;
          // The server replays the FULL buffer on every (re)connect; start each
          // attempt clean so files/text aren't double-counted.
          // streamedText is cleared here because streamMessage has already committed
          // the previous build's output to buildRecords before calling drive.
          rawStreamRef.current = "";
          shownLenRef.current = 0;
          setStreamedText("");
          setFilesWritten(0);
          setLiveStatus("Verzoek analyseren…");
          setLiveCodeBuf(null);
          setBuildError(null);
          setBuildSucceeded(false);
          setAgentEvents([]);
          setExpandedCodeIndices(new Set());
          setExpandedSegIndices(new Set());
          setCodeDiffMode(false);
          // Snapshot current file contents so the diff view can show what changed
          setPreBuildSnapshot(new Map((files ?? []).map((f: { path: string; content: string }) => [f.path, f.content])));

          let res: Response;
          try {
            res = first
              ? await fetch(`/api/projects/${projectId}/messages/stream`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(postBody),
                  signal: ac.signal,
                })
              : await fetch(`/api/projects/${projectId}/build/stream`, { signal: ac.signal });
          } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") return;
            first = false;
            if (++attempts > MAX_RECONNECTS) {
              setBuildError("Something went wrong while building");
              break;
            }
            await sleep(1000);
            continue;
          }

          if (!res.ok || !res.body) {
            first = false;
            if (++attempts > MAX_RECONNECTS) {
              setBuildError("Something went wrong while building");
              break;
            }
            await sleep(1000);
            continue;
          }

          let outcome: "terminal" | "idle" | "dropped";
          try {
            outcome = await consumeStream(res.body);
          } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") return;
            outcome = "dropped";
          }

          if (outcome === "terminal" || outcome === "idle") break;

          // Dropped mid-build — reconnect only if the server is still building.
          first = false;
          if (++attempts > MAX_RECONNECTS) break;
          try {
            const st = await fetch(`/api/projects/${projectId}/build/status`).then((r) => r.json());
            if (!st?.running) break;
          } catch {
            /* status check failed; try to reconnect anyway */
          }
          await sleep(1000);
        }
      } finally {
        await finalizeStream();
      }
    },
    [projectId, consumeStream, finalizeStream]
  );

  const streamMessage = useCallback(
    async (messageContent: string, images: string[] = []) => {
      if (!projectId) return;
      // Only replace prev panels when the current build actually produced output
      // (either FILE:/PATCH: blocks from old-style streaming, or file_saved events
      // from the new tool-use agentic loop). Conversational replies have neither,
      // so they don't clobber the saved code panels.
      const currentHasBuildOutput =
        /\nFILE:|\nPATCH:/m.test(streamedTextRef.current) ||
        agentEventsRef.current.some(ev => ev.event === "file_saved");
      if (currentHasBuildOutput) {
        // Capture which assistant message this build belongs to so panels stay anchored.
        const assistantMsgId =
          messagesRef.current?.filter(m => m.role === "assistant").at(-1)?.id ?? null;
        const newRecord: BuildRecord = {
          assistantMsgId,
          events: [...agentEventsRef.current],
          // Truncate code blocks before storing so localStorage stays small.
          segments: parseStreamSegments(streamedTextRef.current).map(s =>
            (s.kind === "file" || s.kind === "patch") ? { ...s, code: (s.code ?? "").slice(0, 400) } : s
          ),
          succeeded: buildSucceededRef.current,
        };
        setBuildRecords(prev => {
          // The promotion useEffect may have already added this record when messages
          // refetched after the previous build. Avoid duplicating it.
          if (assistantMsgId !== null && prev.some(r => r.assistantMsgId === assistantMsgId)) return prev;
          const next = [...prev, newRecord];
          try { localStorage.setItem(`nebula_br_${projectId}`, JSON.stringify(next)); } catch { /* quota */ }
          return next;
        });
        // Clear the pending record — it's now been committed to the main store.
        try { localStorage.removeItem(`nebula_br_pending_${projectId}`); } catch { /* ignore */ }
      }
      setIsStreaming(true);
      setBuildError(null);
      setPendingUser(messageContent);
      setPendingImages(images);
      pendingBaseRef.current = messagesLenRef.current;
      setPreviewErrors([]);
      setElapsedSec(0);
      setActiveTab("code"); // show the live code panel while building; switch back to preview when done
      await drive(
        images.length > 0 ? { content: messageContent, images } : { content: messageContent }
      );
    },
    [projectId, drive]
  );

  // On (re)load, if a build is already running on the server for this project,
  // reattach to its live progress instead of showing a static, seemingly-idle UI.
  // This is what makes a mid-build refresh (or a proxy-dropped connection) recover
  // gracefully rather than looking "stuck".
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      if (abortRef.current) return; // already driving a build in this tab
      try {
        const st = await fetch(`/api/projects/${projectId}/build/status`).then((r) => r.json());
        if (cancelled || abortRef.current || !st?.running) return;
        setIsStreaming(true);
        setElapsedSec(0);
        setActiveTab("preview");
        void drive(null);
      } catch {
        /* status unknown; leave the UI idle */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, drive]);

  // Auto-send initial prompt from the home page (stored in sessionStorage)
  useEffect(() => {
    if (!projectId || messages === undefined || isStreaming || autoSentRef.current) return;
    if (messages.length !== 0) return;
    const key = `initial-prompt-${projectId}`;
    const imgKey = `initial-images-${projectId}`;
    const initialPrompt = sessionStorage.getItem(key) ?? "";
    let initialImages: string[] = [];
    try {
      const raw = sessionStorage.getItem(imgKey);
      if (raw) initialImages = JSON.parse(raw) as string[];
    } catch {
      initialImages = [];
    }
    const text = initialPrompt.trim()
      ? initialPrompt
      : initialImages.length > 0
        ? REFERENCE_IMAGE_PROMPT
        : "";
    if (!text) return;
    autoSentRef.current = true;
    sessionStorage.removeItem(key);
    sessionStorage.removeItem(imgKey);
    void streamMessage(text, initialImages);
  }, [messages, projectId, isStreaming, streamMessage]);

  // Reliable path first: a text-only request is offered to the deterministic command system
  // (AI classifies intent → hardcoded function executes). If it's a recognised simple action
  // (add/remove/rename a nav item, create a page) it's done instantly and reliably — no
  // HTML-generating AI build. Anything else falls back to the normal AI build.
  const sendMessage = useCallback(
    async (content: string, images: string[]) => {
      if (!projectId) return;
      // Image + "background" intent → set the booking-app homepage background (no AI build).
      if (images.length > 0 && /achtergrond|background|homepagina|home\s*pagina|hero/i.test(content)) {
        setPendingUser(content);
        setLiveStatus("Achtergrond instellen…");
        try {
          const res = await fetch(`/api/projects/${projectId}/booking-bg`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: images[0] }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data?.handled) {
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(projectId) }),
                queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) }),
              ]);
              setPendingUser(null);
              setLiveStatus(null);
              setPreviewKey((k) => k + 1);
              return; // handled deterministically — skip the AI build
            }
          }
        } catch {
          /* fall through to the AI build */
        }
        setPendingUser(null);
        setLiveStatus(null);
      }
      if (images.length === 0 && content.trim()) {
        setPendingUser(content);
        setLiveStatus("Bewerking uitvoeren…");
        try {
          const res = await fetch(`/api/projects/${projectId}/command`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: content }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data?.handled) {
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(projectId) }),
                queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) }),
              ]);
              setPendingUser(null);
              setLiveStatus(null);
              setPreviewKey((k) => k + 1);
              return; // handled deterministically — skip the AI build
            }
          }
        } catch {
          /* command route failed — fall through to the AI build */
        }
        setPendingUser(null);
        setLiveStatus(null);
      }
      void streamMessage(content, images);
    },
    [projectId, queryClient, streamMessage],
  );

  const handleSendMessage = () => {
    if ((!prompt.trim() && attachedImages.length === 0) || !projectId || isStreaming) return;
    const images = attachedImages.map((img) => img.dataUrl);
    const content = prompt.trim()
      ? prompt
      : images.length > 0
        ? REFERENCE_IMAGE_PROMPT
        : "";
    setPrompt("");
    setAttachedImages([]);
    void sendMessage(content, images);
  };

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    userScrolledUpRef.current = el.scrollHeight - el.scrollTop - el.clientHeight > 150;
  }, []);

  const addImageFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    const processed = await Promise.all(imageFiles.map(fileToReferenceImage));
    setAttachedImages((prev) => [...prev, ...processed].slice(0, MAX_ATTACHED_IMAGES));
  }, []);

  const handleImageInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    void addImageFiles(files);
    e.target.value = "";
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files ?? []);
    if (files.some((f) => f.type.startsWith("image/"))) {
      void addImageFiles(files);
    }
  };

  const removeAttachedImage = (id: string) => {
    setAttachedImages((prev) => prev.filter((img) => img.id !== id));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleAutoFix = useCallback(async () => {
    if (isStreaming || isAutoFixing || !projectId || previewErrors.length === 0) return;
    const errText = previewErrors.join("; ");
    setPreviewErrors([]);
    setIsAutoFixing(true);
    autoFixAttemptsRef.current += 1;
    try {
      const res = await fetch(`/api/projects/${projectId}/messages/fix-error`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: errText }),
      });
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6)) as Record<string, unknown>;
            if (ev.type === "file" && ev.path) {
              queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
              setPreviewKey((k) => k + 1);
            }
            if (ev.type === "done") {
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) }),
                queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(projectId) }),
              ]);
              setPreviewKey((k) => k + 1);
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch { /* network error — silently ignore */ }
    finally {
      setIsAutoFixing(false);
    }
  }, [projectId, previewErrors, isStreaming, isAutoFixing, queryClient]);

  const handleStop = () => {
    if (isStopping) return;
    setIsStopping(true);
    if (projectId) {
      void fetch(`/api/projects/${projectId}/build/cancel`, { method: "POST" });
    }
    abortRef.current?.abort();
  };

  const handleRestoreLastBuild = useCallback(async () => {
    if (isRestoring || !projectId) return;
    // Restore uses the CURRENT build's events (the button only appears during/after the active build)
    const savedPaths = agentEventsRef.current
      .filter(ev => ev.event === "file_saved")
      .map(ev => ev.path);
    if (savedPaths.length === 0) return;

    setIsRestoring(true);
    try {
      for (const path of savedPaths) {
        const oldContent = preBuildSnapshot.get(path);
        if (oldContent !== undefined) {
          await fetch(`/api/projects/${projectId}/files/${encodeURIComponent(path)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: oldContent }),
          });
        } else {
          await fetch(`/api/projects/${projectId}/files/${encodeURIComponent(path)}`, {
            method: "DELETE",
          });
        }
      }
      await queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
    } finally {
      setIsRestoring(false);
    }
  }, [isRestoring, projectId, preBuildSnapshot, queryClient]);

  const handleExtractComponents = useCallback(async () => {
    if (isExtracting || !projectId) return;
    setIsExtracting(true);
    setExtractionResult(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/extract-components`, { method: "POST" });
      const data = await r.json() as { created: { path: string; source: string }[]; canonical: string };
      if (data.created?.length > 0) {
        await queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
        setExtractionResult(data);
      }
    } catch { /* network error — silently ignore */ }
    finally { setIsExtracting(false); }
  }, [isExtracting, projectId, queryClient]);

  const activeFile = files?.find((f) => f.path === selectedFile);
  // Live code being streamed right now (null when no write is in flight).
  const liveCode = liveCodeBuf !== null ? extractLiveCode(liveCodeBuf) : null;
  // Keep ref in sync so the (stable) postMessage handler can resolve clicked paths
  knownFilePathsRef.current = new Set(files?.map((f) => f.path) ?? []);
  const isImported = (project?.description ?? "").startsWith("Imported from");

  // Files changed in the last build (from file_saved agent events)
  const changedFilePaths = new Set(
    agentEvents.filter(ev => ev.event === "file_saved").map(ev => ev.path)
  );
  const activeFileWasChanged = !!selectedFile && changedFilePaths.has(selectedFile);

  // Live "currently working on" file — the most recent file the agent touched
  // (read/target/patch) that has not yet produced a file_saved. Shows the user
  // WHICH file is being edited while the build is still running.
  const workingFilePath = (() => {
    if (!isStreaming) return null;
    for (let i = agentEvents.length - 1; i >= 0; i--) {
      const ev = agentEvents[i];
      if (ev.event === "file_saved") return null; // last action was a save — nothing in-flight
      if (ev.event === "file_read" || ev.event === "target_found" || ev.event === "patch_created" || ev.event === "patch_applied") {
        return ev.path;
      }
    }
    return null;
  })();

  const goToDiff = useCallback((filePath: string) => {
    setActiveTab("code");
    setSelectedFile(filePath);
    setCodeDiffMode(true);
    setActiveDiffHunks(new Set());
  }, []);

  const handleDownload = useCallback(async () => {
    if (!files || files.length === 0) return;
    setIsDownloading(true);
    try {
      const zip = new JSZip();
      // For imported WordPress/Astra/Elementor sites, export a WordPress-
      // importable package: a WXR (.xml) file with every page (title, slug,
      // content, meta description, internal links) plus a Dutch README with
      // import steps. Falls back to the plain formatted source for anything
      // that isn't a supported import.
      const wp = buildWordPressExport(files, project?.name);
      if (wp) {
        for (const [path, content] of wp) zip.file(path, content);
      } else {
        // Inline data-include components so the exported HTML works on any web server
        // without needing the Nebula preview pipeline.
        const processed = processFilesForExport(files);
        await Promise.all(
          files.map(async (f) => {
            const raw = processed.get(f.path) ?? f.content ?? "";
            const content = await formatFileContent(f.path, raw);
            zip.file(f.path, content);
          }),
        );
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const safeName =
        (project?.name ?? "project")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "project";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setIsDownloading(false);
    }
  }, [files, project?.name]);
  const previewHtml = buildPreviewHtml(files, isImported, previewPage);

  // Computed from streamedText — handles FILE: and PATCH: blocks interleaved with narration text.
  const streamSegments = useMemo(() => parseStreamSegments(streamedText), [streamedText]);

  // For the blinking cursor: show on the last text segment while streaming
  const lastSegmentIsText = streamSegments.length > 0 && streamSegments[streamSegments.length - 1].kind === "text";
  const showCursor = isStreaming && lastSegmentIsText;

  // The server persists the user message immediately, so a mid-build refetch of
  // `messages` can momentarily contain it alongside our optimistic copy. Drop the
  // optimistic bubble only once a NEW persisted user message has landed (count
  // grew past the pre-send baseline), so identical re-prompts still show.
  const lastMsg = messages?.[messages.length - 1];
  const persistedArrived =
    (messages?.length ?? 0) > pendingBaseRef.current &&
    lastMsg?.role === "user" &&
    lastMsg.content === pendingUser;
  const showPendingUser = pendingUser !== null && !persistedArrived;

  if (isLoadingProject) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center">
          <FolderOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-2xl font-bold">Project not found</h2>
          <Link href="/projects" className="text-primary hover:underline mt-4 inline-block">
            Return to projects
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh)] overflow-hidden bg-background">
      {/* Top Bar */}
      <header className="h-14 border-b border-border bg-card/50 flex items-center px-4 shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/projects">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2 border-l border-border/50 pl-4">
            <h1 className="font-semibold text-sm">{project.name}</h1>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {pubData?.published && (
            pubData?.hasChanges
              ? <span className="text-[11px] text-amber-600 flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Niet-gepubliceerde wijzigingen</span>
              : <span className="text-[11px] text-emerald-600 flex items-center gap-1"><Check className="h-3 w-3" /> Gepubliceerd</span>
          )}
          <Button
            size="sm"
            className="h-8 gap-2 bg-emerald-600 hover:bg-emerald-500 text-white"
            data-testid="button-publish"
            onClick={() => {
              setPublishOpen(true);
              setPubBusy(true);
              fetch(`/api/projects/${projectId}/publish`)
                .then((r) => r.json())
                .then((d) => { setPubData(d); setPubSlug(d?.subdomain ? String(d.subdomain.domain).split(".")[0] : ""); })
                .catch(() => {})
                .finally(() => setPubBusy(false));
            }}
          >
            <Rocket className="h-4 w-4" /> {pubData?.published && pubData?.hasChanges ? "Republiceren" : "Publiceren"}
          </Button>
        </div>
      </header>

      {publishOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onClick={() => { if (!pubBusy) setPublishOpen(false); }}>
          <div className="w-[min(620px,96%)] max-h-[88vh] overflow-y-auto rounded-xl bg-background border shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2"><Rocket className="h-5 w-5 text-emerald-600" /> Publiceren</h3>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPublishOpen(false)}><X className="h-4 w-4" /></Button>
            </div>

            {/* 1. Free Nebula subdomain */}
            <div className="rounded-lg border p-4 mb-4">
              <div className="flex items-center gap-2 mb-1"><Globe className="h-4 w-4 text-muted-foreground" /><h4 className="font-medium text-sm">Gratis Nebula-adres</h4></div>
              {pubData?.subdomain ? (
                <div className="mb-3">
                  <p className="text-xs text-muted-foreground mb-1">Je site is live op:</p>
                  <div className="flex items-center gap-2">
                    <a href={`https://${pubData.subdomain.domain}`} target="_blank" rel="noopener" className="text-sm font-medium text-emerald-600 hover:underline break-all">{pubData.subdomain.domain}</a>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigator.clipboard?.writeText(`https://${pubData.subdomain.domain}`)}><Copy className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground mb-3">Kies een adres en zet je site direct live — geen eigen domein nodig.</p>
              )}
              <label className="block text-xs text-muted-foreground mb-1">Adres</label>
              <div className="flex items-center gap-1">
                <input className="flex-1 rounded-md border bg-background px-3 py-2 text-sm" value={pubSlug} onChange={(e) => setPubSlug(e.target.value)} placeholder="mijn-studio" data-testid="input-pub-slug" />
                <span className="text-sm text-muted-foreground">.{pubData?.platformHost || "nebulabookings.com"}</span>
              </div>
              <div className="mt-3">
                <Button size="sm" disabled={pubBusy} data-testid="button-do-publish" className="bg-emerald-600 hover:bg-emerald-500 text-white"
                  onClick={async () => {
                    setPubBusy(true);
                    try {
                      const res = await fetch(`/api/projects/${projectId}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: pubSlug }) });
                      const d = await res.json();
                      if (res.ok && d.ok) { await reloadPublish(); } else window.alert(d.error || "Publiceren mislukt.");
                    } catch { window.alert("Publiceren mislukt."); }
                    finally { setPubBusy(false); }
                  }}>
                  {pubBusy ? "Bezig…" : pubData?.subdomain ? "Opnieuw publiceren" : "Publiceren"}
                </Button>
              </div>
            </div>

            {/* 2. Own domain */}
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 mb-1"><Globe className="h-4 w-4 text-muted-foreground" /><h4 className="font-medium text-sm">Eigen domein</h4></div>
              <p className="text-xs text-muted-foreground mb-3">Koppel je eigen domein (bijv. jouwstudio.nl). Voeg bij je DNS-provider een CNAME toe naar <code className="bg-muted px-1 rounded">{pubData?.target || "customers.nebulabookings.com"}</code> en klik daarna op Verifiëren. SSL gaat automatisch.</p>
              {(pubData?.domains || []).map((d: any) => (
                <div key={d.id} className="flex items-center justify-between gap-2 border rounded-md px-3 py-2 mb-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium break-all">{d.domain}</div>
                    <div className={`text-[11px] ${d.status === "active" ? "text-emerald-600" : "text-amber-600"}`}>{d.status === "active" ? "● Live (SSL actief)" : "○ Wacht op DNS — voeg de CNAME toe"}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {d.status !== "active" && (
                      <Button variant="outline" size="sm" className="h-7" disabled={pubBusy} onClick={async () => {
                        setPubBusy(true);
                        try { const r = await fetch(`/api/projects/${projectId}/domains/${d.id}/verify`, { method: "POST" }); const j = await r.json(); if (!j.ok) window.alert(j.detail || "Nog niet geverifieerd."); await reloadPublish(); } catch { /* ignore */ } finally { setPubBusy(false); }
                      }}>Verifiëren</Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" disabled={pubBusy} onClick={async () => {
                      if (!window.confirm("Dit domein loskoppelen?")) return;
                      setPubBusy(true);
                      try { await fetch(`/api/projects/${projectId}/domains/${d.id}`, { method: "DELETE" }); await reloadPublish(); } catch { /* ignore */ } finally { setPubBusy(false); }
                    }}><X className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-2 mt-2">
                <input className="flex-1 rounded-md border bg-background px-3 py-2 text-sm" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="jouwstudio.nl" data-testid="input-new-domain" />
                <Button size="sm" disabled={pubBusy || !newDomain.trim()} onClick={async () => {
                  setPubBusy(true);
                  try {
                    const res = await fetch(`/api/projects/${projectId}/domains`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain: newDomain.trim() }) });
                    const d = await res.json();
                    if (res.ok && d.ok) { setNewDomain(""); await reloadPublish(); } else window.alert(d.error || "Koppelen mislukt.");
                  } catch { window.alert("Koppelen mislukt."); }
                  finally { setPubBusy(false); }
                }}>Koppelen</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Chat */}
        <div className="w-[380px] border-r border-border bg-card/30 flex flex-col shrink-0">
          <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4" onScroll={handleChatScroll}>
            <div className="space-y-5 pb-4">
              {isLoadingMessages ? (
                <div className="flex justify-center p-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : messages?.length === 0 && !isStreaming ? (
                <div className="p-5 text-sm border border-border/60 rounded-2xl bg-card/60 space-y-4">
                  <div>
                    <div className="font-semibold text-foreground flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Begin hier</div>
                    <p className="text-muted-foreground mt-1">Vraag de chat om iets te bouwen of aan te passen. Bijvoorbeeld een boekingssysteem in je website:</p>
                    <div className="mt-2 rounded-lg bg-muted/60 px-3 py-2 font-mono text-[12px] text-foreground/80">Voeg een boekingssysteem toe aan mijn website</div>
                  </div>
                  <div>
                    <div className="font-medium text-foreground">Je admin-account instellen</div>
                    <p className="text-muted-foreground mt-1">Wil je later kunnen inloggen op je boekingsbeheer? Typ in de chat:</p>
                    <div className="mt-2 rounded-lg bg-muted/60 px-3 py-2 font-mono text-[12px] text-foreground/80">admin gebruikersnaam jouwmail@gmail.com wachtwoord</div>
                    <p className="text-muted-foreground mt-1 text-xs">Daarmee maak je de beheerder-login aan waarmee je op het boekingssysteem inlogt.</p>
                  </div>
                  <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-3">
                    <div className="font-medium text-amber-900">Voordat je systeem werkt — 2 stappen</div>
                    <p className="text-amber-900/80 mt-1">Doe deze in je boekingssysteem op het tabblad <span className="font-semibold">Integraties</span>:</p>
                    <ul className="text-amber-900/80 mt-2 space-y-1.5 list-disc pl-4">
                      <li><span className="font-semibold">Koppel Stripe</span> via de knop bij Integraties — anders kunnen klanten niet betalen.</li>
                      <li><span className="font-semibold">Vul je bedrijfsgegevens in</span> (bedrijfsnaam, KvK, BTW, adres) bij Integraties — zonder dit worden er geen automatische facturen gemaakt of gemaild.</li>
                    </ul>
                  </div>
                </div>
              ) : (
                messages?.map((msg) => {
                  if (msg.role === "user") {
                    return (
                      <div key={msg.id} className="flex justify-end">
                        <div className="text-sm rounded-lg px-3.5 py-2 max-w-[90%] whitespace-pre-wrap bg-primary/10 text-foreground">
                          {msg.content}
                        </div>
                      </div>
                    );
                  }
                  const record = buildRecords.find(r => r.assistantMsgId === msg.id);
                  return (
                    <Fragment key={msg.id}>
                      <div className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                        {cleanContent(msg.content)}
                      </div>
                      {record && (
                        <>
                          {record.segments.map((seg, i) => {
                            // The narration text is already shown via msg.content above, so
                            // never render the record's text segments (would duplicate it).
                            if (seg.kind === "text") {
                              return null;
                            }
                            // The file_saved EVENTS below already list every saved file. If we
                            // ALSO rendered FILE/PATCH segment panels we'd show each file twice
                            // ("dubbele code panels"). So only fall back to segment panels for
                            // LEGACY records that have no file_saved events.
                            const hasFileEvents = record.events.some((e) => e.event === "file_saved");
                            if (hasFileEvents) {
                              return null;
                            }
                            if (seg.kind === "patch" || seg.kind === "file") {
                              const Icon = seg.kind === "patch" ? FileText : FileCode;
                              return (
                                <div key={`rec-seg-${i}`} className="rounded-lg border border-border/60 overflow-hidden cursor-pointer hover:bg-muted/10 transition-colors" onClick={() => goToDiff(seg.file)}>
                                  <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/40 border-b border-border/40">
                                    <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
                                    <span className="flex-1 font-mono text-xs text-muted-foreground truncate">{seg.file}</span>
                                    {seg.kind === "patch" && seg.op && (
                                      <span className="font-mono text-[10px] text-muted-foreground/60 shrink-0">
                                        {seg.op.replace(/_/g, " ")}
                                      </span>
                                    )}
                                    <ChevronRight className="h-3 w-3 shrink-0 text-emerald-500/70 ml-1" />
                                  </div>
                                  {seg.code && (
                                    <div className="max-h-44 overflow-y-auto bg-[#0d1117]">
                                      <pre className="p-3 text-[11px] leading-relaxed font-mono text-gray-300 whitespace-pre overflow-x-auto">
                                        <code>{seg.code}</code>
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              );
                            }
                            return null;
                          })}
                          {record.events.length > 0 && (
                            <div className="space-y-1">
                              {record.events.map((ev, i) => {
                                if (ev.event === "file_saved") {
                                  return (
                                    <div key={`ev-${i}`} className="rounded-lg border border-border/60 bg-card/60 text-xs overflow-hidden">
                                      <div className="px-3 py-2.5 space-y-1.5">
                                        <div className="flex items-center gap-2 font-medium text-foreground/90">
                                          <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                                          <span className="truncate">{ev.path}</span>
                                          <span className={`shrink-0 font-normal px-1.5 py-0.5 rounded text-[10px] ${
                                            ev.op === "create"
                                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                              : "bg-primary/10 text-primary"
                                          }`}>
                                            {ev.op === "create" ? "nieuw" : "gewijzigd"}
                                          </span>
                                          <button
                                            onClick={() => goToDiff(ev.path)}
                                            className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-emerald-500/80 hover:text-emerald-400 transition-colors"
                                          >
                                            <Code2 className="h-3 w-3" />
                                            Bekijk diff
                                            <ChevronRight className="h-2.5 w-2.5" />
                                          </button>
                                        </div>
                                        {ev.summary && (
                                          <p className="pl-5 text-muted-foreground leading-snug">{ev.summary}</p>
                                        )}
                                        <div className="flex gap-3 text-[10px] pl-5">
                                          <span className="text-emerald-600">+{ev.linesAdded} regels</span>
                                          {ev.linesRemoved > 0 && <span className="text-rose-500">−{ev.linesRemoved}</span>}
                                        </div>
                                        {ev.symbols.length > 0 && (
                                          <div className="pl-5 flex flex-wrap gap-x-2 gap-y-0.5 text-muted-foreground/70 font-mono text-[10px]">
                                            {ev.symbols.map((s, j) => <span key={j}>{s}</span>)}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                }
                                if (ev.event === "validation_error") {
                                  if (
                                    ev.error.toLowerCase().includes("ankerpunt") ||
                                    ev.error.toLowerCase().includes("niet gevonden")
                                  ) return null;
                                  return (
                                    <div key={`ev-verr-${i}`} className="flex items-center gap-2 text-xs text-rose-500 pl-1">
                                      <AlertTriangle className="h-3 w-3 shrink-0" />
                                      <span className="font-mono">{ev.path}</span>
                                      <span className="text-rose-400">— {ev.error}</span>
                                    </div>
                                  );
                                }
                                return null;
                              })}
                            </div>
                          )}
                        </>
                      )}
                    </Fragment>
                  );
                })
              )}

              {/* Optimistic pending user message */}
              {showPendingUser && (
                <div className="flex flex-col items-end gap-1.5">
                  {pendingImages.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-1.5 max-w-[90%]">
                      {pendingImages.map((src, i) => (
                        <img
                          key={i}
                          src={src}
                          alt="attached reference"
                          className="h-16 w-16 rounded-md object-cover border border-border"
                        />
                      ))}
                    </div>
                  )}
                  {pendingUser && (
                    <div className="text-sm rounded-lg px-3.5 py-2 max-w-[90%] whitespace-pre-wrap bg-primary/10 text-foreground">
                      {pendingUser}
                    </div>
                  )}
                </div>
              )}

              {/* Interleaved stream: model narration + per-file code panels */}
              {isStreaming && streamSegments.length === 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                  <span>Bezig…</span>
                </div>
              )}

              {/* Interleaved narration text + FILE/PATCH code panels — ONLY while streaming.
                  Once the build finishes, the persisted assistant message + its buildRecord
                  render the same content (above), so showing these too would duplicate it. */}
              {isStreaming && streamSegments.map((seg, i) => {
                if (seg.kind === "text") {
                  const display = stripMarkdown(seg.content);
                  if (!display) return null;
                  return (
                    <div key={i} className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                      {display}
                      {showCursor && i === streamSegments.length - 1 && (
                        <span className="inline-block w-1.5 h-[1em] ml-0.5 -mb-[0.1em] bg-primary/70 animate-pulse align-middle" />
                      )}
                    </div>
                  );
                }

                if (seg.kind === "patch" || seg.kind === "file") {
                  const isSegExpanded = expandedSegIndices.has(i);
                  const canNavigate = !seg.active && !isStreaming;
                  const Icon = seg.kind === "patch" ? FileText : FileCode;
                  const toggleSeg = () => {
                    if (seg.active) return;
                    if (canNavigate) {
                      goToDiff(seg.file);
                    } else {
                      setExpandedSegIndices(prev => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i); else next.add(i);
                        return next;
                      });
                    }
                  };
                  return (
                    <div key={i} className="rounded-lg border border-border/60 overflow-hidden">
                      <div
                        className={`flex items-center gap-2 px-3 py-1.5 bg-muted/40 border-b border-border/40 ${!seg.active ? "cursor-pointer hover:bg-muted/60 transition-colors" : ""}`}
                        onClick={toggleSeg}
                      >
                        <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="flex-1 font-mono text-xs text-muted-foreground truncate">{seg.file}</span>
                        {seg.kind === "patch" && seg.op && (
                          <span className="font-mono text-[10px] text-muted-foreground/60 shrink-0">
                            {seg.op.replace(/_/g, " ")}
                          </span>
                        )}
                        {seg.active
                          ? <Loader2 className="h-3 w-3 animate-spin shrink-0 text-muted-foreground ml-1" />
                          : canNavigate
                            ? <ChevronRight className="h-3 w-3 shrink-0 text-emerald-500/70 ml-1" />
                            : isSegExpanded
                              ? <ChevronUp className="h-3 w-3 shrink-0 text-muted-foreground ml-1" />
                              : <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground ml-1" />}
                      </div>
                      {seg.code && !isSegExpanded && (
                        <div className="max-h-44 overflow-y-auto bg-[#0d1117] cursor-pointer" onClick={toggleSeg}>
                          <pre className="p-3 text-[11px] leading-relaxed font-mono text-gray-300 whitespace-pre overflow-x-auto">
                            <code>{seg.code}</code>
                          </pre>
                        </div>
                      )}
                      {seg.code && isSegExpanded && (
                        <div className="overflow-auto bg-[#0d1117]">
                          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5 text-[10px] text-gray-500">
                            <span className="text-emerald-500/70">
                              +{seg.code.split("\n").length} regels toegevoegd
                            </span>
                            {!isStreaming && (
                              <button
                                onClick={e => { e.stopPropagation(); setActiveTab("preview"); }}
                                className="ml-auto text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1"
                              >
                                <MonitorPlay className="h-3 w-3" />
                                Bekijk in preview
                              </button>
                            )}
                          </div>
                          <pre className="p-3 text-[11px] leading-relaxed font-mono m-0">
                            {seg.code.split("\n").map((line, j) => (
                              <div key={j} className="flex bg-emerald-950/30">
                                <span className="select-none w-10 text-right pr-3 text-gray-600 shrink-0">{j + 1}</span>
                                <span className="text-emerald-400 mr-2 shrink-0 select-none">+</span>
                                <span className="text-emerald-200 whitespace-pre">{line || " "}</span>
                              </div>
                            ))}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              })}

              {/* Live progress indicator — shows the current file or backend status so a
                  long first-file generation never looks frozen while no file is saved yet. */}
              {isStreaming && (workingFilePath || liveStatus) && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground pl-1 py-1">
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
                  {workingFilePath ? (
                    <>
                      <span>Bezig met</span>
                      <span className="font-mono text-foreground/80 truncate">{workingFilePath}</span>
                    </>
                  ) : (
                    <span className="truncate">{liveStatus}</span>
                  )}
                </div>
              )}

              {/* Agent event timeline — ONLY while streaming. After the build finishes, the
                  persisted assistant message renders these same file panels via its
                  buildRecord; showing the live timeline too would duplicate the code panels. */}
              {isStreaming && agentEvents.length > 0 && (
                <div className="space-y-1">
                  {agentEvents.map((ev, i) => {
                    if (ev.event === "file_saved") {
                      return (
                        <div key={i} className="rounded-lg border border-border/60 bg-card/60 text-xs overflow-hidden">
                          <div className="px-3 py-2.5 space-y-1.5">
                            <div className="flex items-center gap-2 font-medium text-foreground/90">
                              <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                              <span className="truncate">{ev.path}</span>
                              <span className={`shrink-0 font-normal px-1.5 py-0.5 rounded text-[10px] ${
                                ev.op === "create"
                                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                  : "bg-primary/10 text-primary"
                              }`}>
                                {ev.op === "create" ? "nieuw" : "gewijzigd"}
                              </span>
                              <button
                                onClick={() => goToDiff(ev.path)}
                                className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-emerald-500/80 hover:text-emerald-400 transition-colors"
                              >
                                <Code2 className="h-3 w-3" />
                                Bekijk diff
                                <ChevronRight className="h-2.5 w-2.5" />
                              </button>
                            </div>
                            {ev.summary && (
                              <p className="pl-5 text-muted-foreground leading-snug">{ev.summary}</p>
                            )}
                            <div className="flex gap-3 text-[10px] pl-5">
                              <span className="text-emerald-600">+{ev.linesAdded} regels</span>
                              {ev.linesRemoved > 0 && <span className="text-rose-500">−{ev.linesRemoved}</span>}
                            </div>
                            {ev.symbols.length > 0 && (
                              <div className="pl-5 flex flex-wrap gap-x-2 gap-y-0.5 text-muted-foreground/70 font-mono text-[10px]">
                                {ev.symbols.map((s, j) => <span key={j}>{s}</span>)}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }
                    if (ev.event === "validation_error") {
                      // Hide auto-retried anchor errors — they are expected and confusing to surface
                      if (
                        ev.error.toLowerCase().includes("ankerpunt") ||
                        ev.error.toLowerCase().includes("niet gevonden")
                      ) return null;
                      return (
                        <div key={i} className="flex items-center gap-2 text-xs text-rose-500 pl-1">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          <span className="font-mono">{ev.path}</span>
                          <span className="text-rose-400">— {ev.error}</span>
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              )}

              {/* Completion — only the unique "Herstel" action here. The "bekijk diff" button
                  is already shown per build in the assistant message's buildRecord above;
                  duplicating it here produced TWO identical "bestanden gewijzigd — bekijk diff"
                  buttons after a build. */}
              {buildSucceeded && !isStreaming && changedFilePaths.size > 0 && (
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <button
                    onClick={() => void handleRestoreLastBuild()}
                    disabled={isRestoring}
                    title="Herstel alle bestanden naar de staat vóór deze build"
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-orange-500/10 text-orange-600 dark:text-orange-400 hover:bg-orange-500/20 transition-colors font-medium disabled:opacity-50"
                  >
                    {isRestoring ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                    Herstel
                  </button>
                </div>
              )}

              {/* Build error surfaced inline (no technical detail during the build) */}
              {buildError && (
                <div className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                  <span>{buildError}</span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          <div className="px-3 pb-4 pt-2">
            {attachedImages.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {attachedImages.map((img) => (
                  <div
                    key={img.id}
                    className="relative h-16 w-16 rounded-md overflow-hidden border border-border group"
                  >
                    <img
                      src={img.dataUrl}
                      alt={img.name}
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeAttachedImage(img.id)}
                      className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-background/80 text-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove image"
                      data-testid={`button-remove-image-${img.id}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="relative rounded-[22px] border border-border bg-background shadow-lg transition focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/30">
              <Textarea
                ref={chatTextareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="Vraag Nebula om iets te bouwen of aan te passen…"
                className="pr-12 pl-11 min-h-[80px] max-h-[200px] resize-none bg-transparent border-0 shadow-none rounded-[22px] focus-visible:ring-0 focus-visible:ring-offset-0"
                disabled={isStreaming}
                data-testid="input-chat-prompt"
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleImageInput}
                data-testid="input-image-file"
              />
              <Button
                size="icon"
                variant="ghost"
                className="absolute bottom-3 left-3 h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming || attachedImages.length >= MAX_ATTACHED_IMAGES}
                title="Attach reference image"
                data-testid="button-attach-image"
              >
                <ImagePlus className="h-4 w-4" />
              </Button>
              {isStreaming ? (
                <Button
                  size="icon"
                  variant="destructive"
                  className="absolute bottom-3 right-3 h-8 w-8"
                  onClick={handleStop}
                  disabled={isStopping}
                  data-testid="button-stop"
                  title="Stop building"
                >
                  {isStopping
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Square className="h-3.5 w-3.5 fill-current" />}
                </Button>
              ) : (
                <Button
                  size="icon"
                  className="absolute bottom-3 right-3 h-8 w-8"
                  onClick={handleSendMessage}
                  disabled={!prompt.trim() && attachedImages.length === 0}
                  data-testid="button-send-message"
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="text-[10px] text-center text-muted-foreground mt-2">
              Enter to send · Shift+Enter for new line · attach or paste an image to match its style
            </div>
          </div>
        </div>

        {/* Center/Right Panel: Code & Preview */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-background">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "code" | "preview")}
            className="flex-1 flex flex-col min-h-0"
          >
            <div className="h-12 border-b border-border bg-card/50 flex items-center px-4 shrink-0">
              <TabsList className="bg-transparent h-auto p-0 gap-4">
                <TabsTrigger
                  value="preview"
                  className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none px-2 py-3 h-12 text-muted-foreground data-[state=active]:text-foreground"
                >
                  {isStreaming
                    ? <Loader2 className="h-4 w-4 mr-2 animate-spin text-primary" />
                    : <MonitorPlay className="h-4 w-4 mr-2" />}
                  Preview
                </TabsTrigger>
                <TabsTrigger
                  value="code"
                  className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none px-2 py-3 h-12 text-muted-foreground data-[state=active]:text-foreground"
                >
                  <Code2 className="h-4 w-4 mr-2" />
                  Code
                  {changedFilePaths.size > 0 && !isStreaming && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-500 leading-none">
                      {changedFilePaths.size}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>

              <div className="ml-auto flex items-center gap-1">
                {!isStreaming && activeTab === "preview" && previewHtml && (
                  <Button
                    variant={selectMode ? "default" : "ghost"}
                    size="sm"
                    className="h-8 text-muted-foreground hover:text-foreground data-[active=true]:text-primary-foreground"
                    data-active={selectMode}
                    onClick={() => setSelectMode((v) => !v)}
                    title="Klik op een element in de preview om het direct te bewerken"
                    data-testid="button-select-edit"
                  >
                    <MousePointerClick className="h-3.5 w-3.5 mr-1.5" />
                    {selectMode ? "Klaar met selecteren" : "Selecteer & bewerk"}
                  </Button>
                )}
                {/* Visuele editor — pagina-wisselaar (tabbladen) + nieuwe pagina toevoegen (AI-vrij). */}
                {!isStreaming && activeTab === "preview" && previewHtml && (() => {
                  const sitePages = (files ?? []).filter((f) => f.path.endsWith(".html") && !f.path.startsWith("components/") && f.path !== "booking-app.html");
                  return (
                    <>
                      {sitePages.length > 1 && (
                        <select
                          className="h-8 w-[112px] rounded-md border border-border bg-background px-2 text-sm text-muted-foreground truncate"
                          value={previewPage ?? "index.html"}
                          onChange={(e) => { setPreviewPage(e.target.value); setPreviewKey((k) => k + 1); }}
                          title="Wissel tussen pagina's"
                          data-testid="select-page"
                        >
                          {sitePages.map((f) => (<option key={f.path} value={f.path}>{f.path.replace(/^pages\//, "").replace(/\.html$/, "")}</option>))}
                        </select>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-muted-foreground hover:text-foreground"
                        title="Voeg een nieuwe pagina/tabblad toe (zonder AI)"
                        data-testid="button-add-page"
                        onClick={async () => {
                          const name = window.prompt("Naam van de nieuwe pagina (bijv. Over ons):");
                          if (!name || !name.trim()) return;
                          const label = name.trim();
                          const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "nieuwe-pagina";
                          const ok = await postAction({ action: "create_page", name: label, navLabel: label });
                          if (!ok) { window.alert("Pagina toevoegen mislukt."); return; }
                          await refreshAfterEdit();
                          setPreviewPage(`${slug}.html`);
                          setPreviewKey((k) => k + 1);
                        }}
                      >
                        + Pagina
                      </Button>
                      <select
                        className="h-8 w-[104px] rounded-md border border-border bg-background px-2 text-sm text-muted-foreground truncate"
                        value=""
                        title="Voeg een sectie toe aan deze pagina (zonder AI)"
                        data-testid="select-add-section"
                        onChange={async (e) => {
                          const kind = e.target.value;
                          e.currentTarget.selectedIndex = 0;
                          if (!kind) return;
                          const ok = await postAction({ action: "add_section", page: currentPagePath(), kind });
                          if (!ok) { window.alert("Sectie toevoegen mislukt."); return; }
                          await refreshAfterEdit();
                        }}
                      >
                        <option value="">+ Sectie…</option>
                        <option value="heading">Titel + tekst</option>
                        <option value="text">Tekstblok</option>
                        <option value="image-text">Afbeelding + tekst</option>
                        <option value="gallery">Galerij (3 foto's)</option>
                        <option value="cta">Oproep (knop)</option>
                      </select>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-muted-foreground hover:text-foreground"
                        title="Schrijf zelf een blogpost (zonder AI)"
                        data-testid="button-add-blog"
                        onClick={() => { setBlogTitle(""); setBlogBody(""); setBlogImage(""); setBlogOpen(true); }}
                      >
                        + Blog
                      </Button>
                    </>
                  );
                })()}
                {!isStreaming && activeTab === "preview" && previewHtml && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-muted-foreground hover:text-foreground"
                    onClick={() => setPreviewFullscreen(true)}
                    title="Bekijk op volledig scherm"
                    data-testid="button-fullscreen"
                  >
                    <Maximize2 className="h-3.5 w-3.5 mr-1.5" />
                    Volledig scherm
                  </Button>
                )}
                {!isStreaming && activeTab === "preview" && previewHtml && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-muted-foreground hover:text-foreground"
                    onClick={() => setPreviewKey((k) => k + 1)}
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    Refresh
                  </Button>
                )}
                {!isStreaming && activeTab === "preview" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-muted-foreground hover:text-foreground"
                    disabled={seoBusy}
                    title="Genereer nu een SEO/AEO-artikel voor deze site"
                    onClick={async () => {
                      if (seoBusy) return;
                      setSeoBusy(true);
                      try {
                        const r = await fetch(`/api/projects/${projectId}/seo/article`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
                        const d = await r.json();
                        if (r.ok && d.ok) {
                          const notes = (d.notes && d.notes.length) ? `\n\nVerbeterpunten:\n• ${d.notes.slice(0, 4).join("\n• ")}` : "";
                          if (d.status === "published") { window.alert(`✅ Gepubliceerd: "${d.title}"\nKwaliteitsscore: ${d.score}/100 · ${d.wordCount} woorden.\nOpen blog.html in de preview.`); setPreviewKey((k) => k + 1); }
                          else if (d.status === "draft") window.alert(`📝 Concept opgeslagen (niet gepubliceerd) — score ${d.score}/100.\nTe laag voor automatische publicatie of nieuwe site.${notes}`);
                          else window.alert(`⛔ Afgekeurd — score ${d.score}/100 (te generiek of te veel overlap). Niet gepubliceerd.${notes}`);
                        }
                        else window.alert(d.error || "Genereren mislukt.");
                      } catch { window.alert("Genereren mislukt."); }
                      finally { setSeoBusy(false); }
                    }}
                  >
                    {seoBusy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                    SEO-artikel
                  </Button>
                )}
                {!isStreaming && activeTab === "preview" && (
                  <Button
                    variant={seoAuto ? "default" : "ghost"}
                    size="sm"
                    className="h-8"
                    title="Automatisch periodiek SEO-artikelen publiceren aan/uit"
                    onClick={async () => {
                      const next = !seoAuto;
                      // Turning it OFF is a deliberate choice — confirm first (turning on is free).
                      if (!next && !window.confirm("Weet je zeker dat je automatische SEO wilt uitzetten? Er worden dan geen nieuwe artikelen meer geschreven en gepubliceerd, wat je vindbaarheid in Google kan schaden.")) return;
                      setSeoAuto(next);
                      try {
                        await fetch(`/api/projects/${projectId}/seo/auto`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: next }) });
                      } catch { setSeoAuto(!next); }
                    }}
                  >
                    Auto-SEO {seoAuto ? "aan" : "uit"}
                  </Button>
                )}
              </div>
            </div>

            {/* Code Tab */}
            <TabsContent value="code" className="flex-1 flex m-0 min-h-0 overflow-hidden border-none p-0 outline-none">
              <div className="w-[240px] border-r border-border bg-card/20 flex flex-col min-h-0 shrink-0">
                <div className="px-4 py-3 border-b border-border/50 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  <FolderOpen className="h-3 w-3" />
                  <span className="flex-1">Files</span>
                  {files && files.length > 0 && (
                    <button
                      onClick={() => void handleExtractComponents()}
                      disabled={isExtracting}
                      title="Analyseer pagina's en extraheer gedeelde componenten, stijlen en scripts"
                      className="text-muted-foreground/40 hover:text-muted-foreground transition-colors disabled:opacity-30"
                    >
                      {isExtracting
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Wand2 className="h-3 w-3" />}
                    </button>
                  )}
                </div>
                {extractionResult && extractionResult.created.length > 0 && (
                  <div className="mx-2 mt-2 rounded-md bg-emerald-500/10 border border-emerald-500/20 p-2 text-[10px] shrink-0">
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                        {extractionResult.created.length} bestanden aangemaakt
                      </span>
                      <button onClick={() => setExtractionResult(null)} className="text-emerald-600/50 hover:text-emerald-600">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    {extractionResult.created.map(f => (
                      <div key={f.path} className="truncate text-emerald-700/60 dark:text-emerald-400/60 leading-relaxed">
                        {f.path}{f.source ? ` ← ${f.source}` : ""}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <div className="p-2 space-y-0.5">
                    {isLoadingFiles ? (
                      <div className="flex justify-center p-4">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : files?.length === 0 ? (
                      <div className="text-xs text-muted-foreground p-3 italic">
                        No files yet — chat to generate your app
                      </div>
                    ) : (
                      groupFilesVirtually(files ?? []).filter(g => g.files.length > 0).map(({ name, label, emptyState, files: groupFiles }) => (
                        <div key={name}>
                          <button
                            onClick={() =>
                              setCollapsedFolders((prev) => {
                                const next = new Set(prev);
                                if (next.has(name)) next.delete(name);
                                else next.add(name);
                                return next;
                              })
                            }
                            className="w-full flex items-center gap-1.5 px-2 py-1 mt-1 text-xs font-semibold text-muted-foreground/60 hover:text-muted-foreground uppercase tracking-wider transition-colors"
                          >
                            {collapsedFolders.has(name) ? (
                              <ChevronRight className="h-3 w-3 shrink-0" />
                            ) : (
                              <ChevronDown className="h-3 w-3 shrink-0" />
                            )}
                            <FolderOpen className="h-3 w-3 shrink-0" />
                            <span>{label}/</span>
                          </button>
                          {!collapsedFolders.has(name) && (
                            groupFiles.length === 0 ? (
                              <div className="pl-7 pr-3 py-1 text-[11px] text-muted-foreground/35 italic">
                                {emptyState}
                              </div>
                            ) : (
                              groupFiles.map((file) => {
                                const prefix = name + "/";
                                const displayName = file.path.startsWith(prefix)
                                  ? file.path.slice(prefix.length)
                                  : file.path;
                                return (
                                  <button
                                    key={file.id}
                                    onClick={() => {
                                      setSelectedFile(file.path);
                                      setCodeDiffMode(changedFilePaths.has(file.path));
                                      setActiveDiffHunks(new Set());
                                    }}
                                    className={`w-full flex items-center gap-2 pl-7 pr-3 py-1.5 text-sm rounded-md transition-colors text-left ${
                                      selectedFile === file.path
                                        ? "bg-primary/10 text-primary font-medium"
                                        : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                                    }`}
                                  >
                                    <FileIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                                    <span className="truncate flex-1">{displayName}</span>
                                    {changedFilePaths.has(file.path) && (
                                      <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                    )}
                                  </button>
                                );
                              })
                            )
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#0d1117] relative">
                {liveCode ? (
                  <>
                    <div className="h-10 border-b border-white/10 bg-[#0d1117] flex items-center px-4 shrink-0 gap-3">
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-emerald-400" />
                      <span className="text-xs text-gray-300 font-mono flex-1 truncate">
                        {liveCode.path ?? "Bestand schrijven…"}
                      </span>
                      <span className="shrink-0 text-[10px] text-emerald-400/80">live</span>
                    </div>
                    <div className="flex-1 min-h-0 overflow-auto">
                      <LiveCodeView content={liveCode.content} />
                    </div>
                  </>
                ) : activeFile ? (
                  <>
                    <div className="h-10 border-b border-white/10 bg-[#0d1117] flex items-center px-4 shrink-0 gap-3">
                      <span className="text-xs text-gray-400 font-mono flex-1 truncate">{activeFile.path}</span>
                      {activeFileWasChanged && (
                        <div className="flex shrink-0 rounded overflow-hidden border border-white/10 text-[10px] font-medium">
                          <button
                            onClick={() => setCodeDiffMode(false)}
                            className={`px-2.5 py-1 transition-colors ${
                              !codeDiffMode ? "bg-white/10 text-white" : "text-gray-500 hover:text-gray-300"
                            }`}
                          >
                            Code
                          </button>
                          <button
                            onClick={() => setCodeDiffMode(true)}
                            className={`px-2.5 py-1 transition-colors border-l border-white/10 ${
                              codeDiffMode ? "bg-emerald-500/20 text-emerald-400" : "text-gray-500 hover:text-gray-300"
                            }`}
                          >
                            Diff
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-h-0 overflow-auto">
                      {codeDiffMode && activeFileWasChanged ? (() => {
                        const oldContent = preBuildSnapshot.get(activeFile.path) ?? "";
                        const dl = lineDiff(oldContent, activeFile.content);
                        const addCount = dl.filter(l => l.kind === "add").length;
                        const delCount = dl.filter(l => l.kind === "del").length;

                        // Group consecutive changed lines into hunks
                        type Hunk = { startLine: number; lines: typeof dl };
                        const hunks: Hunk[] = [];
                        let cur: Hunk | null = null;
                        dl.forEach((l, idx) => {
                          if (l.kind !== "same") {
                            if (!cur) cur = { startLine: idx, lines: [] };
                            cur.lines.push(l);
                          } else {
                            if (cur) { hunks.push(cur); cur = null; }
                          }
                        });
                        if (cur) hunks.push(cur);
                        // Map each line index to its hunk index
                        const lineToHunk = new Map<number, number>();
                        hunks.forEach((h, hi) => {
                          h.lines.forEach((_, offset) => lineToHunk.set(h.startLine + offset, hi));
                        });

                        return (
                          <div className="flex flex-col min-h-full">
                            <div className="flex items-center gap-3 px-4 py-1.5 bg-[#0d1117] border-b border-white/5 text-[10px]">
                              {addCount > 0 && <span className="text-emerald-400">+{addCount} regels</span>}
                              {delCount > 0 && <span className="text-rose-400">−{delCount} regels</span>}
                              {hunks.length > 0 && (
                                <span className="text-gray-500">{hunks.length} {hunks.length === 1 ? "sectie" : "secties"} gewijzigd — klik om te markeren</span>
                              )}
                              {activeDiffHunks.size > 0 && (
                                <button
                                  onClick={() => setActiveDiffHunks(new Set())}
                                  className="ml-auto text-gray-600 hover:text-gray-400 transition-colors"
                                >
                                  Markering wissen
                                </button>
                              )}
                            </div>
                            <div className="flex-1 overflow-auto">
                              <pre className="text-[13px] leading-[1.6] font-mono m-0 min-w-max">
                                {dl.map((l, j) => {
                                  const hunkIdx = lineToHunk.get(j);
                                  const isInHunk = hunkIdx !== undefined;
                                  const isActive = hunkIdx !== undefined && activeDiffHunks.has(hunkIdx);
                                  return (
                                  <div
                                    key={j}
                                    onClick={() => {
                                      if (hunkIdx === undefined) return;
                                      setActiveDiffHunks(prev => {
                                        const next = new Set(prev);
                                        if (next.has(hunkIdx)) next.delete(hunkIdx); else next.add(hunkIdx);
                                        return next;
                                      });
                                    }}
                                    className={`flex ${isInHunk ? "cursor-pointer" : ""} ${
                                      isActive
                                        ? (l.kind === "add" ? "bg-emerald-500/40" : "bg-rose-500/40")
                                        : l.kind === "add" ? "bg-emerald-950/50 hover:bg-emerald-900/50" :
                                          l.kind === "del" ? "bg-rose-950/50 hover:bg-rose-900/50" : ""
                                    }`}
                                  >
                                    <span className="select-none w-12 text-right pr-3 py-px text-gray-600 shrink-0 text-[11px]">{j + 1}</span>
                                    <span className={`w-5 shrink-0 select-none py-px ${
                                      l.kind === "add" ? "text-emerald-400" :
                                      l.kind === "del" ? "text-rose-400" : "text-gray-600"
                                    }`}>
                                      {l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}
                                    </span>
                                    <span className={`py-px pr-8 whitespace-pre ${
                                      l.kind === "add" ? "text-emerald-200" :
                                      l.kind === "del" ? "text-rose-300" : "text-gray-300"
                                    }`}>{l.line}</span>
                                  </div>
                                  );
                                })}
                              </pre>
                            </div>
                          </div>
                        );
                      })() : (
                        <CodeViewer path={activeFile.path} content={activeFile.content} />
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                    <FileCode className="h-12 w-12 mb-4 opacity-20" />
                    <p className="text-sm">Select a file to view its contents</p>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Preview Tab */}
            <TabsContent value="preview" className="flex-1 flex flex-col m-0 border-none p-0 outline-none">
              {previewHtml ? (
                <div
                  className={
                    previewFullscreen
                      ? "fixed inset-0 z-50 bg-white"
                      : "relative flex-1 overflow-hidden bg-white"
                  }
                >
                  {/* No zoom/scaling — the site always renders at its real, fixed size.
                      The iframe simply fills its box and scrolls its own content. In
                      full-screen mode the box is the whole window (a real web viewer).
                      Imported sites use a real src URL served by our API so the iframe
                      gets a genuine origin (localhost:5001) and allow-same-origin is
                      safe — the API server holds no user cookies to steal. This lets
                      all AJAX route through /api/site-proxy without CORS issues. */}
                  <iframe
                    key={`${previewKey}-${(previewPage || "index.html").replace(/\.html$/, "")}`}
                    ref={previewIframeRef}
                    {...(isImported
                      ? {
                          src: `/api/projects/${projectId}/preview-page?page=${encodeURIComponent(previewPage ?? "index.html")}&sid=${previewSessionId}&k=${previewKey}${selectMode ? "&edit=1" : ""}`,
                          sandbox: "allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-presentation",
                        }
                      : {
                          srcDoc: previewHtml,
                          sandbox: "allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-presentation",
                        })}
                    className="absolute inset-0 h-full w-full border-0 bg-white"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
                    allowFullScreen
                    title="App Preview"
                    onLoad={() => {
                      // Re-sync select mode after every (re)load of the preview document.
                      try { previewIframeRef.current?.contentWindow?.postMessage({ __buildlySelectMode: selectModeRef.current }, "*"); } catch { /* ignore */ }
                    }}
                  />
                  {previewFullscreen && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="absolute top-3 right-3 z-[60] shadow-lg"
                      onClick={() => setPreviewFullscreen(false)}
                      title="Sluit volledig scherm (Esc)"
                      data-testid="button-exit-fullscreen"
                    >
                      <Minimize2 className="h-3.5 w-3.5 mr-1.5" />
                      Sluiten
                    </Button>
                  )}

                  {/* Manual blog editor (no AI) */}
                  {blogOpen && (
                    <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!blogBusy) setBlogOpen(false); }}>
                      <div className="w-[min(560px,94%)] rounded-xl bg-background border shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-base font-semibold mb-3">Nieuwe blogpost</h3>
                        <label className="block text-xs text-muted-foreground mb-1">Titel</label>
                        <input className="w-full mb-3 rounded-md border bg-background px-3 py-2 text-sm" value={blogTitle} onChange={(e) => setBlogTitle(e.target.value)} placeholder="bijv. 5 tips voor beginners" data-testid="input-blog-title" />
                        <label className="block text-xs text-muted-foreground mb-1">Tekst</label>
                        <textarea className="w-full mb-3 rounded-md border bg-background px-3 py-2 text-sm h-48 resize-y" value={blogBody} onChange={(e) => setBlogBody(e.target.value)} placeholder="Schrijf hier je blog… (een lege regel = nieuwe alinea)" data-testid="input-blog-body" />
                        <label className="block text-xs text-muted-foreground mb-1">Afbeelding-URL (optioneel)</label>
                        <input className="w-full mb-4 rounded-md border bg-background px-3 py-2 text-sm" value={blogImage} onChange={(e) => setBlogImage(e.target.value)} placeholder="https://…" data-testid="input-blog-image" />
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" disabled={blogBusy} onClick={() => setBlogOpen(false)}>Annuleren</Button>
                          <Button
                            size="sm"
                            disabled={blogBusy || !blogTitle.trim() || !blogBody.trim()}
                            data-testid="button-publish-blog"
                            onClick={async () => {
                              setBlogBusy(true);
                              try {
                                const res = await fetch(`/api/projects/${projectId}/blog/manual`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: blogTitle, body: blogBody, image: blogImage }) });
                                const d = await res.json();
                                if (res.ok && d.ok) { setBlogOpen(false); await refreshAfterEdit(); setPreviewPage("blog.html"); setPreviewKey((k) => k + 1); }
                                else window.alert(d.error || "Publiceren mislukt.");
                              } catch { window.alert("Publiceren mislukt."); }
                              finally { setBlogBusy(false); }
                            }}
                          >
                            {blogBusy ? "Bezig…" : "Publiceren"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Select & edit mode: hint banner + click-to-edit popover */}
                  {selectMode && !selection && (
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[60] rounded-full bg-primary text-primary-foreground text-xs font-medium px-4 py-2 shadow-lg pointer-events-none">
                      Klik op tekst of een afbeelding om die direct te bewerken
                    </div>
                  )}
                  {selection && (
                    <div
                      className="absolute inset-0 z-[70] flex items-center justify-center bg-black/30"
                      onClick={closeSelection}
                    >
                      <div
                        className="w-[min(440px,92%)] rounded-xl bg-background border shadow-2xl p-4"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-sm font-semibold text-foreground">
                            {selection.kind === "image" ? "Afbeelding vervangen" : "Tekst bewerken"}
                          </h3>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={closeSelection}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        {selection.kind === "text" ? (
                          <div className="space-y-3">
                            <Textarea
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              rows={3}
                              className="text-sm"
                              autoFocus
                            />
                            <div className="flex items-center gap-4">
                              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                                Tekstkleur
                                <input
                                  type="color"
                                  className="h-7 w-9 rounded border bg-transparent cursor-pointer p-0"
                                  onChange={(e) => void applyElementColor("color", e.target.value)}
                                  title="Verander de tekstkleur van dit element"
                                />
                              </label>
                              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                                Achtergrond
                                <input
                                  type="color"
                                  className="h-7 w-9 rounded border bg-transparent cursor-pointer p-0"
                                  onChange={(e) => void applyElementColor("background", e.target.value)}
                                  title="Verander de achtergrondkleur van dit element"
                                />
                              </label>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {selection.file && (
                              <p className="text-xs text-muted-foreground truncate">Huidig: {selection.file}</p>
                            )}
                            <input
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              placeholder="https://… nieuwe afbeeldings-URL"
                              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                              autoFocus
                            />
                          </div>
                        )}
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          {isNavLike(selection)
                            ? "Navigatiebalk — de achtergrondkleur wordt op alle pagina's toegepast."
                            : `Past alleen dit ene element aan${selection.tag ? ` (<${selection.tag}>)` : ""}.`}
                        </p>
                        <div className="flex items-center justify-between gap-2 mt-4">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={sendSelectionToChat}
                            disabled={applyingEdit}
                            title="Stuur de kenmerken van dit element naar de chat zodat de AI het begrijpt"
                          >
                            <Wand2 className="h-3.5 w-3.5 mr-1.5" />
                            Met AI aanpassen
                          </Button>
                          <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={closeSelection}>Annuleren</Button>
                            <Button size="sm" onClick={applyVisualEdit} disabled={applyingEdit}>
                              {applyingEdit ? (
                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                              ) : (
                                <Check className="h-3.5 w-3.5 mr-1.5" />
                              )}
                              Toepassen
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {(previewErrors.length > 0 || isAutoFixing) && !isStreaming && !isImported && (
                    <div className="absolute bottom-4 left-4 right-4 z-10">
                      <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 backdrop-blur px-4 py-3 shadow-lg">
                        {isAutoFixing ? (
                          <Loader2 className="h-4 w-4 text-primary shrink-0 mt-0.5 animate-spin" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground">
                            {isAutoFixing ? "Auto-fixing error…" : "Runtime error detected"}
                          </p>
                          {!isAutoFixing && (
                            <p className="text-xs text-muted-foreground truncate font-mono">
                              {previewErrors[previewErrors.length - 1]}
                            </p>
                          )}
                        </div>
                        {!isAutoFixing && (
                          <>
                            <Button
                              size="sm"
                              className="h-8 shrink-0"
                              onClick={() => void handleAutoFix()}
                              data-testid="button-auto-fix"
                            >
                              <Wand2 className="h-3.5 w-3.5 mr-1.5" />
                              Fix
                            </Button>
                            <button
                              onClick={() => setPreviewErrors([])}
                              className="text-muted-foreground hover:text-foreground shrink-0"
                              aria-label="Dismiss"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground">
                  <MonitorPlay className="h-16 w-16 opacity-20" />
                  <h3 className="text-xl font-bold text-foreground">No Preview Yet</h3>
                  <p className="text-sm max-w-sm text-center">
                    Chat with Nebula to generate your app. The preview will appear here instantly.
                  </p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
