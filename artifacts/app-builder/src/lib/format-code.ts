// Shared, display/output formatting for generated & imported project files.
// Used by both the on-screen code viewer and the ZIP download so the code the
// user reads and the code they download are both neatly indented.

// Above this size we skip Prettier (very large pages would block the UI/zip).
export const FORMAT_MAX = 2_000_000;

type LangInfo = { prettierParser?: string; hljsLang?: string };

export function langFromPath(path: string): LangInfo {
  const p = path.toLowerCase();
  if (p.endsWith(".html") || p.endsWith(".htm")) return { prettierParser: "html", hljsLang: "xml" };
  if (p.endsWith(".css")) return { prettierParser: "css", hljsLang: "css" };
  if (p.endsWith(".js") || p.endsWith(".mjs") || p.endsWith(".cjs"))
    return { prettierParser: "babel", hljsLang: "javascript" };
  if (p.endsWith(".json")) return { prettierParser: "json", hljsLang: "json" };
  return {};
}

// Lazily load Prettier (standalone) and only the plugins the parser needs, so it
// never weighs on first paint and stays out of the main bundle.
export async function formatWithParser(content: string, parser: string): Promise<string> {
  const standalone = await import("prettier/standalone");
  const plugins: unknown[] = [];
  if (parser === "html") {
    plugins.push((await import("prettier/plugins/html")).default);
  } else if (parser === "css") {
    plugins.push((await import("prettier/plugins/postcss")).default);
  } else {
    // babel + json both need the babel parser plugin and the estree printer.
    plugins.push((await import("prettier/plugins/babel")).default);
    plugins.push((await import("prettier/plugins/estree")).default);
  }
  return standalone.format(content, {
    parser,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugins: plugins as any,
    printWidth: 100,
    tabWidth: 2,
    htmlWhitespaceSensitivity: "ignore",
  });
}

// Format a file's content if we recognize its language and it's within the size
// budget. Always falls back to the original content on any error so malformed
// imported HTML never breaks the viewer or the download.
export async function formatFileContent(path: string, content: string): Promise<string> {
  const { prettierParser } = langFromPath(path);
  if (!prettierParser || content.length > FORMAT_MAX) return content;
  try {
    return await formatWithParser(content, prettierParser);
  } catch {
    return content;
  }
}
