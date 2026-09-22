/** One entry written by `sfxmint add`, describing a file it verified and saved. */
export interface ManifestEntry {
  /** File name inside the output directory, e.g. `coin.mp3`. */
  file: string;
  /** SFXMint slug the file came from, e.g. `retro-game-coin-13`. */
  slug: string;
  title: string | null;
  label: string | null;
  format: "mp3" | "wav" | "ogg";
  duration_ms: number | null;
  loopable: boolean;
  /** Verified against the downloaded bytes at install time. */
  sha256: string;
  bytes: number;
  source_url: string;
  page_url: string | null;
  license: string;
  /**
   * Content review status, when the API reported one. A file check confirms bytes,
   * not that the cue suits your scene — preview it in context.
   */
  content_check: { status: string; reason?: string | null } | null;
  unverified_requirements: string[];
}

export interface Manifest {
  version: number;
  generated_by: string;
  origin: string;
  /** Web path the files are served from, e.g. `/sounds`. Empty when not under `public/`. */
  base: string;
  license: string;
  license_url: string;
  content_notice: string;
  files: Record<string, ManifestEntry>;
}

export interface SoundboardOptions {
  /** Default playback volume, 0–1. Defaults to 0.5; UI cues sit well at 0.3–0.5. */
  volume?: number;
  /** Overrides `manifest.base` when your files are served from elsewhere. */
  basePath?: string;
  /** Cue names to decode up front, so the first click is instant. */
  preload?: string[];
  /** localStorage key for the mute preference. Defaults to `sfxmint:muted`. */
  muteKey?: string;
  /** Set false to keep mute in memory only. Defaults to true. */
  persistMute?: boolean;
}

export interface PlayOptions {
  /** 0–1, overriding the board's default for this one call. */
  volume?: number;
  /** Playback rate; 1 is normal speed. */
  rate?: number;
}

export interface Soundboard {
  /** Cue names available in the manifest. */
  readonly names: string[];
  readonly muted: boolean;
  /** Call with no argument to toggle. Returns the new state. */
  setMuted(value?: boolean): boolean;
  /** Decode cues ahead of time. Defaults to every cue in the manifest. */
  preload(list?: string[]): Promise<void>;
  /**
   * Play a cue. Returns null when muted, during SSR, for an unknown name, or when the
   * cue still has to be decoded — a missing sound never breaks the interaction it decorates.
   */
  play(name: string, options?: PlayOptions): AudioBufferSourceNode | null;
  /** Stop everything currently sounding. */
  stop(): void;
  /** Release listeners, buffers and the audio context. */
  dispose(): void;
}

/**
 * Create a soundboard from the `sounds.json` that `sfxmint add` wrote.
 * Safe to import and construct during SSR: every method is inert without a browser.
 */
export function createSoundboard(
  manifest: Manifest | undefined,
  options?: SoundboardOptions,
): Soundboard;

export default createSoundboard;
