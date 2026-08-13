/**
 * Voice discovery.
 *
 * getVoices() returns an empty array on the first call in Chromium because the
 * list is fetched asynchronously, and the voiceschanged event does not fire at
 * all in some Safari builds. So: resolve on whichever comes first, and keep
 * listening afterwards because installing a system voice updates the list while
 * the page is open.
 */

const POLL_MS = 150;

export function loadVoices({ timeout = 4000 } = {}) {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth) {
      resolve([]);
      return;
    }

    let settled = false;
    const finish = (voices) => {
      if (settled) return;
      settled = true;
      clearInterval(poller);
      clearTimeout(limit);
      synth.removeEventListener('voiceschanged', onChange);
      resolve(voices);
    };

    const check = () => {
      const voices = synth.getVoices();
      if (voices && voices.length) finish(voices);
    };

    const onChange = () => check();
    synth.addEventListener('voiceschanged', onChange);

    const poller = setInterval(check, POLL_MS);
    const limit = setTimeout(() => finish(synth.getVoices() || []), timeout);
    check();
  });
}

/** Fires whenever the system voice list changes after the initial load. */
export function onVoicesChanged(callback) {
  const synth = window.speechSynthesis;
  if (!synth) return () => {};
  const handler = () => callback(synth.getVoices() || []);
  synth.addEventListener('voiceschanged', handler);
  return () => synth.removeEventListener('voiceschanged', handler);
}

export const primaryTag = (lang) => String(lang || '').split(/[-_]/)[0].toLowerCase();

/** Human readable language name, from the browser's own locale data. */
export function languageName(lang, uiLang) {
  const tag = primaryTag(lang);
  if (!tag) return lang || '';
  try {
    const names = new Intl.DisplayNames([uiLang], { type: 'language' });
    const label = names.of(tag);
    if (label && label.toLowerCase() !== tag) return label;
  } catch (error) {
    /* Intl.DisplayNames is missing or the tag is unknown, fall through. */
  }
  return tag.toUpperCase();
}

/**
 * Sorts voices so the ones the user is likely to want come first: the language
 * of the text, then the interface language, then everything else by name.
 */
export function sortVoices(voices, preferredTags = []) {
  const rank = (voice) => {
    const tag = primaryTag(voice.lang);
    const position = preferredTags.indexOf(tag);
    return position === -1 ? preferredTags.length : position;
  };

  return [...voices].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank) return byRank;
    const byLang = primaryTag(a.lang).localeCompare(primaryTag(b.lang));
    if (byLang) return byLang;
    if (a.localService !== b.localService) return a.localService ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** Groups a sorted voice list into { tag, label, voices } buckets. */
export function groupByLanguage(voices, uiLang) {
  const groups = new Map();
  for (const voice of voices) {
    const tag = primaryTag(voice.lang);
    if (!groups.has(tag)) {
      groups.set(tag, { tag, label: languageName(voice.lang, uiLang), voices: [] });
    }
    groups.get(tag).voices.push(voice);
  }
  return [...groups.values()];
}

/** Best voice for a language tag: the default one if there is one, else the
 *  first offline voice, else the first match. */
export function pickForLanguage(voices, tag) {
  const matches = voices.filter((voice) => primaryTag(voice.lang) === tag);
  if (!matches.length) return null;
  return matches.find((voice) => voice.default) ||
         matches.find((voice) => voice.localService) ||
         matches[0];
}
