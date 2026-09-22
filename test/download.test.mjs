import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFetcher, parseOrigin, resolveRoles, resolveSet, resolveSearch } from "../src/api.mjs";
import { downloadAll, webBase } from "../src/download.mjs";
import { startServer, makeSound, sha256 } from "./helpers.mjs";

const tmp = () => mkdtemp(join(tmpdir(), "sfxmint-test-"));

test("webBase maps a public/ directory to a web path", () => {
  assert.equal(webBase("/app/public/sounds"), "/sounds");
  assert.equal(webBase("/app/public/assets/sfx"), "/assets/sfx");
  assert.equal(webBase("/app/static/sfx"), "");
});

test("role lookup makes a second hop for verifiable metadata and tags via=cli", async () => {
  const coin = makeSound("coin-01");
  const server = await startServer({
    "/api/v1/roles/coin": { role: "coin", label: "Coin", slug: "coin-01" },
    "/api/v1/sounds/coin-01": (u) => server.rewrite(coin.sound),
    "/dl/coin-01.mp3": coin.body,
  });
  const origin = parseOrigin(server.origin);
  const fetcher = createFetcher();
  const { selections } = await resolveRoles(origin, fetcher, ["coin"]);

  assert.equal(selections.length, 1);
  assert.equal(selections[0].sound.slug, "coin-01");
  assert.ok(selections[0].sound.format_metadata, "second hop supplies format_metadata");
  for (const req of server.requests) {
    assert.equal(req.search.get("via"), "cli", `${req.path} carries via=cli`);
  }
  await server.close();
});

test("internal mode keeps self-tests out of the cli channel", async () => {
  const coin = makeSound("coin-01");
  const server = await startServer({
    "/api/v1/roles/coin": { role: "coin", slug: "coin-01" },
    "/api/v1/sounds/coin-01": () => server.rewrite(coin.sound),
  });
  const fetcher = createFetcher({ internal: true });
  await resolveRoles(parseOrigin(server.origin), fetcher, ["coin"]);
  assert.ok(server.requests.every((r) => r.search.get("via") === "internal"));
  await server.close();
});

test("downloads verified bytes and writes a manifest", async () => {
  const coin = makeSound("coin-01");
  const server = await startServer({
    "/api/v1/sounds/coin-01": () => server.rewrite(coin.sound),
    "/dl/coin-01.mp3": coin.body,
  });
  const origin = parseOrigin(server.origin);
  const fetcher = createFetcher();
  const out = await tmp();
  const sound = server.rewrite(coin.sound);

  const { manifest, written } = await downloadAll(
    origin, fetcher, [{ role: "coin", sound }],
    { format: "mp3", out, version: "9.9.9" },
  );

  assert.deepEqual(written, ["coin.mp3"]);
  assert.equal(manifest.generated_by, "sfxmint@9.9.9");
  assert.equal(manifest.license, "CC0-1.0");
  assert.equal(manifest.files.coin.sha256, sha256(coin.body));
  assert.equal(sha256(await readFile(join(out, "coin.mp3"))), sha256(coin.body));
  assert.match(await readFile(join(out, "LICENSE.txt"), "utf8"), /CC0 1\.0/);
  await server.close();
});

test("rejects a checksum mismatch rather than writing the file", async () => {
  const coin = makeSound("coin-01");
  const server = await startServer({
    "/dl/coin-01.mp3": Buffer.from("different bytes entirely"),
  });
  const origin = parseOrigin(server.origin);
  const out = await tmp();
  await assert.rejects(
    downloadAll(origin, createFetcher(), [{ role: "coin", sound: server.rewrite(coin.sound) }], {
      format: "mp3", out,
    }),
    /size mismatch|checksum mismatch/,
  );
  await assert.rejects(readFile(join(out, "coin.mp3")), { code: "ENOENT" });
  await server.close();
});

test("refuses a rejected candidate and an unmet hard condition", async () => {
  const origin = parseOrigin("https://example.com");
  const fetcher = createFetcher();
  const base = makeSound("x-01").sound;

  await assert.rejects(
    downloadAll(origin, fetcher, [
      { role: "x", sound: { ...base, content_check: { status: "rejected", reason: "noise" } } },
    ], { format: "mp3", out: await tmp() }),
    /marked rejected.*noise/,
  );

  await assert.rejects(
    downloadAll(origin, fetcher, [
      { role: "x", sound: { ...base, checks: [{ name: "max_duration", hard: true, state: "unmet" }] } },
    ], { format: "mp3", out: await tmp() }),
    /required condition is not confirmed.*max_duration/,
  );
});

