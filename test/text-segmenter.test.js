import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  segment,
  wordAt,
  countWords,
  estimateSeconds,
  formatDuration,
  detectScript,
} from '../js/text-segmenter.js';

const NL = '\n';
const texts = (chunks) => chunks.map((c) => c.text);

/** Runs `fn` with Intl.Segmenter removed, which is the code path Hermes and
 *  older browsers take. Both paths must satisfy the same contract. */
function withoutIntlSegmenter(fn) {
  const original = Intl.Segmenter;
  delete Intl.Segmenter;
  try {
    fn();
  } finally {
    Intl.Segmenter = original;
  }
}

/** Every assertion that must hold on both the Intl and the scanner path. */
function bothPaths(name, fn) {
  test(`${name} (Intl path)`, () => fn());
  test(`${name} (scanner path)`, () => withoutIntlSegmenter(fn));
}

describe('segment', () => {
  bothPaths('splits on sentence punctuation', () => {
    assert.deepEqual(texts(segment('One. Two! Three?')), ['One.', 'Two!', 'Three?']);
  });

  bothPaths('treats the Greek question mark and ano teleia as terminators', () => {
    // U+037E and U+0387, the two Greek marks the mobile port once lost.
    const text = `Ερώτηση; Ναί· Τέλος.`;
    assert.equal(segment(text).length, 3);
  });

  bothPaths('treats the ASCII semicolon as a terminator, as Greek typing produces it', () => {
    assert.equal(segment('Ερώτηση; Απάντηση.').length, 2);
  });

  test('our own rule ignores a semicolon with no space after it (scanner path)', () => {
    // Only asserted on the scanner, the path this code fully controls. The
    // Intl path defers to the platform's sentence rules, and those differ:
    // Chromium breaks at every semicolon, Node's ICU at none.
    withoutIntlSegmenter(() => {
      assert.deepEqual(texts(segment('const a={x:1;y:2}; done.')), ['const a={x:1;y:2};', 'done.']);
      assert.deepEqual(texts(segment('See https://a.com/x;y;z now.')), ['See https://a.com/x;y;z now.']);
    });
  });

  bothPaths('returns offsets that map back onto the source exactly', () => {
    const text = 'Πρώτη πρόταση.  Δεύτερη!\n\nΤρίτη εδώ;';
    for (const chunk of segment(text)) {
      assert.equal(text.slice(chunk.start, chunk.end), chunk.text);
    }
  });

  bothPaths('never emits a chunk containing a hard line break', () => {
    // The reader's paragraph grouping depends on this invariant.
    const samples = [
      `He waved${NL}"Hello there!"`,
      `Line one${NL})closer first`,
      `Ends here.${NL}${NL}New paragraph.`,
      `a${NL}b${NL}c`,
    ];
    for (const text of samples) {
      for (const chunk of segment(text)) {
        assert.ok(!chunk.text.includes(NL), `chunk crossed a newline in: ${JSON.stringify(text)}`);
      }
    }
  });

  bothPaths('keeps a closing quote that belongs to the same line', () => {
    assert.deepEqual(texts(segment('Είπε: "Ναι!" Μετά έφυγε.')), ['Είπε: "Ναι!"', 'Μετά έφυγε.']);
  });

  bothPaths('does not steal the opening quote of the next line', () => {
    const chunks = segment(`He waved${NL}"Hello there!"`);
    assert.deepEqual(texts(chunks), ['He waved', '"Hello there!"']);
  });

  bothPaths('drops whitespace-only input', () => {
    assert.deepEqual(segment(''), []);
    assert.deepEqual(segment('   \n\t  '), []);
  });

  bothPaths('respects the maximum chunk length', () => {
    const maxLen = 40;
    const long = 'Μια πολύ μεγάλη πρόταση με αρκετές λέξεις που ξεπερνά σίγουρα το όριο των χαρακτήρων.';
    for (const chunk of segment(long, maxLen)) {
      assert.ok(chunk.text.length <= maxLen, `chunk of ${chunk.text.length} exceeded ${maxLen}`);
    }
  });

  bothPaths('hard splits a single token longer than the limit', () => {
    const token = 'x'.repeat(120);
    const chunks = segment(`Before ${token} after.`, 50);
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) assert.ok(chunk.text.length <= 50);
    // The token survives in full, and consecutive pieces of it sit adjacent
    // with no gap, so a renderer must not insert whitespace between them.
    assert.equal(chunks.map((c) => c.text).join('').replace(/[^x]/g, '').length, token.length);
    const adjacent = chunks.filter((c, i) => i > 0 && chunks[i - 1].end === c.start);
    assert.ok(adjacent.length >= 1, 'expected at least one zero-width gap from the hard split');
  });

  bothPaths('splits on hard line breaks so verse does not run together', () => {
    assert.deepEqual(texts(segment(`first line${NL}second line${NL}third line`)),
      ['first line', 'second line', 'third line']);
  });

  bothPaths('keeps surrogate pairs intact', () => {
    const chunks = segment('Hello 👋 world 🌍! Δεύτερη 🚀 πρόταση.');
    for (const chunk of chunks) {
      // A lone surrogate would make the string non round-trippable.
      assert.equal([...chunk.text].join(''), chunk.text);
    }
  });

  bothPaths('handles CRLF pasted from Windows', () => {
    const chunks = segment('Line one.\r\nLine two.\r\n\r\nLine four.');
    assert.equal(chunks.length, 3);
    for (const chunk of chunks) assert.ok(!/[\r\n]/.test(chunk.text));
  });
});

