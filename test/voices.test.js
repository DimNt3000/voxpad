import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { primaryTag, languageName, sortVoices, groupByLanguage, pickForLanguage } from '../js/voices.js';

/** Minimal stand-in for a SpeechSynthesisVoice. */
const voice = (name, lang, extra = {}) => ({
  name,
  lang,
  voiceURI: name,
  localService: false,
  default: false,
  ...extra,
});

const CATALOGUE = [
  voice('Zoe', 'en-GB'),
  voice('Stefanos', 'el-GR', { localService: true }),
  voice('Alex', 'en-US', { default: true }),
  voice('Maria', 'el-GR'),
  voice('Yuri', 'ru-RU'),
];

describe('primaryTag', () => {
  test('takes the language subtag and lowercases it', () => {
    assert.equal(primaryTag('el-GR'), 'el');
    assert.equal(primaryTag('EN_us'), 'en');
    assert.equal(primaryTag('fr'), 'fr');
  });

  test('survives missing input', () => {
    assert.equal(primaryTag(''), '');
    assert.equal(primaryTag(null), '');
    assert.equal(primaryTag(undefined), '');
  });
});

describe('languageName', () => {
  test('resolves a readable name', () => {
    assert.equal(languageName('el-GR', 'en'), 'Greek');
  });

  test('localises the name to the interface language', () => {
    assert.equal(languageName('en-US', 'el'), 'Αγγλικά');
  });

  test('falls back to the uppercased tag for something unknown', () => {
    assert.equal(languageName('zz', 'en'), 'ZZ');
  });

  test('returns the input unchanged when there is no tag at all', () => {
    assert.equal(languageName('', 'en'), '');
  });
});

describe('sortVoices', () => {
  test('puts the preferred languages first, in the order given', () => {
    const sorted = sortVoices(CATALOGUE, ['ru', 'el']);
    assert.equal(primaryTag(sorted[0].lang), 'ru');
    assert.equal(primaryTag(sorted[1].lang), 'el');
  });

  test('groups the remaining languages together alphabetically', () => {
    const tags = sortVoices(CATALOGUE, []).map((v) => primaryTag(v.lang));
    assert.deepEqual(tags, [...tags].sort());
  });

  test('prefers a device voice over a network one within a language', () => {
    const sorted = sortVoices(CATALOGUE, ['el']);
    assert.equal(sorted[0].name, 'Stefanos', 'the local Greek voice should come first');
  });

  test('does not mutate the input', () => {
    const before = CATALOGUE.map((v) => v.name);
    sortVoices(CATALOGUE, ['el']);
    assert.deepEqual(CATALOGUE.map((v) => v.name), before);
  });
});

describe('groupByLanguage', () => {
  test('buckets voices by their primary tag', () => {
    const groups = groupByLanguage(sortVoices(CATALOGUE, []), 'en');
    const byTag = Object.fromEntries(groups.map((g) => [g.tag, g.voices.length]));
    assert.deepEqual(byTag, { el: 2, en: 2, ru: 1 });
  });

  test('labels each group with a readable language name', () => {
    const groups = groupByLanguage(sortVoices(CATALOGUE, ['el']), 'en');
    assert.equal(groups[0].label, 'Greek');
  });

  test('returns nothing for an empty catalogue', () => {
    assert.deepEqual(groupByLanguage([], 'en'), []);
  });
});

describe('pickForLanguage', () => {
  test('prefers the voice the platform marks as default', () => {
    assert.equal(pickForLanguage(CATALOGUE, 'en').name, 'Alex');
  });

  test('falls back to a device voice when nothing is marked default', () => {
    assert.equal(pickForLanguage(CATALOGUE, 'el').name, 'Stefanos');
  });

  test('returns null when the language is not installed', () => {
    assert.equal(pickForLanguage(CATALOGUE, 'ja'), null);
    assert.equal(pickForLanguage([], 'en'), null);
  });
});
