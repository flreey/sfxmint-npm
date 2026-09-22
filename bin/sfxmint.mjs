#!/usr/bin/env node
// SFXMint CLI — put free CC0 sound effects into a project by role name.
// Node 20+, no dependencies, no API key. https://sfxmint.com

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import {
  DEFAULT_ORIGIN,
  FORMATS,
  STYLES,
  createFetcher,
  parseOrigin,
  resolveRoles,
  resolveSearch,
  resolveSet,
} from "../src/api.mjs";
import { downloadAll, MANIFEST_FILE } from "../src/download.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(
  await readFile(join(here, "..", "package.json"), "utf8"),
);

const FLAGS_WITH_VALUE = new Set([
  "out",
  "format",
  "style",
  "set",
  "origin",
  "limit",
  "pick",
  "category",
  "max-duration-ms",
  "loop",
]);

function parseArgs(argv) {
  const flags = new Map();
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s);
    if (inline !== undefined) {
      flags.set(name, inline);
    } else if (FLAGS_WITH_VALUE.has(name)) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`--${name} needs a value`);
      flags.set(name, value);
    } else {
      flags.set(name, true);
    }
  }
  return { flags, positional };
}

const HELP = `sfxmint ${version} — free CC0 sound effects for apps and games

  npx sfxmint add coin jump hit          one file per role, into public/sounds
  npx sfxmint add --set platformer       a coherent kit for one product
  npx sfxmint search "glass break"       free text when no role fits
  npx sfxmint list roles                 browse roles (or: list sets)

Options
  --out <dir>          where files land            (default: public/sounds)
  --format <fmt>       ${FORMATS.join(" | ")}                 (default: mp3)
  --style <style>      ${STYLES.join(" | ")}
                       re-ranks a role's family by measured acoustics
  --force              replace an existing file with different content
  --json               machine-readable output
  --origin <url>       API origin                 (default: ${DEFAULT_ORIGIN})

Search only
  --limit <n>          candidates to request      (default: 3)
  --pick <n>           which candidate to take    (default: 1)
  --max-duration-ms <n>  hard limit, applied before ranking
  --loop <true|false>  require loop-prepared audio
  --category <name>    narrow to a known family

Everything is CC0 1.0: commercial use, no attribution, no signup, no key.
File checks confirm bytes, not suitability — preview each cue in context.
Docs: https://sfxmint.com/api/docs
`;

function formatSize(bytes) {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function listing(origin, fetcher, what) {
  const path = what === "sets" ? "/api/v1/sets" : "/api/v1/roles";
  const url = new URL(path, origin);
  url.searchParams.set("via", fetcher.via);
  const rows = await fetcher.json(url);
  return rows.map((row) =>
    what === "sets"
      ? { id: row.id, name: row.name, use_for: row.use_for, roles: row.roles }
      : { role: row.role, label: row.label, audiences: row.audiences },
  );
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));

  if (flags.has("help") || flags.has("h") || positional[0] === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (flags.has("version") || flags.has("v")) {
    process.stdout.write(`${version}\n`);
    return;
  }

  const command = positional[0];
  if (!command) {
    process.stdout.write(HELP);
    return;
  }

  const origin = parseOrigin(flags.get("origin"));
  // SFXMINT_INTERNAL=1 keeps maintainer self-tests out of the cli channel.
  const fetcher = createFetcher({ internal: process.env.SFXMINT_INTERNAL === "1" });
  const asJson = flags.has("json");

  if (command === "list") {
    const what = positional[1] === "sets" ? "sets" : "roles";
    const rows = await listing(origin, fetcher, what);
    if (asJson) {
      process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
      return;
    }
    for (const row of rows) {
      process.stdout.write(
        what === "sets"
          ? `${row.id.padEnd(16)} ${row.name} — ${row.roles.length} roles\n`
          : `${row.role.padEnd(24)} ${row.label ?? ""}\n`,
      );
    }
    process.stdout.write(`\n${rows.length} ${what}.\n`);
    return;
  }

  if (command !== "add" && command !== "search") {
    throw new Error(`Unknown command "${command}". Run sfxmint --help`);
  }

  const format = flags.get("format") ?? "mp3";
  if (!FORMATS.includes(format)) {
    throw new Error(`--format must be one of: ${FORMATS.join(", ")}`);
  }
  const out = flags.get("out") ?? "public/sounds";

  let resolved;
  if (command === "search") {
    const query = positional.slice(1).join(" ").trim();
    if (!query) throw new Error('Nothing to search for. Try: sfxmint search "glass break"');
    const limit = Number(flags.get("limit") ?? 3);
    resolved = await resolveSearch(origin, fetcher, query, {
      format,
      limit,
      pick: Number(flags.get("pick") ?? 1),
      category: flags.get("category"),
      maxDurationMs: flags.get("max-duration-ms"),
      loop: flags.has("loop") ? flags.get("loop") !== "false" : undefined,
    });
  } else if (flags.has("set")) {
    resolved = await resolveSet(origin, fetcher, flags.get("set"), { format });
  } else {
    const roles = positional.slice(1);
    if (!roles.length) {
      throw new Error(
        "Name at least one role, e.g. sfxmint add coin jump — or use --set <id>.\n" +
          "Browse roles with: sfxmint list roles",
      );
    }
    resolved = await resolveRoles(origin, fetcher, roles, { style: flags.get("style") });
  }

  const { manifest, written, outDir } = await downloadAll(
    origin,
    fetcher,
    resolved.selections,
    { format, out, force: flags.has("force"), version },
  );

  const entries = written.map((file) => manifest.files[file.split(".")[0]]);
  const totalBytes = entries.reduce((sum, e) => sum + e.bytes, 0);
  const unverified = entries.filter(
    (e) => e.content_check && e.content_check.status !== "verified",
  );

  const missing = resolved.missingRoles ?? [];

  if (asJson) {
    process.stdout.write(
      JSON.stringify(
        {
          out: outDir,
          format,
          files: entries,
          missing_roles: missing,
          requests: fetcher.state.requests,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  const where = relative(process.cwd(), outDir) || ".";
  process.stdout.write(
    `\n  ${written.length} file${written.length === 1 ? "" : "s"} → ${where}/ (${formatSize(totalBytes)})\n\n`,
  );
  for (const entry of entries) {
    const seconds = entry.duration_ms ? `${(entry.duration_ms / 1000).toFixed(1)}s` : "";
    process.stdout.write(
      `  ${entry.file.padEnd(22)} ${String(seconds).padEnd(6)} ${entry.title ?? entry.slug}\n`,
    );
  }
  process.stdout.write(
    `\n  Manifest: ${where}/${MANIFEST_FILE}   License: CC0 1.0 (no attribution)\n`,
  );
  if (missing.length) {
    process.stdout.write(
      `  Not in this set: ${missing.join(", ")} — those events have no file yet.\n`,
    );
  }
  if (unverified.length) {
    process.stdout.write(
      `  ${unverified.length} cue${unverified.length === 1 ? " has" : "s have"} no content review — preview in context before shipping.\n`,
    );
  }
  process.stdout.write(`
  import { createSoundboard } from "sfxmint";
  import manifest from "./${where}/${MANIFEST_FILE}";

  const sfx = createSoundboard(manifest, { preload: ["${entries[0]?.file.split(".")[0] ?? "click"}"] });
  button.onclick = () => sfx.play("${entries[0]?.file.split(".")[0] ?? "click"}");

`);
}

main().catch((err) => {
  process.stderr.write(`\n  ${err.message}\n\n`);
  process.exitCode = 1;
});
