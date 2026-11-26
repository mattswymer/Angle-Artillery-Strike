"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runSlopeCase, seededRandom, solveLegIK } = require("./rig-harness.cjs");

test("seeded random positions are reproducible", () => {
  const a = seededRandom(481516);
  const b = seededRandom(481516);
  assert.deepEqual(Array.from({ length: 12 }, a), Array.from({ length: 12 }, b));
});

test("two-bone IK returns finite targets at reachable and clamped distances", () => {
  for (const foot of [{ x: 0.1, y: -0.6 }, { x: 4, y: -2 }, { x: -0.3, y: -0.5 }]) {
    const result = solveLegIK({ x: 0, y: 0 }, foot, 0.4, 0.36, 1);
    assert.ok(Number.isFinite(result.thighAngle));
    assert.ok(Number.isFinite(result.kneeRelative));
    assert.ok(Number.isFinite(result.shinAngle));
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
      for (const joint of result.spawnJointTargets) {
        assert.ok(joint.hip >= -1.25 && joint.hip <= 1.25,
          `spawn hip target out of range at ${degrees} degrees: ${JSON.stringify(joint)}`);
        const kneeValid = joint.knee >= -2.4 && joint.knee <= 2.4;
        assert.ok(kneeValid,
          `spawn knee target out of range at ${degrees} degrees: ${JSON.stringify(joint)}`);
        assert.ok(joint.ankle >= -0.6 && joint.ankle <= 0.6,
          `spawn ankle target out of range at ${degrees} degrees: ${JSON.stringify(joint)}`);
      }
      assert.equal(result.everLimp, false,
        `spawned rig must not enter limp mode at ${degrees} degrees; got ${JSON.stringify(result)}`);
      assert.equal(result.stable, true,
        `expected stable stance at ${degrees} degrees; got ${JSON.stringify(result)}`);
    } else {
      assert.equal(result.everLimp, true,
        `50 degree slope should release the stance controller; got ${JSON.stringify(result)}`);
      assert.equal(result.stable, false,
        `expected loss of stance at ${degrees} degrees; got ${JSON.stringify(result)}`);
    }
  });
}

test("diagnostic: flat and 20-degree stance without protective stepping", () => {
  const flat = runSlopeCase(0, 12345, false);
  const slope = runSlopeCase(20, 12345, false);
  console.log("NO_STEP_DIAGNOSTIC", JSON.stringify({
    flat: { stable: flat.stable, stableFor: flat.stableFor, everLimp: flat.everLimp, finalAngle: flat.finalAngle, trace: flat.trace },
    slope20: { stable: slope.stable, stableFor: slope.stableFor, everLimp: slope.everLimp, finalAngle: slope.finalAngle, trace: slope.trace }
  }));
  assert.ok(Number.isFinite(flat.finalAngle) && Number.isFinite(slope.finalAngle));
});
