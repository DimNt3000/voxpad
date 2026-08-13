/**
 * Application controller: wires the DOM to the speech engine, the reader view
 * and the stored preferences. Everything below is glue. The interesting parts
 * live in tts-engine.js, text-segmenter.js and reader-view.js.
 */

import { TtsEngine } from './tts-engine.js';
import { ReaderView } from './reader-view.js';
import { loadVoices, onVoicesChanged, sortVoices, groupByLanguage, primaryTag, pickForLanguage } from './voices.js';
import { countWords, estimateSeconds, formatDuration, detectScript } from './text-segmenter.js';
import { loadPrefs, savePrefs, loadDraft, saveDraft, clearDraft, DEFAULTS } from './storage.js';
import { applyTranslations, detectLanguage, setLanguage, getLanguage, t, sampleText, scriptName, LANGUAGES } from './i18n.js';

const $ = (id) => document.getElementById(id);
const MAX_FILE_BYTES = 1024 * 1024;
const TYPING_DELAY = 250;

const el = {
  text: $('text'),
  docMeta: $('docMeta'),
  reader: $('reader'),
  tabEdit: $('tabEdit'),
  tabRead: $('tabRead'),
  paneEdit: $('paneEdit'),
  paneRead: $('paneRead'),
  importBtn: $('importBtn'),
  fileInput: $('fileInput'),
  sampleBtn: $('sampleBtn'),
  clearBtn: $('clearBtn'),
  clearLabel: $('clearLabel'),
  langFilter: $('langFilter'),
  voiceSelect: $('voiceSelect'),
  voiceNote: $('voiceNote'),
  langHint: $('langHint'),
  langHintText: $('langHintText'),
  langHintApply: $('langHintApply'),
  rate: $('rate'),
  pitch: $('pitch'),
  volume: $('volume'),
  rateOut: $('rateOut'),
  pitchOut: $('pitchOut'),
  volumeOut: $('volumeOut'),
  resetBtn: $('resetBtn'),
  prevBtn: $('prevBtn'),
  playBtn: $('playBtn'),
  playIcon: $('playIcon'),
  stopBtn: $('stopBtn'),
  nextBtn: $('nextBtn'),
  seek: $('seek'),
  status: $('status'),
  transport: $('transport'),
  themeBtn: $('themeBtn'),
  shortcutsBtn: $('shortcutsBtn'),
  shortcutsDialog: $('shortcutsDialog'),
  dropOverlay: $('dropOverlay'),
  banner: $('protocolNotice'),
};

const prefs = loadPrefs();
const supported = TtsEngine.supported;
const engine = new TtsEngine();

let allVoices = [];
let currentVoice = null;
let suggestedTag = null;
let readerDirty = true;
let seeking = false;
let typingTimer = null;
let clearTimer = null;
let dragDepth = 0;

const reader = new ReaderView(el.reader, {
  onSentenceClick: (index) => {
    if (!supported) return;
    engine.play(index);
  },
});

/* ------------------------------------------------------------------ boot -- */

function init() {
  setLanguage(prefs.lang || detectLanguage());
  applyLanguageUi();

  applyTheme(prefs.theme);
  watchSystemTheme();

  el.rate.value = prefs.rate;
  el.pitch.value = prefs.pitch;
  el.volume.value = prefs.volume;
  syncSliderOutputs();
  engine.applySettings({ rate: prefs.rate, pitch: prefs.pitch, volume: prefs.volume });

  bindEngine();
  bindDocument();
  bindControls();
  bindTransport();
  bindKeyboard();
  bindFiles();
  watchTransportHeight();

  el.text.value = loadDraft();
  refreshText({ immediate: true });

  if (!supported) {
    showBanner(t('error.unsupported'));
    [el.playBtn, el.prevBtn, el.nextBtn, el.stopBtn, el.seek].forEach((node) => { node.disabled = true; });
  } else {
    setupVoices();
  }

  registerServiceWorker();
}

/* --------------------------------------------------------------- engine -- */

