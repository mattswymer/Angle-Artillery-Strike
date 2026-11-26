"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runSlopeCase, seededRandom, legIK } = require("./rig-harness.cjs");

test("seeded random positions are reproducible", () => {
  const a = seededRandom(481516);
  const b = seededRandom(481516);
  assert.deepEqual(Array.from({ length: 12 }, a), Array.from({ length: 12 }, b));
});

test("two-bone IK returns finite targets at reachable and clamped distances", () => {
  for (const foot of [{ x: 0.1, y: -0.6 }, { x: 4, y: -2 }, { x: -0.3, y: -0.5 }]) {
    const result = legIK({ x: 0, y: 0 }, foot, 0.4, 0.36, 1);
    assert.ok(Number.isFinite(result.thighDirection));
    assert.ok(Number.isFinite(result.kneeRelative));
  }
});

for (const degrees of [0, 20, 35, 50]) {
  test(`active rig diagnostic on ${degrees} degree slope`, () => {
    const result = runSlopeCase(degrees);
    console.log(JSON.stringify(result));
    assert.ok(Number.isFinite(result.finalAngle), "torso angle must remain finite");
    assert.ok(Number.isFinite(result.finalPosition.x) && Number.isFinite(result.finalPosition.y),
      "torso position must remain finite");
    if (degrees <= 35) {
      assert.equal(result.stable, true,
        `expected stable stance at ${degrees} degrees; got ${JSON.stringify(result)}`);
    } else {
      assert.equal(result.stable, false,
        `expected loss of stance at ${degrees} degrees; got ${JSON.stringify(result)}`);
    }
  });
}
