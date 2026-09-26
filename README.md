# sfxmint

Put free CC0 sound effects into a web app or game by naming the event, not by hunting through a library.

```bash
npx sfxmint add coin jump hit
```

```
  3 files → public/sounds/ (66 KB)

  coin.mp3               2.0s   Double-Chime 8-Bit Coin Pickup 13
  jump.mp3               1.0s   Smooth 8-Bit Video Game Jump 01
  hit.mp3                1.0s   Cracking Punch Impact 25
```

No API key, no signup, no account. Every file is [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/): commercial use, no attribution, no strings.

## Then play them

```js
import { createSoundboard } from "sfxmint";
import manifest from "./public/sounds/sounds.json";

const sfx = createSoundboard(manifest, { preload: ["coin"] });

button.onclick = () => sfx.play("coin");
```

That's the whole API surface you need. `sfx.setMuted()` toggles and remembers the preference; `sfx.stop()` cuts everything off.

## Why not just `new Audio(url)`

Finding sound files is the easy part. These three are what actually break:

- **Browsers block audio until the first user gesture.** A cue triggered on mount silently rejects, and on iOS an `HTMLAudioElement` stays locked unless that exact element was started inside a gesture — so cloning one for overlapping playback fails on phones. This package runs on Web Audio and resumes a single context on the first gesture, which covers every later cue.
- **Repeated cues cut each other off.** `audio.currentTime = 0` restarts the one element you have, so a fast second click truncates the first. Each `play()` here gets its own source node and they overlap.
- **A mute toggle has to survive a reload.** Persisted to `localStorage`, wrapped so private mode doesn't throw.

Safe to import during SSR — every method is inert until it runs in a browser.

## CLI

```bash
npx sfxmint add coin jump hit         # one file per role
npx sfxmint add --set platformer      # a coherent kit for one product
npx sfxmint search "glass break"      # free text when no role fits
npx sfxmint list roles                # browse (or: list sets)
```

| Option | |
|---|---|
| `--out <dir>` | where files land (default `public/sounds`) |
| `--format <fmt>` | `mp3` (default), `wav`, `ogg` |
| `--style <style>` | `balanced` (default), `crisp`, `soft`, `spacious` — re-ranks a role's family by measured acoustics |
| `--force` | replace an existing file that has different content |
| `--json` | machine-readable output |

Roles are named by what they are for — `click`, `purchase-success`, `error`, `coin`, `jump`, `explosion`, `dialogue-blip`, `notification` — and aliases work, so `button-click` or `tap` finds `click`. Around 200 of them; `sfxmint list roles` prints the current set.

Running `add` again keeps what is already there, so you can collect cues as you build.

## What gets written

```
public/sounds/
  coin.mp3
  sounds.json     ← role → file, plus source URL, checksum, duration, license
  LICENSE.txt
```

Every download is checked against the byte count and SHA-256 the API reports; a mismatch is an error, not a warning. Nothing overwrites an existing file with different content unless you pass `--force`.

## Honest limits

- **The library is AI-generated** or procedurally synthesized, then loudness-normalized and QC'd. Foley purists will hear it. Nothing is scraped or re-hosted from other libraries.
- **No music, no voice, no speech.** Sound effects only.
- **A file check is not a listening check.** The checksum proves you got the bytes the API described. Whether a cue suits your scene is something only a listen in context can tell — the CLI flags cues with no content review.
- **A set can be short a role, and a role can have no file that passes its checks yet.** Either way the CLI downloads the rest and tells you which event has no file yet, rather than failing the whole kit or leaving you to discover it in production.

## Also available

The same library as an [MCP server](https://github.com/flreey/sfxmint-mcp) (`https://sfxmint.com/mcp`) so a coding agent can pick cues directly, or a plain [JSON API](https://sfxmint.com/api/docs) with no key.

## License

This package: MIT. The sound files it downloads: CC0 1.0.
