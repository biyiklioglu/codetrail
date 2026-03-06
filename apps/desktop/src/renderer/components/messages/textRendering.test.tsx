import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./toolParsing", () => ({
  tryParseJsonRecord(value: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  },
}));

import {
  CodeBlock,
  DiffBlock,
  buildHighlightedTextNodes,
  detectLanguageFromContent,
  detectLanguageFromFilePath,
  escapeRegExp,
  isLikelyDiff,
  looksLikeMarkdown,
  renderMarkedSnippet,
  renderPlainText,
  renderRichText,
  tryFormatJson,
} from "./textRendering";

function renderNode(node: ReactNode): string {
  const rootHtml = renderToStaticMarkup(<div data-render-root="1">{node}</div>);
  return rootHtml.replace(/^<div data-render-root="1">/, "").replace(/<\/div>$/, "");
}

function renderNodes(nodes: ReactNode[]): string {
  const rootHtml = renderToStaticMarkup(<div data-render-root="1">{nodes}</div>);
  return rootHtml.replace(/^<div data-render-root="1">/, "").replace(/<\/div>$/, "");
}

describe("renderRichText", () => {
  it("renders GFM tables with header and body cells", () => {
    const markdown = [
      "| Directory | dux | du | Match |",
      "| --- | --- | --- | --- |",
      "| `/Users/acme/repo/src` | 325.9 MB | 326M | Yes |",
      "| `/Users/acme/repo/.venv` | 322.1 MB | 322M | Yes |",
    ].join("\n");

    const html = renderNodes(renderRichText(markdown, "", "table", ["/Users/acme/repo"]));

    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
    expect(html).toContain("<th>Directory</th>");
    expect(html).toContain("<th>Match</th>");
    expect(html).toContain("<td>325.9 MB</td>");
    expect(html).toContain('class="md-link-local"');
    expect(html).toContain(">src<");
  });

  it("renders local markdown links as local path buttons when in project roots", () => {
    const markdown = "[Open docs](/Users/acme/repo/docs/guide.md)";

    const html = renderNodes(renderRichText(markdown, "", "local-link", ["/Users/acme/repo"]));

    expect(html).toContain("<button");
    expect(html).toContain('class="md-link-local"');
    expect(html).toContain(">Open docs<");
  });

  it("preserves lower-level markdown heading semantics", () => {
    const markdown = ["#### Four", "##### Five", "###### Six"].join("\n\n");

    const html = renderNodes(renderRichText(markdown, "", "headings"));

    expect(html).toContain("<h6");
    expect(html).toContain(">Four<");
    expect(html).toContain(">Five<");
    expect(html).toContain(">Six<");
    expect(html).not.toContain('<h5 class="md-h3">Four</h5>');
  });

  it("normalizes links with whitespace between bracket and parenthesis", () => {
    const markdown = "[Open docs] (/Users/acme/repo/docs/guide.md)";

    const html = renderNodes(renderRichText(markdown, "", "normalized-link", ["/Users/acme/repo"]));

    expect(html).toContain('class="md-link-local"');
    expect(html).toContain(">Open docs<");
  });

  it("renders external links with md-link styling", () => {
    const markdown = "[Project](https://example.com/repo)";

    const html = renderNodes(renderRichText(markdown, "", "external-link"));

    expect(html).toMatch(/<a[^>]*class="md-link"[^>]*href="https:\/\/example\.com\/repo"/);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  it("highlights inline code matches that span punctuation-separated tokens", () => {
    const markdown = "`feat(history): add collapsible side panes`";

    const html = renderNodes(
      renderRichText(markdown, '"history add"', "inline-code-highlight", [], ["history add"]),
    );

    expect(html).toContain("<code><span>feat(</span><mark>history): add</mark>");
  });

  it("highlights external link labels without rewriting them into path links", () => {
    const markdown = "[history add](https://example.com/repo)";

    const html = renderNodes(
      renderRichText(markdown, '"history add"', "external-link-highlight", [], ["history add"]),
    );

    expect(html).toMatch(/<a[^>]*class="md-link"[^>]*>/);
    expect(html).toContain("<mark>history add</mark>");
    expect(html).not.toContain('class="md-link-local"');
  });

  it("highlights local link labels inside markdown buttons", () => {
    const markdown = "[history add](/Users/acme/repo/docs/guide.md)";

    const html = renderNodes(
      renderRichText(
        markdown,
        '"history add"',
        "local-link-highlight",
        ["/Users/acme/repo"],
        ["history add"],
      ),
    );

    expect(html).toContain('class="md-link-local"');
    expect(html).toContain("<mark>history add</mark>");
  });

  it("drops unsafe javascript links and keeps text", () => {
    const markdown = "[Unsafe](javascript:alert(1))";

    const html = renderNodes(renderRichText(markdown, "", "unsafe-link"));

    expect(html).not.toContain("javascript:alert");
    expect(html).toContain("<span>Unsafe</span>");
  });

  it("escapes raw html tags in markdown input", () => {
    const markdown = "<script>alert(1)</script>";

    const html = renderNodes(renderRichText(markdown, "", "html-escape"));

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("script");
  });

  it("renders fenced code blocks with syntax classes", () => {
    const markdown = ["```ts", "const answer = 42", "```"].join("\n");

    const html = renderNodes(renderRichText(markdown, "", "code-block"));

    expect(html).toContain('class="code-block"');
    expect(html).toContain('<div class="code-meta">ts</div>');
    expect(html).toContain('class="tok-keyword">const</span>');
    expect(html).toContain('class="tok-number">42</span>');
  });

  it("renders source-reference fence headers as file path plus start line", () => {
    const markdown = [
      "```190:209:/Users/acme/repo/packages/core/src/search/searchMessages.ts",
      "function normalizeProviders(values: string[]): Provider[] {",
      "  return [];",
      "}",
      "```",
    ].join("\n");

    const html = renderNodes(renderRichText(markdown, "", "source-ref", ["/Users/acme/repo"]));

    expect(html).toContain(
      '<div class="code-meta">packages/core/src/search/searchMessages.ts:190</div>',
    );
    expect(html).not.toContain('<div class="code-meta">190</div>');
    expect(html).toContain('class="tok-keyword">function</span>');
  });

  it("renders fenced diffs using diff table rows", () => {
    const markdown = [
      "```diff",
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,1 +1,1 @@",
      "-const value = 1",
      "+const value = 2",
      "```",
    ].join("\n");

    const html = renderNodes(renderRichText(markdown, "", "diff-block"));

    expect(html).toContain('class="code-block diff-block"');
    expect(html).toContain('class="diff-table"');
    expect(html).toContain('class="diff-row diff-remove"');
    expect(html).toContain('class="diff-row diff-add"');
    expect(html).toContain('class="diff-word-remove"');
    expect(html).toContain('class="diff-word-add"');
    expect(html).toContain('class="diff-ln"> </span>');
    expect(html).not.toContain('class="diff-ln old"');
    expect(html).not.toContain('class="diff-ln new"');
    expect(html).toContain(">a.ts<");
    expect(html).toContain(">+1<");
    expect(html).toContain(">-1<");
    expect(html).not.toContain("diff --git a/a.ts b/a.ts");
    expect(html).not.toContain("--- a/a.ts");
    expect(html).not.toContain("+++ b/a.ts");
    expect(html).not.toContain("@@ -1,1 +1,1 @@");
    expect(html).not.toContain('class="diff-row diff-meta"');
  });

  it("trims project root prefix from diff file path in the diff header", () => {
    const html = renderNode(
      <DiffBlock
        codeValue={["-old", "+new"].join("\n")}
        filePath="/Users/acme/repo/src/module/file.ts"
        pathRoots={["/Users/acme/repo"]}
      />,
    );

    expect(html).toContain(">src/module/file.ts<");
  });
});

describe("renderPlainText", () => {
  it("renders empty lines and highlights query text", () => {
    const text = "first line\n\nsecond line";

    const html = renderNodes(renderPlainText(text, "second", "plain", []));

    expect(html).toContain('class="md-p">');
    expect(html).toContain('class="md-empty"');
    expect(html).toContain("<mark>second</mark>");
  });

  it("turns in-root absolute paths into local path buttons", () => {
    const text = "Open /Users/acme/repo/src/main.ts please.";

    const html = renderNodes(renderPlainText(text, "", "path", ["/Users/acme/repo"]));

    expect(html).toContain('class="md-link-local"');
    expect(html).toContain(">src/main.ts<");
  });

  it("keeps out-of-root absolute paths as plain text", () => {
    const text = "Ignored path: /Users/other/secret.txt";

    const html = renderNodes(renderPlainText(text, "", "path", ["/Users/acme/repo"]));

    expect(html).not.toContain('class="md-link-local"');
    expect(html).toContain("/Users/other/secret.txt");
  });
});

describe("looksLikeMarkdown", () => {
  it("detects markdown headings, lists, links, and emphasis", () => {
    expect(looksLikeMarkdown("# Header")).toBe(true);
    expect(looksLikeMarkdown("- list item")).toBe(true);
    expect(looksLikeMarkdown("[label](https://example.com)")).toBe(true);
    expect(looksLikeMarkdown("this is **bold**")).toBe(true);
  });

  it("detects fenced code blocks", () => {
    expect(looksLikeMarkdown("```ts\nconst x = 1\n```")).toBe(true);
  });

  it("returns false for non-markdown plain text", () => {
    expect(looksLikeMarkdown("just a plain sentence with /some/path")).toBe(false);
    expect(looksLikeMarkdown("")).toBe(false);
    expect(looksLikeMarkdown("   ")).toBe(false);
  });
});

describe("language detection", () => {
  it("detects language from content", () => {
    expect(detectLanguageFromContent("")).toBe("text");
    expect(detectLanguageFromContent('{"a":1}')).toBe("json");
    expect(detectLanguageFromContent("[1,2,3]")).toBe("json");
    expect(detectLanguageFromContent("<html><body></body></html>")).toBe("html");
    expect(detectLanguageFromContent("@@ -1,1 +1,1 @@\n-a\n+b")).toBe("diff");
  });

  it("detects language from file path extension", () => {
    expect(detectLanguageFromFilePath("index.ts")).toBe("typescript");
    expect(detectLanguageFromFilePath("index.jsx")).toBe("javascript");
    expect(detectLanguageFromFilePath("script.py")).toBe("python");
    expect(detectLanguageFromFilePath("data.json")).toBe("json");
    expect(detectLanguageFromFilePath("styles.css")).toBe("css");
    expect(detectLanguageFromFilePath("page.html")).toBe("html");
    expect(detectLanguageFromFilePath("query.sql")).toBe("sql");
    expect(detectLanguageFromFilePath("README.md")).toBe("markdown");
    expect(detectLanguageFromFilePath("build.sh")).toBe("shell");
    expect(detectLanguageFromFilePath("README")).toBe("text");
    expect(detectLanguageFromFilePath(null)).toBe("text");
  });
});

describe("diff detection", () => {
  it("identifies likely diff by explicit language marker", () => {
    expect(isLikelyDiff("diff", "const a = 1")).toBe(true);
    expect(isLikelyDiff("patch", "const a = 1")).toBe(true);
  });

  it("identifies likely diff by strong diff markers", () => {
    const value = ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1 +1 @@"].join(
      "\n",
    );
    expect(isLikelyDiff("", value)).toBe(true);
  });

  it("identifies likely diff by balanced add/remove/context lines", () => {
    const value = ["-old line", "+new line", " context", " another context"].join("\n");
    expect(isLikelyDiff("", value)).toBe(true);
  });

  it("does not classify plain text as diff", () => {
    expect(isLikelyDiff("", "one\ntwo\nthree")).toBe(false);
  });
});

describe("text helpers", () => {
  it("highlights all case-insensitive query matches", () => {
    const html = renderNodes(buildHighlightedTextNodes("Alpha alpha ALPHA", "alpha", "hl"));
    const markCount = (html.match(/<mark>/g) ?? []).length;

    expect(markCount).toBe(3);
  });

  it("highlights wildcard query matches", () => {
    const html = renderNodes(
      buildHighlightedTextNodes("focus focuses discuss fzzzus", "fo* *cus f*us", "hl-wild"),
    );

    expect(html).toContain("<mark>focus</mark>");
    expect(html).toMatch(/<mark>[^<]*cus[^<]*<\/mark>/);
  });

  it("highlights punctuation-separated query terms as FTS token boundaries", () => {
    const html = renderNodes(
      buildHighlightedTextNodes(
        "we should focus on something concrete",
        "focus+on+something",
        "hl-plus",
      ),
    );

    expect(html).toContain("<mark>focus on something</mark>");
  });

  it("highlights postfix wildcard with punctuation-separated phrase tokens", () => {
    const html = renderNodes(
      buildHighlightedTextNodes("keep focus on somethingElse now", "focus+on+some*", "hl-plus-wc"),
    );

    expect(html).toContain("<mark>focus on somethingElse</mark>");
  });

  it("escapes regex metacharacters in queries", () => {
    expect(escapeRegExp("a+b*c?.[x]")).toBe("a\\+b\\*c\\?\\.\\[x\\]");
  });

  it("renders mark-tag snippets into mark elements", () => {
    const html = renderNode(renderMarkedSnippet("a <mark>hit</mark> b"));

    expect(html).toContain("<mark>hit</mark>");
    expect(html).toContain("<span>a </span>");
    expect(html).toContain("<span> b</span>");
  });

  it("formats valid json and preserves invalid json", () => {
    expect(tryFormatJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(tryFormatJson("{oops")).toBe("{oops");
  });
});

describe("CodeBlock", () => {
  it("highlights phrase matches inside code lines", () => {
    const html = renderNode(
      <CodeBlock
        language="text"
        codeValue="feat(history): add collapsible side panes"
        query={'"history add"'}
        highlightPatterns={["history add"]}
      />,
    );

    expect(html).toContain("<mark>history): add</mark>");
  });

  it("highlights diff content when a query is active", () => {
    const html = renderNode(
      <CodeBlock
        language="diff"
        codeValue={["-feat(history): remove panes", "+feat(history): add panes"].join("\n")}
        query={'"history add"'}
        highlightPatterns={["history add"]}
      />,
    );

    expect(html).toContain("<mark>history): add</mark>");
  });
});
