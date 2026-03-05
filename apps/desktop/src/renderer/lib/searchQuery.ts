export function buildSearchHighlightRegex(
  query: string,
  highlightPatterns: string[] = [],
): RegExp | null {
  const patternsSource =
    highlightPatterns.length > 0
      ? highlightPatterns.map((pattern) => normalizeToken(pattern))
      : query
          .trim()
          .split(/\s+/)
          .map((token) => normalizeToken(token));

  const patterns = Array.from(
    new Set(
      patternsSource
        .filter((token) => token.length > 0)
        .map((token) => tokenToRegexFragment(token))
        .filter((fragment) => fragment.length > 0),
    ),
  ).sort((left, right) => right.length - left.length);

  if (patterns.length === 0) {
    return null;
  }

  return new RegExp(patterns.join("|"), "giu");
}

function normalizeToken(token: string): string {
  return token.trim().replace(/\*+/g, "*");
}

function tokenToRegexFragment(token: string): string {
  if (supportsPostfixWildcard(token)) {
    const base = token.slice(0, -1).trim();
    if (base.length === 0) {
      return "";
    }
    return buildLiteralTokenFragment(base, true);
  }

  if (token.includes("*")) {
    const literal = token.replaceAll("*", "").trim();
    return literal.length > 0 ? buildLiteralTokenFragment(literal, false) : "";
  }

  return buildLiteralTokenFragment(token, false);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function supportsPostfixWildcard(token: string): boolean {
  return token.length > 1 && token.endsWith("*") && token.indexOf("*") === token.length - 1;
}

function buildLiteralTokenFragment(value: string, isPrefix: boolean): string {
  const terms = value.match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (terms.length === 0) {
    return escapeRegExp(value);
  }

  const escapedTerms = terms.map((term) => escapeRegExp(term));
  if (escapedTerms.length === 1) {
    const single = escapedTerms[0] ?? "";
    return isPrefix ? `${single}[\\p{L}\\p{N}_]*` : single;
  }

  const separator = "[^\\p{L}\\p{N}_]+";
  if (!isPrefix) {
    return escapedTerms.join(separator);
  }

  const head = escapedTerms.slice(0, -1).join(separator);
  const tail = escapedTerms[escapedTerms.length - 1] ?? "";
  return `${head}${separator}${tail}[\\p{L}\\p{N}_]*`;
}
