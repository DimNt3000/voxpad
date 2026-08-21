/**
 * Drives the engine against a fake speechSynthesis so the state machine can be
 * tested without a browser or a voice. The fake reproduces the platform
 * behaviours the engine exists to paper over: notably that on Android pause()
 * cancels the utterance and fires its end handler.
 *
 * Every test here corresponds to a defect found in the end to end audit; they
 * exist so those defects cannot come back unnoticed.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/** Utterance stand-in. The engine only ever sets handlers and reads nothing. */
class FakeUtterance {
  constructor(text) {
    this.text = text;
    this.onstart = this.onend = this.onerror = this.onboundary = null;
  }
}

/**
 * @param {{pauseCancels?: boolean}} options
 *   pauseCancels models Android and some mobile browsers, where pause() stops
 *   the utterance outright and its end handler fires.
 */
function makeSynth({ pauseCancels = false } = {}) {
  const synth = {
    speaking: false,
    paused: false,
    pending: false,
    spoken: [],       // every utterance passed to speak(), in order
    current: null,
    cancelCount: 0,

    speak(utterance) {
      synth.current = utterance;
      synth.spoken.push(utterance);
      synth.speaking = true;
      synth.paused = false;
      utterance.onstart?.();
    },
    cancel() {
      synth.cancelCount++;
      const killed = synth.current;
      synth.current = null;
      synth.speaking = false;
      synth.paused = false;
      // A real cancel() fires the killed utterance's end handler.
      killed?.onend?.();
    },
    pause() {
      if (!synth.speaking) return;
      if (pauseCancels) {
        const killed = synth.current;
        synth.current = null;
        synth.speaking = false;
        synth.paused = false;
        killed?.onend?.();
      } else {
        synth.paused = true;
      }
    },
    resume() {
      if (synth.current) {
        synth.paused = false;
        synth.speaking = true;
      }
    },

    /* --- helpers the tests use to drive the fake --- */

    /** The utterance finishes on its own. */
    finish() {
      const done = synth.current;
      synth.current = null;
      synth.speaking = false;
      done?.onend?.();
    },
    /** The engine reports a word boundary. */
    boundary(charIndex, charLength) {
      synth.current?.onboundary?.({ name: 'word', charIndex, charLength });
    },
    fail(error) {
      const failed = synth.current;
      synth.current = null;
      synth.speaking = false;
      failed?.onerror?.({ error });
    },
  };
  return synth;
}

/** Node exposes navigator as a getter-only global, so it has to be redefined
 *  rather than assigned. */
function defineGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}

/** Loads a fresh copy of the engine with the given globals installed. The
 *  module reads navigator.userAgent at import time, so it must be re-imported
 *  per user agent under test. */
async function loadEngine({ userAgent = 'Node test runner', synth } = {}) {
  defineGlobal('navigator', { userAgent, language: 'en-US', languages: ['en-US'] });
  defineGlobal('window', globalThis);
  defineGlobal('speechSynthesis', synth);
  defineGlobal('SpeechSynthesisUtterance', FakeUtterance);
  const { TtsEngine } = await import(`../js/tts-engine.js?case=${encodeURIComponent(userAgent)}`);
  return TtsEngine;
}

/** The engine defers its first speak() by a timer, so tests await real time. */
const tick = (ms = 120) => new Promise((r) => setTimeout(r, ms));

/** Collects emitted events for assertions. */
function record(engine, ...names) {
  const log = [];
  for (const name of names) {
    engine.addEventListener(name, (event) => log.push({ name, detail: event.detail }));
  }
  return log;
}

const THREE = 'One sentence. Two sentence. Three sentence.';

const STUBBED = ['navigator', 'window', 'speechSynthesis', 'SpeechSynthesisUtterance'];
let originals;

beforeEach(() => {
  originals = STUBBED.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
});
afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

describe('loading and cursor', () => {
  test('splits the text and starts at the first sentence', async () => {
    const synth = makeSynth();
    const TtsEngine = await loadEngine({ synth });
    const engine = new TtsEngine();

    const chunks = engine.load(THREE);
    assert.equal(chunks.length, 3);
    assert.equal(engine.sentenceCount, 3);
    assert.equal(engine.index, 0);
    assert.equal(engine.state, 'idle');
  });

  test('advances sentence by sentence to a natural end', async () => {
    const synth = makeSynth();
    const TtsEngine = await loadEngine({ synth });
    const engine = new TtsEngine();
    const log = record(engine, 'sentence', 'end');

    engine.load(THREE);
    engine.play();
    await tick();

    synth.finish();
    synth.finish();
    synth.finish();

    assert.equal(synth.spoken.length, 3);
    assert.deepEqual(synth.spoken.map((u) => u.text), ['One sentence.', 'Two sentence.', 'Three sentence.']);
    assert.equal(engine.state, 'idle');
    assert.equal(log.filter((e) => e.name === 'end').length, 1);
  });
});