function bindEngine() {
  engine.addEventListener('statechange', () => {
    updatePlayButton();
    updateStatus();
    updateTransportState();
  });

  engine.addEventListener('sentence', (event) => {
    reader.setActive(event.detail.index);
    updateStatus();
  });

  engine.addEventListener('boundary', (event) => {
    const { index, charIndex, charLength } = event.detail;
    reader.setWord(index, charIndex, charLength);
  });

  engine.addEventListener('progress', (event) => {
    if (seeking) return;
    el.seek.value = String(Math.round(event.detail.ratio * 1000));
  });

  engine.addEventListener('end', () => {
    el.status.textContent = t('status.done');
  });

  engine.addEventListener('ttserror', (event) => {
    el.status.textContent = t('error.speech', { error: event.detail.error });
  });
}

/* -------------------------------------------------------------- content -- */

/** Reloads the engine from the textarea. Debounced while typing. */
function refreshText({ immediate = false } = {}) {
  clearTimeout(typingTimer);
  const run = () => {
    engine.load(el.text.value);
    readerDirty = true;
    if (!el.paneRead.hidden) ensureReader();
    updateMeta();
    updateTransportState();
    updateStatus();
    updateLanguageHint();
  };
  if (immediate) run();
  else typingTimer = setTimeout(run, TYPING_DELAY);
}

function ensureReader() {
  if (!readerDirty) return;
  reader.setEmptyMessage(t('reader.empty'));
  reader.render(el.text.value, engine.chunks);
  readerDirty = false;
  if (engine.isBusy) reader.setActive(engine.index);
}

function updateMeta() {
  const value = el.text.value;
  const words = countWords(value);
  if (!words) {
    el.docMeta.textContent = t('meta.empty');
    return;
  }
  const duration = formatDuration(estimateSeconds(words, Number(el.rate.value)));
  el.docMeta.textContent = t('meta.counts', { words, chars: value.length, duration });
}

function setText(value) {
  el.text.value = value;
  saveDraft(value);
  refreshText({ immediate: true });
}

/* --------------------------------------------------------------- voices -- */

async function setupVoices() {
  applyVoiceList(await loadVoices());
  onVoicesChanged((voices) => {
    if (voices.length !== allVoices.length) applyVoiceList(voices);
  });
}

function applyVoiceList(voices) {
  const preferred = [suggestedTag, getLanguage(), primaryTag(navigator.language)].filter(Boolean);
  allVoices = sortVoices(voices, [...new Set(preferred)]);

  if (!allVoices.length) {
    el.voiceNote.textContent = t('voice.none');
    el.voiceSelect.disabled = true;
    return;
  }

  el.voiceSelect.disabled = false;
  buildLanguageFilter();
  buildVoiceOptions();

  const saved = prefs.voiceURI && allVoices.find((voice) => voice.voiceURI === prefs.voiceURI);
  selectVoice(saved || pickForLanguage(allVoices, getLanguage()) || allVoices[0], { persist: false });
  updateLanguageHint();
}

function buildLanguageFilter() {
  const groups = groupByLanguage(sortVoices(allVoices, []), getLanguage());
  const previous = prefs.langFilter;

  el.langFilter.textContent = '';
  const all = new Option(t('voice.allLanguages'), 'all');
  el.langFilter.append(all);

  for (const group of groups) {
    el.langFilter.append(new Option(`${group.label} (${group.voices.length})`, group.tag));
  }
  el.langFilter.value = groups.some((group) => group.tag === previous) ? previous : 'all';
  prefs.langFilter = el.langFilter.value;
}

function visibleVoices() {
  const filter = el.langFilter.value;
  return filter === 'all' ? allVoices : allVoices.filter((voice) => primaryTag(voice.lang) === filter);
}

function buildVoiceOptions() {
  const voices = visibleVoices();
  el.voiceSelect.textContent = '';

  for (const group of groupByLanguage(voices, getLanguage())) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = `${group.label} (${group.tag})`;
    for (const voice of group.voices) {
      const option = new Option(voice.name, String(allVoices.indexOf(voice)));
      optgroup.append(option);
    }
    el.voiceSelect.append(optgroup);
  }
  if (!el.voiceSelect.options.length) el.voiceSelect.append(new Option(t('voice.none'), ''));
}

