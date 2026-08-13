/**
 * Preferences in localStorage.
 *
 * Two things are stored: the settings below, and the draft text, so a reload
 * does not throw away what you were listening to. Both are readable only by
 * this origin, nothing is sent anywhere, and the Clear button removes the draft
 * immediately. Storage can also be unavailable (private mode, blocked cookies),
 * so every access is guarded and the app keeps working without it.
 */

const KEY = 'voxpad:prefs';
const TEXT_KEY = 'voxpad:draft';
const SAVE_DELAY = 400;
const MAX_DRAFT = 200_000;

export const DEFAULTS = {
  theme: null,        // null means follow the system setting
  lang: null,         // null means follow the browser language
  rate: 1,
  pitch: 1,
  volume: 1,
  voiceURI: null,
  langFilter: 'all',
};

let saveTimer = null;

function readRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function writeRaw(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    // Quota exceeded or storage disabled. Not worth interrupting the user.
    return false;
  }
}

export function loadPrefs() {
  const raw = readRaw(KEY);
  if (!raw) return { ...DEFAULTS };
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch (error) {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs) {
  writeRaw(KEY, JSON.stringify(prefs));
}

export const loadDraft = () => readRaw(TEXT_KEY) || '';

/** Debounced so typing does not hit storage on every keystroke. */
export function saveDraft(text) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!text) clearDraft();
    else writeRaw(TEXT_KEY, text.slice(0, MAX_DRAFT));
  }, SAVE_DELAY);
}

export function clearDraft() {
  clearTimeout(saveTimer);
  try {
    localStorage.removeItem(TEXT_KEY);
  } catch (error) {
    /* nothing to clear */
  }
}