describe('pause on platforms where pause cancels the utterance', () => {
  test('does not skip ahead when the cancelled utterance reports its end', async () => {
    // Regression: the pause-induced onend used to advance the cursor, so
    // resuming continued at the next sentence and half a sentence was lost.
    const synth = makeSynth({ pauseCancels: true });
    const TtsEngine = await loadEngine({ synth });
    const engine = new TtsEngine();

    engine.load(THREE);
    engine.play();
    await tick();
    assert.equal(engine.index, 0);

    engine.pause();
    assert.equal(engine.state, 'paused');
    assert.equal(engine.index, 0, 'pause must not move the cursor');

    engine.resume();
    await tick();
    assert.equal(engine.index, 0);
    assert.equal(synth.spoken.at(-1).text, 'One sentence.', 'resume replays the paused sentence');
  });

  test('pausing on the last sentence does not report the document as finished', async () => {
    // Regression: the same stray onend hit the completion branch and emitted
    // "end", so a deliberate pause looked like a finished read.
    const synth = makeSynth({ pauseCancels: true });
    const TtsEngine = await loadEngine({ synth });
    const engine = new TtsEngine();
    const log = record(engine, 'end');

    engine.load(THREE);
    engine.play(2);
    await tick();
    assert.equal(engine.index, 2);

    engine.pause();

    assert.equal(log.length, 0, 'no end event while merely paused');
    assert.equal(engine.state, 'paused');
  });
});

describe('keep-alive watchdog', () => {
  const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
  const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1';
  const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0';

  /** The watchdog is private, so its presence is observed through the timer it
   *  installs: a nudge only ever happens on user agents that enable it. */
  const runsWatchdog = async (userAgent) => {
    const synth = makeSynth();
    const TtsEngine = await loadEngine({ userAgent, synth });
    const engine = new TtsEngine();
    engine.load(THREE);
    engine.play();
    await tick();
    const installed = engine._keepAlive !== null;
    engine.stop();
    return installed;
  };

  test('runs on desktop Chromium, where the stall it works around happens', async () => {
    assert.equal(await runsWatchdog(DESKTOP), true);
  });

  test('stays off on Android, where the nudge would cancel the utterance', async () => {
    // Regression: the watchdog used to cut every sentence longer than nine
    // seconds on the most common mobile browser.
    assert.equal(await runsWatchdog(ANDROID), false);
  });

  test('stays off on iOS Chrome', async () => {
    assert.equal(await runsWatchdog(IOS_CHROME), false);
  });

  test('stays off on Firefox', async () => {
    assert.equal(await runsWatchdog(FIREFOX), false);
  });
});

describe('progress reporting', () => {
  test('moves on sentence starts even when no word boundaries arrive', async () => {
    // Regression: progress came only from boundary events, so the seek bar sat
    // at zero for the whole read on engines that do not emit them.
    const synth = makeSynth();
    const TtsEngine = await loadEngine({ synth });
    const engine = new TtsEngine();
    const log = record(engine, 'progress');

    engine.load(THREE);
    engine.play();
    await tick();
    const atFirst = log.at(-1).detail.ratio;

    synth.finish();
    const atSecond = log.at(-1).detail.ratio;

    assert.ok(atSecond > atFirst, `expected progress to advance, got ${atFirst} then ${atSecond}`);
  });

  test('reports word boundaries within the current sentence', async () => {
    const synth = makeSynth();
    const TtsEngine = await loadEngine({ synth });
    const engine = new TtsEngine();
    const log = record(engine, 'boundary');

    engine.load(THREE);
    engine.play();
    await tick();
    synth.boundary(4, 8);

    assert.deepEqual(log.at(-1).detail, { index: 0, charIndex: 4, charLength: 8 });
  });

  test('finishes at exactly 1', async () => {
    const synth = makeSynth();
    const TtsEngine = await loadEngine({ synth });
    const engine = new TtsEngine();
    const log = record(engine, 'progress');

    engine.load(THREE);
    engine.play();
    await tick();
    synth.finish();
    synth.finish();
    synth.finish();

    // The bar is left full rather than snapped back, so the reader can see the
    // read completed; the next play() resets it.
    assert.equal(log.at(-1).detail.ratio, 1);
  });
});