describe('wordAt', () => {
  test('returns the word starting at the index', () => {
    assert.deepEqual(wordAt('alpha beta gamma', 6), { start: 6, length: 4 });
  });

  test('skips forward when the index lands on whitespace', () => {
    assert.deepEqual(wordAt('alpha  beta', 5), { start: 7, length: 4 });
  });

  test('returns null past the end of the text', () => {
    assert.equal(wordAt('alpha ', 5), null);
    assert.equal(wordAt('', 0), null);
  });
});

describe('counting and formatting', () => {
  test('countWords ignores surrounding and repeated whitespace', () => {
    assert.equal(countWords('  ένα δύο   τρία  '), 3);
    assert.equal(countWords(''), 0);
    assert.equal(countWords('   '), 0);
  });

  test('estimateSeconds scales inversely with rate', () => {
    const base = estimateSeconds(170, 1);
    assert.equal(base, 60);
    assert.equal(estimateSeconds(170, 2), 30);
    assert.equal(estimateSeconds(0, 1), 0);
  });

  test('estimateSeconds survives a zero rate instead of dividing by zero', () => {
    assert.ok(Number.isFinite(estimateSeconds(100, 0)));
  });

  test('formatDuration pads and adds hours only when needed', () => {
    assert.equal(formatDuration(0), '0:00');
    assert.equal(formatDuration(9), '0:09');
    assert.equal(formatDuration(75), '1:15');
    assert.equal(formatDuration(3725), '1:02:05');
    assert.equal(formatDuration(-5), '0:00');
  });
});

describe('detectScript', () => {
  test('detects Greek', () => {
    assert.deepEqual(detectScript('Καλημέρα κόσμε'), { script: 'Greek', lang: 'el' });
  });

  test('detects Cyrillic', () => {
    assert.deepEqual(detectScript('Доброе утро мир'), { script: 'Cyrillic', lang: 'ru' });
  });

  test('reports null for Latin, which covers too many languages to guess', () => {
    assert.equal(detectScript('Good morning world'), null);
  });

  test('reports null when Latin dominates a mixed text', () => {
    assert.equal(detectScript('Mostly English with ένα ελληνικό'), null);
  });

  test('reports null for empty input', () => {
    assert.equal(detectScript(''), null);
  });
});