test("refuses a file whose format has no checksum evidence", async () => {
  const sound = makeSound("x-01").sound;
  delete sound.format_metadata.mp3.sha256;
  await assert.rejects(
    downloadAll(parseOrigin("https://example.com"), createFetcher(),
      [{ role: "x", sound }], { format: "mp3", out: await tmp() }),
    /missing file evidence/,
  );
});

test("refuses a file served from an unexpected origin", async () => {
  const sound = makeSound("x-01").sound;
  sound.mp3_url = "https://elsewhere.invalid/dl/x-01.mp3";
  await assert.rejects(
    downloadAll(parseOrigin("https://example.com"), createFetcher(),
      [{ role: "x", sound }], { format: "mp3", out: await tmp() }),
    /unexpected file origin/,
  );
});

test("accepts underscored set role keys (needs_input, add_to_cart)", async () => {
  const cue = makeSound("ui-alert-11");
  const server = await startServer({
    "/api/v1/sets/kit": () => server.rewrite({
      id: "kit", missing_roles: ["done"],
      sounds: { needs_input: cue.sound, add_to_cart: cue.sound },
    }),
    "/dl/ui-alert-11.mp3": cue.body,
  });
  const origin = parseOrigin(server.origin);
  const fetcher = createFetcher();
  const { selections, missingRoles } = await resolveSet(origin, fetcher, "kit");

  assert.deepEqual(missingRoles, ["done"], "an incomplete set reports the gap, not an error");
  const { manifest } = await downloadAll(origin, fetcher, selections, {
    format: "mp3", out: await tmp(),
  });
  assert.deepEqual(Object.keys(manifest.files).sort(), ["add_to_cart", "needs_input"]);
  await server.close();
});

test("will not overwrite different content without --force", async () => {
  const coin = makeSound("coin-01");
  const server = await startServer({ "/dl/coin-01.mp3": coin.body });
  const origin = parseOrigin(server.origin);
  const fetcher = createFetcher();
  const out = await tmp();
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "coin.mp3"), Buffer.from("someone else's file"));
  const selection = [{ role: "coin", sound: server.rewrite(coin.sound) }];

  await assert.rejects(
    downloadAll(origin, fetcher, selection, { format: "mp3", out }),
    /already exists with different content/,
  );
  const forced = await downloadAll(origin, fetcher, selection, { format: "mp3", out, force: true });
  assert.deepEqual(forced.written, ["coin.mp3"]);
  await server.close();
});

test("a second add keeps earlier roles in the manifest", async () => {
  const coin = makeSound("coin-01");
  const jump = makeSound("jump-01");
  const server = await startServer({
    "/dl/coin-01.mp3": coin.body,
    "/dl/jump-01.mp3": jump.body,
  });
  const origin = parseOrigin(server.origin);
  const fetcher = createFetcher();
  const out = await tmp();

  await downloadAll(origin, fetcher, [{ role: "coin", sound: server.rewrite(coin.sound) }], { format: "mp3", out });
  const { manifest } = await downloadAll(origin, fetcher, [{ role: "jump", sound: server.rewrite(jump.sound) }], { format: "mp3", out });

  assert.deepEqual(Object.keys(manifest.files).sort(), ["coin", "jump"]);
  await server.close();
});

test("search reports a gap instead of substituting a near match", async () => {
  const server = await startServer({
    "/api/v1/search": { candidates: [], near_matches: [{ slug: "close-but-no" }] },
  });
  await assert.rejects(
    resolveSearch(parseOrigin(server.origin), createFetcher(), "glass break", {}),
    /No candidate meets the stated conditions.*near matches were not substituted/s,
  );
  await server.close();
});

test("an unknown role points at the index instead of failing opaquely", async () => {
  const server = await startServer({
    "/api/v1/roles/nope": { status: 404, body: { error: "not_found", message: "unknown role" } },
  });
  await assert.rejects(
    resolveRoles(parseOrigin(server.origin), createFetcher(), ["nope"]),
    /Unknown role "nope".*sfxmint search/s,
  );
  await server.close();
});

test("requires HTTPS outside localhost", () => {
  assert.throws(() => parseOrigin("http://example.com"), /HTTPS is required/);
  assert.doesNotThrow(() => parseOrigin("http://localhost:8787"));
});
