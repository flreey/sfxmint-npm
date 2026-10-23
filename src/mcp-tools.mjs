// The library tools of https://sfxmint.com/mcp (worker/routes/mcp.ts, TOOLS), the ones `sfxmint mcp`
// always lists: same names and input schemas, which scripts/test-pkg-mcp.mjs holds to the Worker. Each
// description says only what its tool does and names no other tool, as directories require (98eb9324);
// the remote server's own descriptions point from one tool to another, so they are not used here.

export const LIBRARY_TOOLS = [
  {
    "name": "search_sounds",
    "description": "Free-text search over the SFXMint library of free CC0 sound effects, by a description of the sound such as 'door slam', 'soft UI confirmation chime' or 'coin pickup'. Hard constraints (duration, loop, format, excluded words) apply to every result. results hold sounds whose text has every word of the query; when there are none, closest lists the nearest sounds that meet every hard constraint, best first, each with missing_terms. library_fit says how well the library covers the request (full, close, weak, none); anything short of full also returns generation options. Returns direct, hotlinkable MP3/WAV URLs and verified OGG (Vorbis) URLs where available — no API key, no attribution required — plus measured acoustics (attack_ms, tail_ms, centroid_hz), character labels like 'bright · punchy · tight', loop/file-QC status, and score/match as ranking evidence only (role = known role default, exact = all words hit, partial = some words hit, semantic = nearest by meaning).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Keywords or a natural-language description, e.g. 'door slam', 'soft UI confirmation chime', 'coin pickup'"
        },
        "category": {
          "type": "string",
          "description": "Optional category slug: ui, retro-game, transition, impact, ambience, water, fire-electric, footsteps, door, mechanical, paper-fabric, glass, animal, crowd, cartoon, magic-scifi, horror, feedback, instrument, office, human, vehicle, household"
        },
        "limit": {
          "type": "number",
          "description": "Max results (default 20, max 50)"
        },
        "max_duration_ms": {
          "type": "number",
          "description": "Hard maximum delivered duration in milliseconds; format-specific measurement is required."
        },
        "loop": {
          "type": "boolean",
          "description": "Require (true) or exclude (false) a candidate marked with prepared loop metadata; seam evidence is returned separately."
        },
        "format": {
          "type": "string",
          "enum": [
            "wav",
            "mp3",
            "ogg"
          ],
          "description": "Delivery format (ogg = Ogg Vorbis, only sounds published before 2026-10-14 have it); loop=true defaults to WAV when omitted."
        }
      },
      "required": [
        "query"
      ]
    }
  },
  {
    "name": "get_role_sound",
    "description": "Returns a sound for a named event or interaction in an app or game — a button click, purchase success, error beep, level-up, dialogue blip, notification. The role is plain words: role ids (click, success, purchase-success, dialogue-blip, notification…) and common aliases (button click, ka-ching, jump scare, text blip…) are accepted. Returns a qualified candidate for that role when one satisfies the requested constraints, with MP3/WAV URLs, 2-3 alternates and the family page for browsing more. Five core game roles include content_check (verified/unverified/rejected), scoped to scene, role, format and exact file SHA256; unverified previews are not certified suitable. Optional style: crisp (short, bright, dry), soft (darker, gentler), spacious (reverb, longer tail), balanced (default: most typical). Unknown roles return not_found with the full role list; GET https://sfxmint.com/api/v1/roles lists roles with aliases.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "role": {
          "type": "string",
          "description": "Role id or alias, e.g. 'click', 'button click', 'purchase-success', 'ka-ching', 'error beep', 'level-up', 'dialogue blip', 'notification'"
        },
        "style": {
          "type": "string",
          "enum": [
            "balanced",
            "crisp",
            "soft",
            "spacious"
          ],
          "description": "Optional. balanced (default) = the family's most typical take; crisp = short, bright, dry; soft = darker, gentler; spacious = reverb, longer tail"
        },
        "max_duration_ms": {
          "type": "number",
          "description": "Hard maximum delivered duration in milliseconds."
        },
        "loop": {
          "type": "boolean",
          "description": "Require prepared loop metadata; seam evidence is returned separately."
        },
        "format": {
          "type": "string",
          "enum": [
            "wav",
            "mp3",
            "ogg"
          ]
        }
      },
      "required": [
        "role"
      ]
    }
  },
  {
    "name": "get_sound",
    "description": "Returns full metadata for one sound by slug, including download URLs, per-format SHA-256 and byte counts, description and measured acoustics (attack/tail/brightness + character labels).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "slug": {
          "type": "string",
          "description": "Sound slug, e.g. 'impact-punch-01'"
        }
      },
      "required": [
        "slug"
      ]
    }
  },
  {
    "name": "get_sound_set",
    "description": "Returns a coherent set of sounds for an app or game in one call — one sound per role, with format metadata, hashes and stable download URLs. Each file's content_check (verified/unverified/rejected) is bound to the exact role, format and file SHA256; unverified files are not certified suitable. Sets include UI styles, game and app scenarios, acoustic-drum-kit, animal-calls (15 isolated calls), and dungeon-traps (6 isolated mechanisms).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "format": {
          "type": "string",
          "enum": [
            "wav",
            "mp3",
            "ogg"
          ],
          "description": "File format for selection and checks (default WAV; OGG only among sounds published before 2026-10-14). Legacy urls remains MP3; download_urls follows this format."
        },
        "set": {
          "type": "string",
          "enum": [
            "ui-crisp",
            "ui-soft",
            "ui-spacious",
            "retro-game",
            "chat-app",
            "saas-app",
            "checkout",
            "learning",
            "puzzle-game",
            "platformer",
            "horror-game",
            "video-editing",
            "smart-device",
            "wellness",
            "ai-coding-tool",
            "acoustic-drum-kit",
            "animal-calls",
            "dungeon-traps"
          ],
          "description": "Set id (default ui-crisp). Includes acoustic-drum-kit, animal-calls and dungeon-traps alongside the UI and scenario sets listed in the enum."
        }
      }
    }
  }
];

