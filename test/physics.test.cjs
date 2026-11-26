"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runSlopeCase, seededRandom } = require("./walker-harness.cjs");

test("seeded spawn selection is reproducible", () => {
  const a = seededRandom(481516);
  const b = seededRandom(481516);
  assert.deepEqual(Array.from({ length: 12 }, a), Array.from({ length: 12 }, b));
});

for (const degrees of [0, 20, 35]) {
  test(`reference biped maintains locomotion on ${degrees} degree terrain`, () => {
    const result = runSlopeCase(degrees, 12345, 3);
    assert.ok(Number.isFinite(result.maxTiltDegrees), "torso angle must remain finite");
    assert.ok(Number.isFinite(result.finalPosition.x) && Number.isFinite(result.finalPosition.y),
      "walker position must remain finite");
    assert.equal(result.everFallen, false,
      `walker should remain upright on ${degrees} degree terrain: ${JSON.stringify(result)}`);
    assert.ok(result.stableTime >= 1.5,
      `walker should maintain ground contact for at least half the test: ${JSON.stringify(result)}`);
  });
}

test("reference biped loses its stance on a 50 degree slope", () => {
  const result = runSlopeCase(50, 12345, 3);
  assert.equal(result.everFallen, true,
    `50 degree slope should exceed the walker's support envelope: ${JSON.stringify(result)}`);
});
