/**
 * The parity checks below are the reason this file exists: the two language
 * tables are edited by hand, and a key added to one but not the other shows up
 * as raw key text in the interface rather than as an error.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { LANGUAGES, setLanguage, getLanguage, t, sampleText, scriptName } from '../js/i18n.js';

/** Keys whose value is a function need arguments; these cover every one of
 *  them so a formatter can be called without throwing. */
const ARGS = {
  'voice.hint': { script: 'Greek' },
  'voice.count': { n: 2 },
  'status.ready': { n: 3 },
  'status.speaking': { i: 1, n: 3 },
  'status.paused': { i: 1, n: 3 },
  'meta.counts': { words: 5, chars: 20, duration: '0:07' },
  'error.speech': { error: 'synthesis-failed' },
};

/** Every key used anywhere in the interface, gathered from the markup and the
 *  runtime call sites. */
const KEYS = [
  'tagline',
  'ui.language', 'ui.theme', 'ui.themeToDark', 'ui.themeToLight', 'ui.close',
  'doc.heading', 'doc.tabs', 'doc.label', 'doc.placeholder',
  'tab.edit', 'tab.read',
  'tool.import', 'tool.sample', 'tool.clear', 'tool.clearConfirm',
  'reader.label', 'reader.empty', 'reader.hint',
  'voice.heading', 'voice.language', 'voice.allLanguages', 'voice.voice',
  'voice.useMatch', 'voice.none', 'voice.local', 'voice.network', 'voice.hint', 'voice.count',
  'delivery.heading', 'delivery.rate', 'delivery.pitch', 'delivery.volume', 'delivery.reset',
  'preset.group', 'preset.slow', 'preset.normal', 'preset.brisk',
  'transport.prev', 'transport.play', 'transport.pause', 'transport.resume',
  'transport.stop', 'transport.next', 'transport.seek',
  'status.idle', 'status.empty', 'status.ready', 'status.speaking', 'status.paused', 'status.done',
  'meta.counts', 'meta.empty',
  'footer.note', 'footer.nav', 'footer.privacy', 'footer.shortcuts',
  'shortcuts.title', 'shortcuts.space', 'shortcuts.esc', 'shortcuts.arrows',
  'shortcuts.ctrlEnter', 'shortcuts.question',
  'drop.hint',
  'error.unsupported', 'error.speech', 'error.fileType', 'error.fileSize', 'error.fileRead',
];

/** setLanguage writes to document.documentElement.lang. */
function withDocumentStub(fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const previous = globalThis.document;
  Object.defineProperty(globalThis, 'document', {
    value: { documentElement: {} },
    writable: true,
    configurable: true,
  });
  try {
    return fn();
  } finally {
    if (had) globalThis.document = previous;
    else delete globalThis.document;
  }
}

describe('translation tables', () => {
  test('every key resolves in every language', () => {
    withDocumentStub(() => {
      const missing = [];
      for (const lang of LANGUAGES) {
        setLanguage(lang);
        for (const key of KEYS) {
          const value = t(key, ARGS[key]);
          // t() returns the key itself when nothing matched.
          if (value === key) missing.push(`${lang}: ${key}`);
          if (typeof value !== 'string' || value.trim() === '') missing.push(`${lang}: ${key} (empty)`);
        }
      }
      assert.deepEqual(missing, []);
    });
  });

  test('the two languages produce different text, so nothing silently falls back', () => {
    withDocumentStub(() => {
      // A handful of keys legitimately match across languages, but the bulk
      // must differ or the Greek table is not really being used.
      let differing = 0;
      for (const key of KEYS) {
        setLanguage('en');
        const en = t(key, ARGS[key]);
        setLanguage('el');
        const el = t(key, ARGS[key]);
        if (en !== el) differing++;
      }
      assert.ok(differing > KEYS.length * 0.9, `only ${differing} of ${KEYS.length} keys differ`);
    });
  });

  test('an unknown key returns the key rather than throwing', () => {
    withDocumentStub(() => {
      setLanguage('en');
      assert.equal(t('nope.not.a.key'), 'nope.not.a.key');
    });
  });

  test('plural forms react to the count', () => {
    withDocumentStub(() => {
      setLanguage('en');
      assert.notEqual(t('status.ready', { n: 1 }), t('status.ready', { n: 2 }));
      setLanguage('el');
      assert.notEqual(t('status.ready', { n: 1 }), t('status.ready', { n: 2 }));
    });
  });
});

describe('language selection', () => {
  test('accepts the supported languages and rejects anything else', () => {
    withDocumentStub(() => {
      assert.equal(setLanguage('el'), 'el');
      assert.equal(getLanguage(), 'el');
      assert.equal(setLanguage('zz'), 'en', 'an unsupported language falls back to English');
    });
  });

  test('records the language on the document for assistive technology', () => {
    withDocumentStub(() => {
      setLanguage('el');
      assert.equal(globalThis.document.documentElement.lang, 'el');
    });
  });
});

describe('sample text', () => {
  test('each language has its own sample, in its own script', () => {
    withDocumentStub(() => {
      setLanguage('en');
      const en = sampleText();
      setLanguage('el');
      const el = sampleText();

      assert.notEqual(en, el);
      assert.ok(/[Ͱ-Ͽ]/.test(el), 'the Greek sample should contain Greek letters');
      assert.ok(!/[Ͱ-Ͽ]/.test(en), 'the English sample should not');
    });
  });

  test('samples contain several sentences, so the reader has something to show', () => {
    withDocumentStub(() => {
      for (const lang of LANGUAGES) {
        setLanguage(lang);
        assert.ok(sampleText().split(/[.!?]/).length > 3, `${lang} sample is too short`);
      }
    });
  });
});

describe('scriptName', () => {
  test('translates the script label', () => {
    withDocumentStub(() => {
      setLanguage('el');
      assert.equal(scriptName('Greek'), 'Ελληνικά');
      setLanguage('en');
      assert.equal(scriptName('Greek'), 'Greek');
    });
  });

  test('passes an unknown script through unchanged', () => {
    withDocumentStub(() => {
      setLanguage('en');
      assert.equal(scriptName('Klingon'), 'Klingon');
    });
  });
});
