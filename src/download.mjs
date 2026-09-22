// Downloads original bytes and writes a manifest. Never modifies audio.
//
// The integrity rules here are inherited from https://sfxmint.com/examples/download-sounds.mjs
// and are deliberately strict: a download that cannot be proven byte-for-byte is an error,
// not a warning. Downloading is not content acceptance — preview cues in your project.

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { createHash } from "node:crypto";

export const MANIFEST_FILE = "sounds.json";
const LICENSE_FILE = "LICENSE.txt";
// Set role keys use underscores (needs_input, add_to_cart, level_up, power_on);
// slugs never do. Both stay restrictive enough to be safe as path segments.
const ROLE_ID = /^[a-z0-9][a-z0-9_-]*$/;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * Web path the runtime should request, derived from where files landed.
 * `public/sounds` → `/sounds` (Vite, Next, CRA); anything else → relative.
 */
export function webBase(outDir) {
  const parts = resolve(outDir).split(sep);
  const i = parts.lastIndexOf("public");
  if (i === -1) return "";
  return "/" + parts.slice(i + 1).join("/");
}

/** Rejects a selection that cannot be delivered honestly, with the reason stated. */
function assertDeliverable(role, sound, format) {
  if (!ROLE_ID.test(role)) throw new Error(`Invalid role id: ${role}`);
  if (!SLUG.test(sound.slug ?? "")) throw new Error(`Invalid slug for role ${role}`);

  if (sound.content_check?.status === "rejected") {
    throw new Error(
      `${role}: candidate ${sound.slug} is marked rejected` +
        (sound.content_check.reason ? ` (${sound.content_check.reason})` : ""),
    );
  }
  const unmet = sound.checks?.filter((c) => c.hard && c.state !== "satisfied") ?? [];
  if (unmet.length) {
    throw new Error(
      `${role}: a required condition is not confirmed — ` +
        unmet.map((c) => c.name ?? c.id ?? "unnamed").join(", "),
    );
  }
  const meta = sound.format_metadata?.[format];
  if (!meta) {
    throw new Error(
      `${role}: no ${format} metadata for ${sound.slug}. Try another --format.`,
    );
  }
  if (meta.decodable === false) throw new Error(`${role}: ${format} is not decodable`);
  if (!/^[a-f0-9]{64}$/.test(meta.sha256 ?? "")) {
    throw new Error(`${role}: missing file evidence (sha256) for ${sound.slug}`);
  }
  return meta;
}

/**
 * Fetch, verify and stage one file. Returns the pending write plus its manifest entry;
 * nothing touches disk until every selection has passed.
 */
async function stage(origin, fetcher, { role, sound }, format, outDir, force) {
  const meta = assertDeliverable(role, sound, format);
  const source = new URL(sound[`${format}_url`]);
  if (source.origin !== origin.origin) {
    throw new Error(`${role}: unexpected file origin ${source.origin}`);
  }

  const bytes = Buffer.from(await (await fetcher.get(source)).arrayBuffer());
  const expectedBytes = meta.bytes ?? meta.remote_bytes;
  if (expectedBytes !== undefined && bytes.length !== expectedBytes) {
    throw new Error(
      `${role}: size mismatch — got ${bytes.length}, expected ${expectedBytes}`,
    );
  }
  const digest = sha256(bytes);
  if (digest !== meta.sha256) {
    throw new Error(`${role}: checksum mismatch for ${sound.slug}`);
  }

  const file = `${role}.${format}`;
  try {
    const existing = await readFile(join(outDir, file));
    if (sha256(existing) !== digest && !force) {
      throw new Error(
        `${file} already exists with different content. ` +
          `Re-run with --force to replace it.`,
      );
    }
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  return {
    write: { file, bytes },
    entry: {
      file,
      slug: sound.slug,
      title: sound.title ?? null,
      label: sound.label ?? null,
      format,
      duration_ms: meta.duration_ms ?? sound.duration_ms ?? null,
      loopable: sound.loopable ?? false,
      sha256: digest,
      bytes: bytes.length,
      source_url: source.href,
      page_url: sound.page_url ?? null,
      license: sound.license ?? "CC0-1.0",
      content_check: sound.content_check ?? null,
      unverified_requirements: sound.unverified_requirements ?? [],
    },
  };
}

async function readManifest(outDir) {
  try {
    const raw = await readFile(join(outDir, MANIFEST_FILE), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.files === "object") return parsed;
  } catch {
    /* absent or unreadable — start fresh */
  }
  return null;
}

/**
 * Verify every selection, then write. Existing entries for other roles are preserved,
 * so `add coin` followed by `add jump` accumulates instead of replacing.
 */
export async function downloadAll(
  origin,
  fetcher,
  selections,
  { format, out, force = false, version = "0.0.0" },
) {
  const outDir = resolve(out);
  const staged = [];
  for (const selection of selections) {
    staged.push(await stage(origin, fetcher, selection, format, outDir, force));
  }

  const previous = await readManifest(outDir);
  const manifest = {
    version: 1,
    generated_by: `sfxmint@${version}`,
    origin: origin.origin,
    base: webBase(outDir),
    license: "CC0-1.0",
    license_url: new URL("/license", origin).href,
    content_notice:
      "File checks confirm bytes, not suitability. Preview each cue in your project.",
    files: { ...(previous?.files ?? {}) },
  };
  for (const { entry } of staged) manifest.files[entry.file.split(".")[0]] = entry;

  await mkdir(outDir, { recursive: true });
  for (const { write } of staged) await writeFile(join(outDir, write.file), write.bytes);
  await writeFile(
    join(outDir, MANIFEST_FILE),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await writeFile(
    join(outDir, LICENSE_FILE),
    "SFXMint sound files: CC0 1.0 Universal (public domain dedication).\n" +
      "https://creativecommons.org/publicdomain/zero/1.0/\n\n" +
      "No attribution, signup or license fee is required, including for commercial use.\n" +
      `See ${MANIFEST_FILE} for exact sources, checksums and content-check status.\n`,
  );

  return { manifest, written: staged.map((s) => s.write.file), outDir };
}
