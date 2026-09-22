// Tiny browser runtime for the files `sfxmint add` puts in your project.
//
// It exists because the hard part of shipping UI sound is not finding files. It is that
// browsers block audio until the first user gesture, that replaying a cue mid-playback cuts
// it off, and that a mute toggle has to survive a reload.
//
// Built on Web Audio rather than `new Audio()` on purpose: iOS only lets an HTMLAudioElement
// play programmatically after that exact element was started inside a gesture, so cloning one
// for overlapping playback silently fails on phones. One AudioContext resumed once on the
// first gesture covers every later cue, and each playback gets its own source node, so rapid
// repeats overlap instead of cutting each other off.
//
// Safe to import during SSR: every method is a no-op until it runs in a browser.

const DEFAULT_VOLUME = 0.5; // UI cues sit at 0.3–0.5; never default to full volume.
const DEFAULT_MUTE_KEY = "sfxmint:muted";
const GESTURES = ["pointerdown", "keydown", "touchstart"];

const isBrowser = () =>
  typeof window !== "undefined" &&
  typeof (window.AudioContext ?? window.webkitAudioContext) !== "undefined";

function readMuted(key) {
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false; // private mode / blocked storage — not an error worth surfacing
  }
}

function writeMuted(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* preference simply does not persist */
  }
}

function resolveSrc(manifest, name, basePath) {
  const entry = manifest?.files?.[name];
  if (!entry) return null;
  const base = basePath ?? manifest.base ?? "";
  return base ? `${base.replace(/\/$/, "")}/${entry.file}` : entry.file;
}

/**
 * @param {object} manifest  the sounds.json written by `sfxmint add`
 * @param {object} [options] volume, basePath, preload, muteKey, persistMute
 */
export function createSoundboard(manifest, options = {}) {
  const {
    volume: defaultVolume = DEFAULT_VOLUME,
    basePath,
    preload: warmUp = [],
    muteKey = DEFAULT_MUTE_KEY,
    persistMute = true,
  } = options;

  const names = Object.keys(manifest?.files ?? {});
  const buffers = new Map(); // name → AudioBuffer
  const loading = new Map(); // name → Promise<AudioBuffer | null>
  const active = new Set(); // live source nodes, so stop() can reach them

  let ctx = null;
  let master = null;
  let muted = false;
  let disposed = false;

  function context() {
    if (ctx || disposed || !isBrowser()) return ctx;
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    return ctx;
  }

  /** One resume inside a real gesture unlocks every later cue. */
  function unlock() {
    if (disposed) return;
    const audio = context();
    if (audio?.state === "suspended") audio.resume().catch(() => {});
    for (const gesture of GESTURES) {
      window.removeEventListener(gesture, unlock, true);
    }
  }

  function load(name) {
    if (buffers.has(name)) return Promise.resolve(buffers.get(name));
    if (loading.has(name)) return loading.get(name);

    const src = resolveSrc(manifest, name, basePath);
    const audio = context();
    if (!src || !audio) return Promise.resolve(null);

    const task = fetch(src)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((bytes) => audio.decodeAudioData(bytes))
      .then((buffer) => {
        buffers.set(name, buffer);
        return buffer;
      })
      .catch(() => null) // a missing cue must not break the interaction it decorates
      .finally(() => loading.delete(name));

    loading.set(name, task);
    return task;
  }

  function start(buffer, volume, rate) {
    const audio = context();
    if (!audio || !buffer) return null;
    const source = audio.createBufferSource();
    const gain = audio.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = Math.min(Math.max(volume, 0), 1);
    source.connect(gain).connect(master);
    source.onended = () => {
      active.delete(source);
      try {
        gain.disconnect();
      } catch {
        /* already torn down */
      }
    };
    active.add(source);
    source.start(0);
    return source;
  }

  /** Named so destructured methods (`const { setMuted } = sfx`) keep working. */
  function stopAll() {
    for (const source of [...active]) {
      try {
        source.stop();
      } catch {
        /* already ended */
      }
      active.delete(source);
    }
  }

  if (isBrowser()) {
    muted = persistMute ? readMuted(muteKey) : false;
    for (const gesture of GESTURES) {
      window.addEventListener(gesture, unlock, { capture: true });
    }
    // Decoding needs a context, which browsers allow to exist before a gesture — it simply
    // starts suspended. Warming the common cues here keeps the first click instant.
    for (const name of warmUp) load(name);
  }

  return {
    /** Names available in the manifest. */
    get names() {
      return [...names];
    },

    get muted() {
      return muted;
    },

    /** Toggle (no argument) or set mute. Persisted unless `persistMute: false`. */
    setMuted(value) {
      muted = value === undefined ? !muted : Boolean(value);
      if (persistMute && isBrowser()) writeMuted(muteKey, muted);
      if (muted) stopAll();
      return muted;
    },

    /** Warm cues ahead of time. Resolves once they are decoded (or known to be missing). */
    async preload(list = names) {
      if (!isBrowser()) return;
      await Promise.all(list.map((name) => load(name)));
    },

    /**
     * Play one cue. Silently does nothing when muted, during SSR, or for an unknown name.
     * The first call for a cue decodes it and then plays; later calls are instant and
     * overlap rather than cutting each other off.
     */
    play(name, { volume = defaultVolume, rate = 1 } = {}) {
      if (muted || disposed || !isBrowser()) return null;
      const ready = buffers.get(name);
      if (ready) return start(ready, volume, rate);
      load(name).then((buffer) => {
        if (buffer && !muted && !disposed) start(buffer, volume, rate);
      });
      return null;
    },

    /** Stop everything currently sounding. */
    stop: stopAll,

    /** Release listeners, buffers and the audio context. */
    dispose() {
      disposed = true;
      if (isBrowser()) {
        for (const gesture of GESTURES) {
          window.removeEventListener(gesture, unlock, true);
        }
      }
      stopAll();
      buffers.clear();
      loading.clear();
      ctx?.close().catch(() => {});
      ctx = null;
      master = null;
    },
  };
}

export default createSoundboard;