function selectVoice(voice, { persist = true } = {}) {
  if (!voice) return;
  const index = allVoices.indexOf(voice);
  if (index === -1) return;

  // The voice may sit outside the active language filter, so widen it.
  if (el.langFilter.value !== 'all' && primaryTag(voice.lang) !== el.langFilter.value) {
    el.langFilter.value = 'all';
    prefs.langFilter = 'all';
    buildVoiceOptions();
  }

  currentVoice = voice;
  el.voiceSelect.value = String(index);
  engine.applySettings({ voice });
  el.voiceNote.textContent = voice.localService ? t('voice.local') : t('voice.network');

  if (persist) {
    prefs.voiceURI = voice.voiceURI;
    savePrefs(prefs);
  } else {
    prefs.voiceURI = voice.voiceURI;
  }
  updateLanguageHint();
}

/** Offers a matching voice when the text is written in a non Latin script. */
function updateLanguageHint() {
  const detected = detectScript(el.text.value);
  suggestedTag = detected ? detected.lang : null;

  const needsSwitch = Boolean(
    detected &&
    allVoices.length &&
    currentVoice &&
    primaryTag(currentVoice.lang) !== detected.lang &&
    pickForLanguage(allVoices, detected.lang)
  );

  el.langHint.hidden = !needsSwitch;
  if (needsSwitch) {
    el.langHintText.textContent = t('voice.hint', { script: scriptName(detected.script) });
  }
}

/* ------------------------------------------------------------------ tabs -- */

function showTab(name) {
  const readMode = name === 'read';
  el.tabRead.classList.toggle('is-on', readMode);
  el.tabEdit.classList.toggle('is-on', !readMode);
  el.tabRead.setAttribute('aria-selected', String(readMode));
  el.tabEdit.setAttribute('aria-selected', String(!readMode));
  el.tabRead.tabIndex = readMode ? 0 : -1;
  el.tabEdit.tabIndex = readMode ? -1 : 0;
  el.paneRead.hidden = !readMode;
  el.paneEdit.hidden = readMode;
  if (readMode) ensureReader();
}

/* -------------------------------------------------------------- binding -- */

function bindDocument() {
  el.text.addEventListener('input', () => {
    saveDraft(el.text.value);
    refreshText();
    resetClearButton();
  });

  el.tabEdit.addEventListener('click', () => showTab('edit'));
  el.tabRead.addEventListener('click', () => showTab('read'));

  el.sampleBtn.addEventListener('click', () => {
    setText(sampleText());
    showTab('edit');
  });

  el.clearBtn.addEventListener('click', () => {
    if (!el.text.value) return;
    if (el.clearBtn.dataset.confirm !== '1') {
      el.clearBtn.dataset.confirm = '1';
      el.clearLabel.textContent = t('tool.clearConfirm');
      clearTimer = setTimeout(resetClearButton, 3000);
      return;
    }
    resetClearButton();
    engine.stop();
    clearDraft();
    setText('');
    el.text.focus();
  });
}

function resetClearButton() {
  clearTimeout(clearTimer);
  delete el.clearBtn.dataset.confirm;
  el.clearLabel.textContent = t('tool.clear');
}

