import { test } from "node:test";
import assert from "node:assert/strict";
import { createSoundboard } from "../src/soundboard.mjs";

const manifest = {
  base: "/sounds",
  files: {
    coin: { file: "coin.mp3", slug: "retro-game-coin-13" },
    jump: { file: "jump.mp3", slug: "retro-game-jump-01" },
  },
};

// Next.js and friends import this module on the server. Nothing may touch window there.
test("is inert during SSR instead of throwing", () => {
  assert.equal(typeof window, "undefined", "this test only means something without a DOM");
  const sfx = createSoundboard(manifest, { preload: ["coin"] });

  assert.deepEqual(sfx.names, ["coin", "jump"]);
  assert.equal(sfx.muted, false);
  assert.equal(sfx.play("coin"), null, "play is a no-op, not an error");
  assert.doesNotThrow(() => sfx.stop());
  assert.doesNotThrow(() => sfx.dispose());
});

test("mute state is readable without a browser", () => {
  const sfx = createSoundboard(manifest);
  assert.equal(sfx.setMuted(true), true);
  assert.equal(sfx.muted, true);
  assert.equal(sfx.setMuted(), false, "no argument toggles");
  assert.equal(sfx.setMuted(), true);
});

test("methods survive destructuring", () => {
  // `const { play, setMuted } = sfx` is the common React pattern; `this` must not be involved.
  const { play, setMuted, stop, dispose } = createSoundboard(manifest);
  assert.doesNotThrow(() => setMuted(true));
  assert.equal(play("coin"), null);
  assert.doesNotThrow(() => stop());
  assert.doesNotThrow(() => dispose());
});

test("an empty or missing manifest does not throw", () => {
  assert.deepEqual(createSoundboard(undefined).names, []);
  assert.deepEqual(createSoundboard({}).names, []);
  assert.equal(createSoundboard({ files: {} }).play("nope"), null);
});

test("preload resolves even with nothing to load", async () => {
  await assert.doesNotReject(createSoundboard(manifest).preload(["coin"]));
});
