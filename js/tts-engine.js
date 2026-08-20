/**
 * A thin, event driven wrapper around window.speechSynthesis.
 *
 * The Web Speech API is implemented differently by every browser, so this class
 * exists to hide the differences the rest of the app should not care about:
 *
 *  - Chromium stops speaking after roughly 15 seconds unless the queue is
 *    nudged, so a watchdog pauses and resumes it on an interval.
 *  - Android treats pause() as cancel(), so resume() checks whether anything is
 *    still speaking and restarts the current sentence if not.
 *  - cancel() fires onend on the utterance it kills, which would otherwise look
 *    like normal completion. Every utterance carries a generation token and
 *    stale callbacks are ignored.
 *  - Utterance settings are immutable once created, so changing voice or rate
 *    mid playback restarts the current sentence with the new settings.
 *
 * Events: statechange, sentence, boundary, progress, end, ttserror.
 */

import { segment, wordAt } from './text-segmenter.js';

/* The ~15 second stall the keep-alive works around is a desktop Chromium bug.
 * On Android and iOS the same pause()/resume() nudge would kill the utterance
 * (pause acts as cancel there), so mobile UAs are excluded on purpose. */
const CHROMIUM = /Chrome|Chromium|Edg/i.test(navigator.userAgent) &&
                 !/Android|Mobile|CriOS|Firefox|FxiOS/i.test(navigator.userAgent);

