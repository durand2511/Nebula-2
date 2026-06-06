/**
 * fileSplitter — Splits a monolithic HTML file into virtual project files
 * based on the architecture, extracting CSS, JS functions, and HTML sections.
 */

import type { AppArchitecture } from "@/ai/architecture";

export interface VirtualFile {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: VirtualFile[];
  content?: string;
  language?: string;
}

/** Parse HTML and split into virtual files based on architecture */
export function splitHtmlToFiles(
  html: string,
  arch: AppArchitecture | null,
): VirtualFile[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Extract CSS
  const styles = extractStyles(doc);
  // Extract JS
  const scripts = extractScripts(doc);
  // Extract body HTML (without scripts)
  const bodyHtml = extractBodyHtml(doc);

  if (!arch) {
    // No architecture — split into basic files
    const root: VirtualFile[] = [];
    if (styles) {
      root.push({ name: "styles.css", path: "styles.css", type: "file", content: styles, language: "css" });
    }
    root.push({ name: "index.html", path: "index.html", type: "file", content: bodyHtml, language: "html" });
    if (scripts) {
      root.push({ name: "app.js", path: "app.js", type: "file", content: scripts, language: "javascript" });
    }
    return root;
  }

  const root: VirtualFile[] = [];

  // Split JS into component/page functions
  const jsFunctions = extractFunctions(scripts);

  // Components folder
  const componentFiles: VirtualFile[] = [];
  for (const comp of arch.structure.components) {
    const fn = findFunctionForComponent(comp.name, jsFunctions);
    componentFiles.push({
      name: `${comp.name}.js`,
      path: `components/${comp.name}.js`,
      type: "file",
      language: "javascript",
      content: fn || `// ${comp.name}\n// Type: ${comp.type}\n// Purpose: ${comp.purpose}\n\nfunction create${comp.name}(props) {\n  const el = document.createElement("div");\n  el.className = "${comp.type.toLowerCase()}";\n  el.textContent = props.label || "${comp.purpose}";\n  return el;\n}`,
    });
  }
  if (componentFiles.length > 0) {
    root.push({ name: "components", path: "components", type: "folder", children: componentFiles });
  }

  // Pages folder
  const pageFiles: VirtualFile[] = [];
  for (const page of arch.structure.pages) {
    const pageName = capitalize(slugify(page.name));
    const fn = findFunctionForPage(pageName, jsFunctions);
    const pageSection = extractPageSection(doc, page.name);

    const content = fn
      ? fn
      : pageSection
        ? `<!-- ${page.name} Page -->\n<!-- Route: ${page.route} -->\n<!-- Purpose: ${page.purpose} -->\n\n${pageSection}`
        : `// ${page.name} Page\n// Route: ${page.route}\n// Purpose: ${page.purpose}\n// Components: ${page.components.join(", ")}\n\nfunction render${pageName}Page() {\n  // Page implementation\n}`;

    pageFiles.push({
      name: `${pageName}Page.${fn ? "js" : "html"}`,
      path: `pages/${pageName}Page.${fn ? "js" : "html"}`,
      type: "file",
      language: fn ? "javascript" : "html",
      content,
    });
  }
  if (pageFiles.length > 0) {
    root.push({ name: "pages", path: "pages", type: "folder", children: pageFiles });
  }

  // Layouts folder
  const layoutFiles: VirtualFile[] = [];
  for (const layout of arch.structure.layouts) {
    const fn = findFunctionByName(layout.name, jsFunctions);
    layoutFiles.push({
      name: `${layout.name}.js`,
      path: `layouts/${layout.name}.js`,
      type: "file",
      language: "javascript",
      content: fn || `// ${layout.name}\n// ${layout.description}\n// Slots: ${layout.slots.join(", ")}\n\nfunction create${layout.name}() {\n  const layout = document.createElement("div");\n  layout.className = "layout";\n  return layout;\n}`,
    });
  }
  if (layoutFiles.length > 0) {
    root.push({ name: "layouts", path: "layouts", type: "folder", children: layoutFiles });
  }

  // Models folder
  if (arch.structure.data_models.length > 0) {
    const modelFiles: VirtualFile[] = arch.structure.data_models.map((m) => ({
      name: `${m.name}.js`,
      path: `models/${m.name}.js`,
      type: "file" as const,
      language: "javascript",
      content: generateModelCode(m, scripts),
    }));
    root.push({ name: "models", path: "models", type: "folder", children: modelFiles });
  }

  // API folder
  if (arch.structure.api_layer.length > 0) {
    const apiFiles: VirtualFile[] = arch.structure.api_layer.map((a) => {
      const fn = findFunctionByName(a.name, jsFunctions);
      return {
        name: `${a.name}.js`,
        path: `api/${a.name}.js`,
        type: "file" as const,
        language: "javascript",
        content: fn || `// API: ${a.name}\n// Method: ${a.method}\n// ${a.description}\n\nasync function ${a.name}(data) {\n  return { success: true, data };\n}`,
      };
    });
    root.push({ name: "api", path: "api", type: "folder", children: apiFiles });
  }

  // Styles
  if (styles) {
    root.push({ name: "styles.css", path: "styles.css", type: "file", content: styles, language: "css" });
  }

  // Main app entry
  const remainingJs = getRemainingJs(scripts, jsFunctions);
  root.push({
    name: "app.js",
    path: "app.js",
    type: "file",
    language: "javascript",
    content: remainingJs || `// App Entry Point\n// ${arch.app_name}\n\ndocument.addEventListener("DOMContentLoaded", () => {\n  console.log("${arch.app_name} loaded");\n});`,
  });

  // Index HTML (structure only)
  root.push({
    name: "index.html",
    path: "index.html",
    type: "file",
    language: "html",
    content: generateIndexHtml(arch, bodyHtml),
  });

  return root;
}

