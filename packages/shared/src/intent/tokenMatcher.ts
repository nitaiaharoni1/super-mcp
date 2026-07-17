import { normalizeEmbedInput } from "../embeddings/localEmbed.js";
import type { OntologySnapshot, OntologyTerm } from "../types/semanticTypes.js";

export interface SemanticTermMatch {
  term: OntologyTerm;
  surface: string;
  tokenStart: number;
  tokenEnd: number;
}

type CandidateMatch = SemanticTermMatch & {
  priority: number;
  spanLen: number;
  termLen: number;
};

/** Locale-aware word tokenization of already-normalized text. */
export function tokenizeNormalized(text: string, locale?: string): string[] {
  const normalized = text.trim();
  if (!normalized) return [];

  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    try {
      const segmenter = new Intl.Segmenter(locale || undefined, { granularity: "word" });
      const tokens: string[] = [];
      for (const { segment, isWordLike } of segmenter.segment(normalized)) {
        if (isWordLike) tokens.push(segment);
      }
      if (tokens.length > 0) return tokens;
    } catch {
      // Fall through to whitespace tokenization.
    }
  }

  return normalized.split(/\s+/).filter(Boolean);
}

/**
 * Match ontology terms against free text using token / phrase / exact modes.
 * Returns non-overlapping matches, preferring higher priority and longer spans.
 */
export function matchOntologyTerms(
  text: string,
  ontology: OntologySnapshot,
): SemanticTermMatch[] {
  const normalized = normalizeEmbedInput(text);
  if (!normalized) return [];

  const tokens = tokenizeNormalized(normalized, ontology.locale);
  if (tokens.length === 0) return [];

  const candidates: CandidateMatch[] = [];

  for (const term of ontology.terms) {
    if (term.kind === "stopword") continue;
    const surface = normalizeEmbedInput(term.term);
    if (!surface) continue;

    const mode = term.matchMode ?? "token";
    const termTokens = tokenizeNormalized(surface, ontology.locale);
    if (termTokens.length === 0) continue;

    switch (mode) {
      case "exact": {
        if (normalized === surface) {
          candidates.push({
            term,
            surface,
            tokenStart: 0,
            tokenEnd: tokens.length,
            priority: term.priority ?? 0,
            spanLen: tokens.length,
            termLen: surface.length,
          });
        }
        break;
      }
      case "token": {
        if (termTokens.length !== 1) {
          // Multi-token surfaces still require contiguous token match.
          pushPhraseMatches(candidates, term, surface, termTokens, tokens);
          break;
        }
        const needle = termTokens[0]!;
        for (let i = 0; i < tokens.length; i++) {
          if (tokens[i] === needle) {
            candidates.push({
              term,
              surface,
              tokenStart: i,
              tokenEnd: i + 1,
              priority: term.priority ?? 0,
              spanLen: 1,
              termLen: surface.length,
            });
          }
        }
        break;
      }
      case "phrase":
      case "alias": {
        pushPhraseMatches(candidates, term, surface, termTokens, tokens);
        break;
      }
      default: {
        const _exhaustive: never = mode;
        void _exhaustive;
        break;
      }
    }
  }

  candidates.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (b.spanLen !== a.spanLen) return b.spanLen - a.spanLen;
    if (b.termLen !== a.termLen) return b.termLen - a.termLen;
    return a.tokenStart - b.tokenStart;
  });

  // Track selected spans. Exact same span may host multiple term kinds
  // (e.g. attribute + concept on one surface); partial overlaps are rejected.
  const selectedSpans: Array<{ start: number; end: number }> = [];
  const selected: SemanticTermMatch[] = [];

  for (const c of candidates) {
    const conflicts = selectedSpans.some(
      (s) =>
        !(c.tokenStart === s.start && c.tokenEnd === s.end) &&
        c.tokenStart < s.end &&
        s.start < c.tokenEnd,
    );
    if (conflicts) continue;
    if (!selectedSpans.some((s) => s.start === c.tokenStart && s.end === c.tokenEnd)) {
      selectedSpans.push({ start: c.tokenStart, end: c.tokenEnd });
    }
    selected.push({
      term: c.term,
      surface: c.surface,
      tokenStart: c.tokenStart,
      tokenEnd: c.tokenEnd,
    });
  }

  selected.sort((a, b) => a.tokenStart - b.tokenStart || b.tokenEnd - a.tokenEnd);
  return selected;
}

function pushPhraseMatches(
  candidates: CandidateMatch[],
  term: OntologyTerm,
  surface: string,
  termTokens: string[],
  tokens: string[],
): void {
  const n = termTokens.length;
  if (n === 0 || n > tokens.length) return;
  for (let i = 0; i <= tokens.length - n; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      if (tokens[i + j] !== termTokens[j]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    candidates.push({
      term,
      surface,
      tokenStart: i,
      tokenEnd: i + n,
      priority: term.priority ?? 0,
      spanLen: n,
      termLen: surface.length,
    });
  }
}