function bindControls() {
  el.langFilter.addEventListener('change', () => {
    prefs.langFilter = el.langFilter.value;
    savePrefs(prefs);
    buildVoiceOptions();
    const voices = visibleVoices();
    if (voices.length && !voices.includes(currentVoice)) selectVoice(voices[0]);
    else if (currentVoice) el.voiceSelect.value = String(allVoices.indexOf(currentVoice));
  });

  el.voiceSelect.addEventListener('change', () => {
    const voice = allVoices[Number(el.voiceSelect.value)];
    if (voice) selectVoice(voice);
  });

  el.langHintApply.addEventListener('click', () => {
    const voice = suggestedTag && pickForLanguage(allVoices, suggestedTag);
    if (voice) selectVoice(voice);
  });

  bindSlider(el.rate, 'rate', () => { syncSliderOutputs(); updateMeta(); });
  bindSlider(el.pitch, 'pitch', syncSliderOutputs);
  bindSlider(el.volume, 'volume', syncSliderOutputs);

  document.querySelectorAll('[data-rate]').forEach((button) => {
    button.addEventListener('click', () => {
      el.rate.value = button.dataset.rate;
      prefs.rate = Number(button.dataset.rate);
      savePrefs(prefs);
      engine.applySettings({ rate: prefs.rate });
      syncSliderOutputs();
      updateMeta();
    });
  });

  el.resetBtn.addEventListener('click', () => {
    el.rate.value = DEFAULTS.rate;
    el.pitch.value = DEFAULTS.pitch;
    el.volume.value = DEFAULTS.volume;
    Object.assign(prefs, { rate: DEFAULTS.rate, pitch: DEFAULTS.pitch, volume: DEFAULTS.volume });
    savePrefs(prefs);
    engine.applySettings({ rate: prefs.rate, pitch: prefs.pitch, volume: prefs.volume });
    syncSliderOutputs();
    updateMeta();
  });

  el.themeBtn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    prefs.theme = next;
    savePrefs(prefs);
    applyTheme(next);
  });

  document.querySelectorAll('[data-set-lang]').forEach((button) => {
    button.addEventListener('click', () => {
      const lang = button.dataset.setLang;
      if (!LANGUAGES.includes(lang) || lang === getLanguage()) return;
      setLanguage(lang);
      prefs.lang = lang;
      savePrefs(prefs);
      applyLanguageUi();
      if (allVoices.length) {
        buildLanguageFilter();
        buildVoiceOptions();
        if (currentVoice) el.voiceSelect.value = String(allVoices.indexOf(currentVoice));
      }
    });
  });

  el.shortcutsBtn.addEventListener('click', () => {
    if (typeof el.shortcutsDialog.showModal === 'function') el.shortcutsDialog.showModal();
    else el.shortcutsDialog.setAttribute('open', '');
  });
}

/** Live display on input, engine restart only once the value settles. */
function bindSlider(input, key, onUpdate) {
  input.addEventListener('input', () => {
    prefs[key] = Number(input.value);
    onUpdate();
    if (engine.state === 'idle') engine.applySettings({ [key]: prefs[key] });
  });
  input.addEventListener('change', () => {
    prefs[key] = Number(input.value);
    savePrefs(prefs);
    engine.applySettings({ [key]: prefs[key] });
  });
}

function bindTransport() {
  el.playBtn.addEventListener('click', () => {
    if (!engine.sentenceCount) {
      el.text.focus();
      return;
    }
    if (engine.state === 'idle') showTab('read');
    engine.toggle();
  });

  el.stopBtn.addEventListener('click', () => engine.stop());
  el.prevBtn.addEventListener('click', () => engine.step(-1));
  el.nextBtn.addEventListener('click', () => engine.step(1));

  el.seek.addEventListener('input', () => { seeking = true; });
  el.seek.addEventListener('change', () => {
    seeking = false;
    if (engine.state === 'idle') showTab('read');
    engine.seekToRatio(Number(el.seek.value) / 1000);
  });
}

function bindKeyboard() {
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing = target instanceof HTMLElement &&
      (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' ||
       target.tagName === 'SELECT' || target.isContentEditable);
    const onControl = target instanceof HTMLElement &&
      (target.tagName === 'BUTTON' || target.tagName === 'A');

    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      if (engine.sentenceCount) { showTab('read'); engine.play(0); }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === 'Escape') {
      if (engine.isBusy) engine.stop();
      return;
    }
    if (typing || onControl) return;

    if (event.key === ' ') {
      event.preventDefault();
      if (engine.sentenceCount) {
        if (engine.state === 'idle') showTab('read');
        engine.toggle();
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      engine.step(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      engine.step(1);
    } else if (event.key === '?') {
      el.shortcutsBtn.click();
    }
  });
}

function bindFiles() {
  el.importBtn.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', () => {
    const file = el.fileInput.files?.[0];
    if (file) readFile(file);
    el.fileInput.value = '';
  });

  const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');

  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    dragDepth++;
    el.dropOverlay.hidden = false;
  });
  window.addEventListener('dragover', (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) el.dropOverlay.hidden = true;
  });
  window.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    el.dropOverlay.hidden = true;
    const file = event.dataTransfer.files?.[0];
    if (file) readFile(file);
  });
}