describe('errors', () => {
  test('reports the error after the finish events, so the message survives', async () => {
    // Regression: "end" was emitted last, and the status line overwrote the
    // error with a success message in the same tick.
    const synth = makeSynth();
    const TtsEngine = await loadEngine({ synth });
    const engine = new TtsEngine();
    const log = record(engine, 'end', 'ttserror');

    engine.load(THREE);
    engine.play();
    await tick();
    synth.fail('synthesis-failed');

    assert.equal(log.at(-1).name, 'ttserror', `event order was ${log.map((e) => e.name).join(', ')}`);
    assert.equal(log.at(-1).detail.error, 'synthesis-failed');
  });

  test('ignores the error our own cancel produces', async () => {
    const synth = makeSynth();
    const TtsEngine = await loadEngine({ synth });
    const engine = new TtsEngine();
    const log = record(engine, 'ttserror');

    engine.load(THREE);
    engine.play();
    await tick();
    synth.current.onerror?.({ error: 'interrupted' });

    assert.equal(log.length, 0);
  });
});

describe('stepping and seeking', () => {
  test('next and previous move one sentence', async () => {
    const synth = makeSynth();
    const TtsEngine = await loadEngine({ synth });
    const engine = new TtsEngine();

    engine.load(THREE);
    engine.play();
    await tick();

    engine.step(1);
    await tick();
    assert.equal(engine.index, 1);

    engine.step(-1);
    await tick();
    assert.equal(engine.index, 0);
  });

  test('stepping past either end is a no-op, not a restart', async () => {
    // Regression: stepping at the boundary used to replay the current sentence
    // from the beginning, and it also broke out of a pause.
    const synth = makeSynth();
    const TtsEngine = await loadEngine({ synth });
    const engine = new TtsEngine();

    engine.load(THREE);
    engine.play();
    await tick();
    const spokenBefore = synth.spoken.length;

    engine.step(-1);
    await tick();

    assert.equal(engine.index, 0);
    assert.equal(synth.spoken.length, spokenBefore, 'no new utterance should have been spoken');
  });

  test('seeking snaps to the sentence containing the position', async () => {
    const synth = makeSynth();
    const TtsEngine = await loadEngine({ synth });
    const engine = new TtsEngine();

    engine.load(THREE);
    engine.seekToRatio(1);
    assert.equal(engine.index, 2);

    engine.seekToRatio(0);
    assert.equal(engine.index, 0);
  });
});

describe('settings', () => {
  test('changing the rate while speaking restarts the sentence with it', async () => {
    const synth = makeSynth();
    const TtsEngine = await loadEngine({ synth });
    const engine = new TtsEngine();

    engine.load(THREE);
    engine.play();
    await tick();

    engine.applySettings({ rate: 1.5 });
    await tick();

    assert.equal(synth.spoken.at(-1).rate, 1.5);
    assert.equal(synth.spoken.at(-1).text, 'One sentence.');
  });

  test('changing settings while paused applies them on resume', async () => {
    // Regression: settings changed during a pause were silently dropped.
    const synth = makeSynth();
    const TtsEngine = await loadEngine({ synth });
    const engine = new TtsEngine();

    engine.load(THREE);
    engine.play();
    await tick();
    engine.pause();

    engine.applySettings({ rate: 0.75 });
    engine.resume();
    await tick();

    assert.equal(synth.spoken.at(-1).rate, 0.75);
  });

  test('stop clears a pending settings change', async () => {
    const synth = makeSynth();
    const TtsEngine = await loadEngine({ synth });
    const engine = new TtsEngine();

    engine.load(THREE);
    engine.play();
    await tick();
    engine.pause();
    engine.applySettings({ rate: 0.5 });
    engine.stop();

    engine.play();
    await tick();
    const spokenAfterReplay = synth.spoken.length;
    engine.pause();
    engine.resume();
    await tick();

    assert.equal(synth.spoken.length, spokenAfterReplay,
      'resume should not have replayed the sentence for a stale settings change');
  });
});

describe('stop', () => {
  test('resets the cursor and reports no active sentence', async () => {
    const synth = makeSynth();
    const TtsEngine = await loadEngine({ synth });
    const engine = new TtsEngine();
    const log = record(engine, 'sentence');

    engine.load(THREE);
    engine.play(1);
    await tick();
    engine.stop();

    assert.equal(engine.state, 'idle');
    assert.equal(engine.index, 0);
    assert.equal(log.at(-1).detail.index, -1);
  });

  test('the cancelled utterance cannot advance playback afterwards', async () => {
    const synth = makeSynth();
    const TtsEngine = await loadEngine({ synth });
    const engine = new TtsEngine();

    engine.load(THREE);
    engine.play();
    await tick();
    const spokenBefore = synth.spoken.length;

    engine.stop();
    await tick();

    assert.equal(synth.spoken.length, spokenBefore, 'stop must not trigger the next sentence');
    assert.equal(engine.state, 'idle');
  });
});