export const LIBRARY_TOOL_NAMES = new Set(LIBRARY_TOOLS.map((tool) => tool.name));

// The tools https://sfxmint.com/mcp adds for an API key (generation, kits), listed in these words in place of the
// server's: the same rule, and no prices, which change with the site. Their input schemas come from the server's
// live list. A tool without an entry here is not listed; scripts/test-pkg-mcp.mjs fails until it has one.
export const ACCOUNT_DESCRIPTIONS = {
  generate_sound:
    "Makes a new CC0 sound effect from a description, for the API key's account: up to four AI-generated WAV takes (signed links valid 15 minutes) with SHA-256 and seed, and an OGG link (ogg_url) for each take made with a pass or plan. Each generation uses one of the account's free tries, then one from a pass or plan on the account, and one that makes no take is not counted; with neither it answers payment_required with buy_url and website_url, the website's page where the same sound can be made and heard first. Given variations_of, it makes a variation set: four takes close to one finished take, for a game to play at random, with a Godot .tres and a Unity script to save beside the WAVs. When the takes are not ready within about 25 seconds, it returns the order id with status generating.",
  get_generation:
    "Returns the status of one of this account's generations by its order id, with fresh download links for its finished takes.",
  change_sound:
    "Changes one finished take of a generation this account made, as it is, from what is off in words (any language) or a named action. Returns three versions as CC0 WAV files: a light, medium and strong change, or for a loop three seams. Free: no generation is used and no plan is needed. When the words ask for a different sound rather than a change to this one, it answers no_action with a description for a new generation.",
  start_game_kit:
    "Starts a Game kit from a description of a game or of one scene: SFXMint plans the sounds it needs, to be made as CC0 takes, in the same project the user sees on the website. Planning and listing are free; each sound made uses one of the account's free tries, then one generation from a pass or plan on the account, and with neither nothing is made. Returns kit_id and kit_url; planning takes about 15 seconds.",
  add_kit_sounds:
    "Adds a list of sounds to a kit — an app's or a game's events, with names and optional moments and lengths — or a ready set's events with its library sounds already in use. Names, keys, order and lengths stay as given; SFXMint writes how each sounds. Without kit_id it starts a new kit for the list. Free: no generation is used.",
  fill_kit_from_library:
    "Fills a kit's sounds from the free CC0 library: each sound without a take is searched by its name and length, and a full match becomes its take in use, free. Returns what matched, the nearest library sounds for the others, and the sounds left to make.",
  find_kit_sound_candidates:
    "Returns up to five free library sounds for one kit sound, found by its name or by other words, each with its length, character and a listening URL. Changes nothing in the kit.",
  use_library_sound:
    "Adds a library sound (by slug) as a take of a kit sound, free. It becomes the take in use when the sound has none; otherwise it waits beside the other takes to be compared.",
  get_game_kit:
    "Returns a Game kit's state: its scenes; its sounds with event key, when each plays, status, the takes made (short-lived file links, SHA-256, length) and the take in use; how its sounds are paid for (the account's generations of the day, or the plan it needs); and next_step. Works with the API key that started the kit.",
  list_kit_sounds:
    "Lists the sounds of a planned Game kit's scenes, free: the scenes given are kept (all by default) and the others are switched off. Listing takes about 15 seconds, after which the kit's state shows the sounds.",
  make_kit_sounds:
    "Makes sounds in a Game kit: each sound gets up to four CC0 takes and counts as one generation, from the account's free tries and then its pass or plan, shared with its other generations; nothing is charged. With neither it answers payment_required with buy_url, and once the day's generations are used, plans_url, the page where plans are chosen.",
  pick_kit_take:
    "Sets which of a sound's takes the kit uses; the first take is used until one is picked.",
  change_kit_take:
    "Changes a kit sound's take as it is, free, from what is off in words (any language) or a named action. Three versions come back as new takes of the sound, with file links: a light, medium and strong change, or for a steady loop three seamless loops of 12-14 s. The take in use stays as it was. No generation is used and no plan is needed. When the words ask for a different sound rather than a change to this one, it answers no_action with a description, which can be made at kit_url.",
  export_game_kit:
    "Returns what goes into the project: every included sound's event key and take in use (file link valid 15 minutes, SHA-256), the sounds not ready yet, and zip_url for one ZIP, downloaded with the same Authorization header, holding the files in the chosen format, sounds.json (event key → file) and a README.",
};
