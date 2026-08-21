/**
 * Splits raw text into speakable chunks.
 *
 * Two reasons this exists instead of handing the whole string to the browser:
 *
 *  1. Chromium truncates or silently drops long utterances, so anything past a
 *     couple of hundred characters is unreliable.
 *  2. Sentence sized chunks give us a cursor. We always know which sentence is
 *     playing, which is what makes highlighting, seeking and "next sentence"
 *     possible even on engines that never fire word boundary events.
 *
 * Every chunk carries its offsets in the original string, so the reader view can
 * rebuild the text exactly as the user typed it, whitespace included.
 */

const DEFAULT_MAX = 180;

/** Characters that can close a sentence. The escapes are the Greek question
 *  mark (U+037E) and ano teleia (U+0387), kept as escapes on purpose: an editor
 *  normalizing them to lookalikes silently changes behavior, which is exactly
 *  how the mobile port once lost U+037E. */
const TERMINATORS = new Set(['.', '!', '?', '…', ';', '\u037e', '·', '\u0387', '\n']);
const CLOSERS = new Set(['"', "'", '”', '’', ')', ']', '»']);

/** Terminators that Unicode's sentence algorithm ignores, so the Intl path has
 *  to handle them itself to stay in step with the scanner. */
const FORCED_BREAK = new Set([';', '\u037e', '\u00b7', '\u0387']);

/**
 * @param {string} text
 * @param {number} [maxLen] soft ceiling for a single utterance
 * @returns {{start:number,end:number,text:string}[]}
 */
export function segment(text, maxLen = DEFAULT_MAX) {
  if (!text || !text.trim()) return [];

  const sentences = Intl.Segmenter ? intlSentences(text) : scanSentences(text);
  const chunks = [];

  for (const s of sentences) {
    if (s.end - s.start <= maxLen) chunks.push(s);
    else splitLong(text, s, maxLen, chunks);
  }
  return chunks;
}

/* ------------------------------------------------------------------ split -- */

function intlSentences(text) {
  const out = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
  for (const part of segmenter.segment(text)) {
    let from = part.index;
    const body = part.segment;
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      // Intl keeps hard line breaks inside a segment. Break on them too, so
      // that lists and verse do not turn into one long run-on utterance.
      if (ch === '\n') {
        addSpan(out, text, from, part.index + i);
        from = part.index + i + 1;
        continue;
      }
      // Unicode's sentence algorithm does not break at the Greek question mark
      // or ano teleia, but in Greek both end a sentence. Without this the two
      // segmentation paths would disagree on Greek text. Only break when
      // whitespace follows, so "a;b" inside code or a URL stays intact.
      if (!FORCED_BREAK.has(ch)) continue;
      const next = body[i + 1];
      if (next !== undefined && !/\s/.test(next)) continue;
      addSpan(out, text, from, part.index + i + 1);
      from = part.index + i + 1;
    }
    addSpan(out, text, from, part.index + body.length);
  }
  return out;
}

/** Fallback for engines without Intl.Segmenter (older Firefox, older Safari). */
function scanSentences(text) {
  const out = [];
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    if (!TERMINATORS.has(text[i])) continue;

    let end = i + 1;
    // A line break ends the run immediately: closers on the NEXT line belong
    // to the next sentence, and a chunk must never span a hard line break
    // (the reader's paragraph handling depends on that invariant).
    if (text[i] !== '\n') {
      while (end < text.length && (TERMINATORS.has(text[end]) || CLOSERS.has(text[end]))) {
        if (text[end] === '\n') { end++; break; }
        end++;
      }
    }

    const next = text[end];
    if (next === undefined || /\s/.test(next) || text[i] === '\n') {
      addSpan(out, text, start, end);
      start = end;
      i = end - 1;
    }
  }
  addSpan(out, text, start, text.length);
  return out;
}

/** Breaks an oversized sentence on word boundaries. */
function splitLong(text, span, maxLen, out) {
  const words = [];
  const slice = text.slice(span.start, span.end);
  const re = /\S+/g;
  let match;

  while ((match = re.exec(slice)) !== null) {
    let wordStart = span.start + match.index;
    const wordEnd = wordStart + match[0].length;
    // A single token longer than the limit (a URL, a hash) gets hard split.
    while (wordEnd - wordStart > maxLen) {
      words.push([wordStart, wordStart + maxLen]);
      wordStart += maxLen;
    }
    words.push([wordStart, wordEnd]);
  }

  let from = null;
  let to = null;
  for (const [wordStart, wordEnd] of words) {
    if (from === null) {
      from = wordStart;
      to = wordEnd;
    } else if (wordEnd - from <= maxLen) {
      to = wordEnd;
    } else {
      addSpan(out, text, from, to);
      from = wordStart;
      to = wordEnd;
    }
  }
  if (from !== null) addSpan(out, text, from, to);
}

/** Trims the edges of a span and drops it if nothing is left. */
function addSpan(out, text, start, end) {
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (end > start) out.push({ start, end, text: text.slice(start, end) });
}

/* ------------------------------------------------------------- utilities -- */

/** Word boundary containing or following `index`, used when the engine reports
 *  a boundary without a length (Safari does this). */
export function wordAt(text, index) {
  let start = Math.max(0, Math.min(index, text.length - 1));
  while (start < text.length && /\s/.test(text[start])) start++;
  if (start >= text.length) return null;

  let end = start;
  while (end < text.length && !/\s/.test(text[end])) end++;
  return { start, length: end - start };
}

export function countWords(text) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Rough listening time. 170 words per minute is a common speaking pace. */
export function estimateSeconds(wordCount, rate = 1) {
  if (!wordCount) return 0;
  return Math.round((wordCount / (170 * (rate || 1))) * 60);
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Detects the writing system so we can suggest a matching voice. Latin script
 * is deliberately reported as null: it covers too many languages to guess from
 * characters alone.
 * @returns {{script:string, lang:string}|null}
 */
export function detectScript(text) {
  const sample = text.slice(0, 4000);
  const counts = {
    el: (sample.match(/[Ͱ-Ͽἀ-῿]/g) || []).length,
    ru: (sample.match(/[Ѐ-ӿ]/g) || []).length,
    ar: (sample.match(/[؀-ۿ]/g) || []).length,
    he: (sample.match(/[֐-׿]/g) || []).length,
    latin: (sample.match(/[a-zÀ-ɏ]/gi) || []).length,
  };

  const scripts = { el: 'Greek', ru: 'Cyrillic', ar: 'Arabic', he: 'Hebrew' };
  let best = null;
  for (const key of Object.keys(scripts)) {
    if (counts[key] > counts.latin && counts[key] > (best ? counts[best] : 8)) best = key;
  }
  return best ? { script: scripts[best], lang: best } : null;
}