async function readFile(file) {
  const looksTextual = /\.(txt|md|markdown)$/i.test(file.name) || file.type.startsWith('text/');
  if (!looksTextual) {
    el.docMeta.textContent = t('error.fileType');
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    el.docMeta.textContent = t('error.fileSize');
    return;
  }
  try {
    setText(await file.text());
    showTab('edit');
  } catch (error) {
    el.docMeta.textContent = t('error.fileRead');
  }
}

/* ---------------------------------------------------------------- state -- */

function updatePlayButton() {
  const speaking = engine.state === 'speaking';
  el.playIcon.querySelector('use').setAttribute('href', speaking ? '#i-pause' : '#i-play');
  const key = speaking ? 'transport.pause' : engine.state === 'paused' ? 'transport.resume' : 'transport.play';
  el.playBtn.setAttribute('aria-label', t(key));
}

function updateTransportState() {
  const has = engine.sentenceCount > 0 && supported;
  el.playBtn.disabled = !has;
  el.seek.disabled = !has;
  el.prevBtn.disabled = !has || engine.index === 0;
  el.nextBtn.disabled = !has || engine.index >= engine.sentenceCount - 1;
  el.stopBtn.disabled = !engine.isBusy;
}

function updateStatus() {
  if (!supported) {
    el.status.textContent = t('error.unsupported');
    return;
  }
  const total = engine.sentenceCount;
  if (!total) {
    el.status.textContent = t('status.empty');
    return;
  }
  const position = { i: engine.index + 1, n: total };
  if (engine.state === 'speaking') el.status.textContent = t('status.speaking', position);
  else if (engine.state === 'paused') el.status.textContent = t('status.paused', position);
  else el.status.textContent = t('status.ready', { n: total });
  updateTransportState();
}

function syncSliderOutputs() {
  el.rateOut.textContent = `${Number(el.rate.value).toFixed(2)}x`;
  el.pitchOut.textContent = Number(el.pitch.value).toFixed(2);
  el.volumeOut.textContent = `${Math.round(Number(el.volume.value) * 100)}%`;
}

function applyLanguageUi() {
  applyTranslations();
  document.querySelectorAll('[data-set-lang]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.setLang === getLanguage()));
  });
  reader.setEmptyMessage(t('reader.empty'));
  readerDirty = true;
  if (!el.paneRead.hidden) ensureReader();
  if (currentVoice) el.voiceNote.textContent = currentVoice.localService ? t('voice.local') : t('voice.network');
  resetClearButton();
  updatePlayButton();
  updateStatus();
  updateMeta();
  updateLanguageHint();
}

function applyTheme(theme) {
  const resolved = theme === 'light' || theme === 'dark'
    ? theme
    : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  document.documentElement.dataset.theme = resolved;
  const dark = resolved === 'dark';
  el.themeBtn.setAttribute('aria-pressed', String(dark));
  el.themeBtn.setAttribute('aria-label', t(dark ? 'ui.themeToLight' : 'ui.themeToDark'));
  el.themeBtn.querySelector('use').setAttribute('href', dark ? '#i-sun' : '#i-moon');
}

function watchSystemTheme() {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!prefs.theme) applyTheme(null);
  });
}

/**
 * The transport bar is fixed to the bottom, so the page has to reserve exactly
 * its height. That height changes with the viewport, the text size and the
 * length of the translated status line, so it is measured rather than guessed.
 */
function watchTransportHeight() {
  const apply = () => {
    document.documentElement.style.setProperty('--bar-h', `${el.transport.offsetHeight}px`);
  };
  apply();
  if ('ResizeObserver' in window) new ResizeObserver(apply).observe(el.transport);
  else window.addEventListener('resize', apply);
}

function showBanner(message) {
  el.banner.textContent = message;
  el.banner.hidden = false;
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!/^https?:$/.test(location.protocol)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* Offline support is a bonus, the app works without it. */
    });
  });
}

init();