// ── Extraction helpers ──

function extractStyles(doc: Document): string {
  const styleTags = doc.querySelectorAll("style");
  const styles: string[] = [];
  styleTags.forEach((tag) => {
    const text = tag.textContent?.trim();
    if (text) styles.push(text);
  });

  // Also get linked external CSS references
  const links = doc.querySelectorAll('link[rel="stylesheet"]');
  const imports: string[] = [];
  links.forEach((link) => {
    const href = link.getAttribute("href");
    if (href) imports.push(`/* @import url("${href}"); */`);
  });

  return [...imports, ...styles].join("\n\n");
}

function extractScripts(doc: Document): string {
  const scriptTags = doc.querySelectorAll("script:not([src])");
  const scripts: string[] = [];
  scriptTags.forEach((tag) => {
    const text = tag.textContent?.trim();
    if (text) scripts.push(text);
  });
  return scripts.join("\n\n");
}

function extractBodyHtml(doc: Document): string {
  const body = doc.body;
  if (!body) return "";
  // Clone body and remove scripts
  const clone = body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script").forEach((s) => s.remove());
  return clone.innerHTML.trim();
}

interface ExtractedFunction {
  name: string;
  fullMatch: string;
  body: string;
}

function extractFunctions(js: string): ExtractedFunction[] {
  const functions: ExtractedFunction[] = [];
  // Match function declarations
  const funcRegex = /(?:(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{)/g;
  let match: RegExpExecArray | null;
  
  while ((match = funcRegex.exec(js)) !== null) {
    const name = match[1];
    const startIndex = match.index;
    // Find matching closing brace
    let braceCount = 0;
    let endIndex = startIndex;
    let foundStart = false;
    
    for (let i = startIndex; i < js.length; i++) {
      if (js[i] === "{") { braceCount++; foundStart = true; }
      if (js[i] === "}") { braceCount--; }
      if (foundStart && braceCount === 0) {
        endIndex = i + 1;
        break;
      }
    }
    
    const fullMatch = js.substring(startIndex, endIndex);
    functions.push({ name, fullMatch, body: fullMatch });
  }
  
  return functions;
}

function findFunctionForComponent(componentName: string, functions: ExtractedFunction[]): string | null {
  const lower = componentName.toLowerCase().replace(/component$/i, "");
  const found = functions.find((f) => {
    const fLower = f.name.toLowerCase();
    return (
      fLower.includes(lower) ||
      fLower.includes(`create${lower}`) ||
      fLower.includes(`render${lower}`)
    );
  });
  return found?.fullMatch || null;
}

function findFunctionForPage(pageName: string, functions: ExtractedFunction[]): string | null {
  const lower = pageName.toLowerCase();
  const found = functions.find((f) => {
    const fLower = f.name.toLowerCase();
    return (
      fLower.includes(`render${lower}`) ||
      fLower.includes(`show${lower}`) ||
      fLower.includes(`${lower}page`) ||
      fLower.includes(lower)
    );
  });
  return found?.fullMatch || null;
}

function findFunctionByName(name: string, functions: ExtractedFunction[]): string | null {
  const lower = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const found = functions.find((f) => {
    const fLower = f.name.toLowerCase();
    return fLower.includes(lower) || lower.includes(fLower);
  });
  return found?.fullMatch || null;
}

function extractPageSection(doc: Document, pageName: string): string | null {
  const lower = pageName.toLowerCase();
  // Try to find section/div with matching id or data attribute
  const selectors = [
    `[id*="${lower}"]`,
    `[data-page="${lower}"]`,
    `section[class*="${lower}"]`,
    `div[class*="${lower}"]`,
  ];
  
  for (const selector of selectors) {
    try {
      const el = doc.querySelector(selector);
      if (el) return el.outerHTML;
    } catch { /* skip invalid selectors */ }
  }
  return null;
}

function getRemainingJs(allJs: string, extracted: ExtractedFunction[]): string {
  let remaining = allJs;
  for (const fn of extracted) {
    remaining = remaining.replace(fn.fullMatch, "");
  }
  return remaining.trim();
}

function generateModelCode(
  model: { name: string; fields: { name: string; type: string }[] },
  allJs: string,
): string {
  // Check if there's localStorage logic for this model in the JS
  const lower = model.name.toLowerCase();
  const hasStore = allJs.toLowerCase().includes(lower);
  
  const fieldsComment = model.fields.map((f) => ` *   ${f.name}: ${f.type}`).join("\n");
  
  return `/**
 * Data Model: ${model.name}
 *
 * Fields:
${fieldsComment}
 */

const ${model.name}Store = {
  key: "${model.name}",
  
  getAll() {
    return JSON.parse(localStorage.getItem(this.key) || "[]");
  },

  getById(id) {
    return this.getAll().find(item => item.id === id);
  },

  add(item) {
    const items = this.getAll();
    items.push({ id: Date.now().toString(), ...item, createdAt: new Date().toISOString() });
    localStorage.setItem(this.key, JSON.stringify(items));
    return items;
  },

  update(id, updates) {
    const items = this.getAll().map(item => 
      item.id === id ? { ...item, ...updates } : item
    );
    localStorage.setItem(this.key, JSON.stringify(items));
    return items;
  },

  remove(id) {
    const items = this.getAll().filter(item => item.id !== id);
    localStorage.setItem(this.key, JSON.stringify(items));
    return items;
  }
};${hasStore ? "\n\n// Note: This model is actively used in the generated app" : ""}
`;
}

function generateIndexHtml(arch: AppArchitecture, bodyHtml: string): string {
  // Show a clean structural version
  const truncatedBody = bodyHtml.length > 500
    ? bodyHtml.substring(0, 500) + "\n  <!-- ... meer content ... -->"
    : bodyHtml;
    
  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${arch.app_name}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
${truncatedBody}
  <script src="app.js"></script>
</body>
</html>`;
}

// ── Utils ──

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