const KEEPALIVE_MS = 9000;
const START_DELAY_MS = 60;
const RESUME_CHECK_MS = 250;

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export class TtsEngine extends EventTarget {
  constructor() {
    super();
    this.synth = window.speechSynthesis;
    this.chunks = [];
    this.text = '';
    this.index = 0;
    this.state = 'idle'; // idle | speaking | paused
    this.settings = { voice: null, rate: 1, pitch: 1, volume: 1 };

    this._token = 0;
    this._offsets = [0];
    this._totalChars = 0;
    this._keepAlive = null;
    this._spokenInChunk = 0;
    this._settingsDirty = false;
  }

  static get supported() {
    return typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      'SpeechSynthesisUtterance' in window;
  }

  get isBusy() {
    return this.state === 'speaking' || this.state === 'paused';
  }

  get sentenceCount() {
    return this.chunks.length;
  }

  /** Loads text and resets the cursor. Returns the chunk list for the UI. */
  load(text) {
    this.stop();
    this.text = text;
    this.chunks = segment(text);

    this._offsets = [0];
    let running = 0;
    for (const chunk of this.chunks) {
      running += chunk.text.length;
      this._offsets.push(running);
    }
    this._totalChars = running;
    this.index = 0;
    this._emitProgress(0);
    return this.chunks;
  }

  /** Merges settings. Restarts the current sentence when already speaking;
   *  when paused, the new settings are applied on resume. */
  applySettings(partial) {
    Object.assign(this.settings, partial);
    if (this.state === 'speaking') this.play(this.index);
    else if (this.state === 'paused') this._settingsDirty = true;
  }

  play(index = this.index) {
    if (!this.chunks.length) return;

    this.index = clamp(index, 0, this.chunks.length - 1);
    this._spokenInChunk = 0;
    // Starting fresh applies the current settings, so nothing is left pending
    // for a later resume() to replay the sentence over.
    this._settingsDirty = false;
    this._token++;
    this.synth.cancel();
    this._setState('speaking');
    this._startKeepAlive();

    // Chromium can drop an utterance queued in the same tick as cancel().
    const token = this._token;
    setTimeout(() => {
      if (token !== this._token || this.state !== 'speaking') return;
      if (this.synth.paused) this.synth.resume();
      this._speakCurrent();
    }, START_DELAY_MS);
  }

  pause() {
    if (this.state !== 'speaking') return;
    this._setState('paused');
    this._stopKeepAlive();
    // Pausing while nothing is audibly speaking yet (e.g. inside the short
    // start delay after play()) wedges Chromium's queue in a state only
    // cancel() clears. The paused *engine* state alone is enough there:
    // resume() restarts the current sentence when nothing is speaking.
    if (this.synth.speaking) this.synth.pause();
  }

  resume() {
    if (this.state !== 'paused') return;

    // Settings changed during the pause: utterances are immutable, so the only
    // way to honor them is to restart the current sentence.
    if (this._settingsDirty) {
      this._settingsDirty = false;
      this.play(this.index);
      return;
    }

    this._setState('speaking');
    this._startKeepAlive();
    this.synth.resume();

    const token = this._token;
    setTimeout(() => {
      if (token !== this._token || this.state !== 'speaking') return;
      // Platforms where pause() really meant cancel(): start the sentence over.
      if (!this.synth.speaking) this._speakCurrent();
    }, RESUME_CHECK_MS);
  }

  toggle() {
    if (this.state === 'speaking') this.pause();
    else if (this.state === 'paused') this.resume();
    else this.play(this.index);
  }

  stop() {
    this._token++;
    this._stopKeepAlive();
    this._settingsDirty = false;
    this.synth.cancel();
    this.index = 0;
    this._spokenInChunk = 0;
    this._setState('idle');
    this._emit('sentence', { index: -1 });
    this._emitProgress(0);
  }

  /** Moves by whole sentences, whether playing or not. */
  step(delta) {
    if (!this.chunks.length) return;
    const target = clamp(this.index + delta, 0, this.chunks.length - 1);
    // Already at the boundary: stepping is a no-op, not a restart.
    if (target === this.index && this.state !== 'idle') return;
    if (this.state === 'idle') {
      this.index = target;
      this._spokenInChunk = 0;
      this._emit('sentence', { index: target });
      this._emitProgress(0);
    } else {
      this.play(target);
    }
  }

  /** Seeks by fraction of the whole text, snapping to a sentence start. */
  seekToRatio(ratio) {
    if (!this.chunks.length) return;
    const target = clamp(ratio, 0, 1) * this._totalChars;
    let index = 0;
    while (index < this.chunks.length - 1 && this._offsets[index + 1] <= target) index++;

    if (this.state === 'idle') {
      this.index = index;
      this._spokenInChunk = 0;
      this._emit('sentence', { index });
      this._emitProgress(0);
    } else {
      this.play(index);
    }
  }

  /* ------------------------------------------------------------ internals -- */

  _speakCurrent() {
    const chunk = this.chunks[this.index];
    if (!chunk) {
      this._finish();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(chunk.text);
    const { voice, rate, pitch, volume } = this.settings;
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.rate = clamp(rate, 0.1, 10);
    utterance.pitch = clamp(pitch, 0, 2);
    utterance.volume = clamp(volume, 0, 1);

    const token = ++this._token;
    const chunkIndex = this.index;

    utterance.onstart = () => {
      if (token !== this._token) return;
      this._emit('sentence', { index: chunkIndex });
      // Sentence-granularity progress, so the seek bar moves even on engines
      // that never fire word boundary events.
      this._emitProgress(0);
      // A pause requested before the audio began (pause() skips synth.pause()
      // when nothing speaks yet) is honored the moment it actually starts.
      if (this.state === 'paused' && this.synth.speaking) this.synth.pause();
    };

    utterance.onboundary = (event) => {
      if (token !== this._token) return;
      if (event.name && event.name !== 'word') return;

      const charIndex = event.charIndex ?? 0;
      let length = event.charLength ?? 0;
      if (!length) {
        const found = wordAt(chunk.text, charIndex);
        if (!found) return;
        length = found.length;
      }
      this._spokenInChunk = charIndex;
      this._emit('boundary', { index: chunkIndex, charIndex, charLength: length });
      this._emitProgress(charIndex);
    };

    utterance.onend = () => {
      if (token !== this._token) return;
      // On platforms where pause() kills the utterance (Android), its onend
      // arrives while we are paused. Advancing here would skip speech, or turn
      // a pause on the last sentence into a bogus "done". resume() replays the
      // current sentence instead.
      if (this.state === 'paused') return;
      this._spokenInChunk = 0;
      if (this.index + 1 >= this.chunks.length) {
        this._finish();
      } else {
        this.index++;
        this._speakCurrent();
      }
    };

    utterance.onerror = (event) => {
      if (token !== this._token) return;
      // Firing after our own cancel() is expected, not a failure.
      if (event.error === 'interrupted' || event.error === 'canceled') return;
      // ttserror last, so status handlers reacting to the finish events do not
      // overwrite the error message with a success message.
      this._finish();
      this._emit('ttserror', { error: event.error || 'unknown' });
    };

    // Chromium refuses to start a new utterance while its queue is paused.
    if (this.synth.paused) this.synth.resume();
    this.synth.speak(utterance);
  }

  _finish() {
    this._token++;
    this._stopKeepAlive();
    this._setState('idle');
    this._emitProgress(0, 1);
    this.index = 0;
    this._spokenInChunk = 0;
    this._emit('sentence', { index: -1 });
    this._emit('end', {});
  }

  _startKeepAlive() {
    if (!CHROMIUM) return;
    this._stopKeepAlive();
    this._keepAlive = setInterval(() => {
      if (this.state !== 'speaking' || !this.synth.speaking) return;
      this.synth.pause();
      this.synth.resume();
    }, KEEPALIVE_MS);
  }

  _stopKeepAlive() {
    if (this._keepAlive === null) return;
    clearInterval(this._keepAlive);
    this._keepAlive = null;
  }

  _setState(state) {
    if (this.state === state) return;
    this.state = state;
    this._emit('statechange', { state });
  }

  _emitProgress(charIndexInChunk, forced = null) {
    if (!this._totalChars) {
      this._emit('progress', { ratio: 0, spoken: 0, total: 0 });
      return;
    }
    const spoken = forced !== null
      ? this._totalChars
      : this._offsets[this.index] + charIndexInChunk;
    this._emit('progress', {
      ratio: clamp(spoken / this._totalChars, 0, 1),
      spoken,
      total: this._totalChars,
    });
  }

  _emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
}
