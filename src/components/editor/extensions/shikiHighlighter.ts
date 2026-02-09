import { createHighlighter, type Highlighter, type BundledLanguage } from "shiki";

// =====================================================
// Shiki Highlighter Singleton
// =====================================================
// Async init, sync usage. Dual-theme support via CSS variables.

let highlighter: Highlighter | null = null;
let currentThemePair = { light: "github-light", dark: "github-dark" };
let version = 0;

/** Monotonically increasing counter — changes whenever Shiki inits or theme changes.
 *  Used by widgets to bust CM6's eq() cache. */
export function getShikiVersion(): number {
  return version;
}

const COMMON_LANGS: BundledLanguage[] = [
  "javascript",
  "typescript",
  "python",
  "json",
  "html",
  "css",
  "bash",
  "shell",
  "rust",
  "go",
  "java",
  "c",
  "cpp",
  "ruby",
  "sql",
  "yaml",
  "toml",
  "markdown",
  "jsx",
  "tsx",
  "swift",
  "kotlin",
  "php",
  "r",
  "lua",
  "dockerfile",
  "xml",
];

export async function initShiki(light: string, dark: string): Promise<void> {
  currentThemePair = { light, dark };
  try {
    highlighter = await createHighlighter({
      themes: [light, dark],
      langs: COMMON_LANGS,
    });
    version++;
  } catch (err) {
    console.error("Failed to initialize Shiki:", err);
  }
}

export function highlightCode(code: string, lang: string): string | null {
  if (!highlighter) return null;
  try {
    return highlighter.codeToHtml(code, {
      lang: lang as BundledLanguage,
      themes: currentThemePair,
      defaultColor: false, // Use CSS variables for dual theme
    });
  } catch {
    // Language not loaded or invalid — try plain text
    try {
      return highlighter.codeToHtml(code, {
        lang: "text",
        themes: currentThemePair,
        defaultColor: false,
      });
    } catch {
      return null;
    }
  }
}

export function isShikiReady(): boolean {
  return highlighter !== null;
}

export async function changeTheme(light: string, dark: string): Promise<void> {
  if (highlighter) {
    highlighter.dispose();
    highlighter = null;
  }
  await initShiki(light, dark);
}
