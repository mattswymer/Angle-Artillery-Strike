"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runSlopeCase, runStanceCase, seededRandom, legIK } = require("./walker-harness.cjs");

const SEEDS = [1, 7, 42, 99, 314, 1337, 481516, 8675309];

test("seeded spawn selection is reproducible", () => {
  const a = seededRandom(481516);
  const b = seededRandom(481516);
  assert.deepEqual(Array.from({ length: 12 }, a), Array.from({ length: 12 }, b));
});

test("the same seed reproduces the same physical outcome", () => {
  const first = runSlopeCase(20, 481516, 3);
  const second = runSlopeCase(20, 481516, 3);
  assert.deepEqual(
    {
      stable: first.stable,
      stableTime: first.stableTime,
      contactTime: first.contactTime,
      maxAirTime: first.maxAirTime,
      maxTiltDegrees: first.maxTiltDegrees,
      maxSpeed: first.maxSpeed,
      finalPosition: first.finalPosition
    },
    {
      stable: second.stable,
      stableTime: second.stableTime,
      contactTime: second.contactTime,
      maxAirTime: second.maxAirTime,
      maxTiltDegrees: second.maxTiltDegrees,
      maxSpeed: second.maxSpeed,
      finalPosition: second.finalPosition
    }
  );
});

for (const degrees of [0, 20, 35]) {
  test(`reference biped maintains locomotion across randomized starts on ${degrees} degree terrain`, () => {
    const failures = [];
    for (const seed of SEEDS) {
      const result = runSlopeCase(degrees, seed, 3);
      if (!Number.isFinite(result.maxTiltDegrees) ||
          !Number.isFinite(result.finalPosition.x) ||
          !Number.isFinite(result.finalPosition.y) ||
          result.everFallen ||
          result.stableTime < 1.5) {
        failures.push({ seed, result });
      }
    }
    assert.deepEqual(failures, [],
      `walker should remain upright with at least 1.5s supported time for all seeds: ${JSON.stringify(failures)}`);
  });
}

test("50 degree terrain exceeds the controlled gait envelope across randomized starts", () => {
  const missed = [];
  for (const seed of SEEDS) {
    const result = runSlopeCase(50, seed, 3);
    if (!result.lostControl) missed.push({ seed, result });
  }
  assert.deepEqual(missed, [],
    `50 degree slope should exceed the controlled locomotion envelope for all seeds: ${JSON.stringify(missed)}`);
});

for (const degrees of [0, 20, 35]) {
  test(`reference biped maintains locomotion on gently uneven ${degrees} degree terrain`, () => {
    const failures = [];
    for (const seed of SEEDS) {
      const result = runSlopeCase(degrees, seed, 3, 0.035);
      if (result.everFallen || result.stableTime < 1.5 ||
          !Number.isFinite(result.finalPosition.x) ||
          !Number.isFinite(result.finalPosition.y)) {
        failures.push({ seed, result });
      }
    }
    assert.deepEqual(failures, [],
      `walker should remain upright on uneven terrain for all seeds: ${JSON.stringify(failures)}`);
  });
}

test("each leg has a separate foot and ankle joints configured with ±0.6 radian limits", () => {
  const result = runSlopeCase(20, 2026, 3);
  assert.equal(result.footCount, 2);
  assert.equal(result.ankleJointCount, 2);
  assert.ok(Number.isFinite(result.maxAnkleAngle));
  assert.equal(result.ankleLowerLimit, -0.6);
  assert.equal(result.ankleUpperLimit, 0.6);
  assert.ok(result.maxAnkleAngle < 0.9,
    `ankle angle excursion exceeded the diagnostic safety bound: ${result.maxAnkleAngle}`);
});

test("all six hip, knee, and ankle joints are routed through the shared motor driver", () => {
  const result = runSlopeCase(20, 20261125, 3);
  assert.equal(result.jointCount, 6);
  assert.equal(result.motorJointCount, 6);
});

test("two-bone IK reconstructs reachable foot targets for both bend directions", () => {
  const cases = [
    { hip: { x: 0, y: 1 }, foot: { x: 0, y: 0 } },
    { hip: { x: -0.2, y: 1.1 }, foot: { x: 0.35, y: 0.05 } },
    { hip: { x: 0.4, y: 0.9 }, foot: { x: -0.3, y: 0.15 } },
    { hip: { x: -0.5, y: 0.8 }, foot: { x: 0.2, y: -0.1 } }
  ];
  const upperLength = 0.6;
  const lowerLength = 0.6;

  for (const bend of [-1, 1]) {
    for (const sample of cases) {
      const solution = legIK(sample.hip, sample.foot, upperLength, lowerLength, bend);
      const shinDirection = solution.thighDir - solution.kneeRel;
      const knee = {
        x: sample.hip.x + upperLength * Math.cos(solution.thighDir),
        y: sample.hip.y + upperLength * Math.sin(solution.thighDir)
      };
      const reconstructedFoot = {
        x: knee.x + lowerLength * Math.cos(shinDirection),
        y: knee.y + lowerLength * Math.sin(shinDirection)
      };
      const error = Math.hypot(
        reconstructedFoot.x - sample.foot.x,
        reconstructedFoot.y - sample.foot.y
      );
      assert.ok(error < 1e-6,
        `IK reconstruction error ${error} for bend ${bend}`);
    }
  }
});

test("two-bone IK clamps unreachable targets without producing invalid angles", () => {
  const solution = legIK(
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    0.6,
    0.6,
    1
  );
  assert.ok(Number.isFinite(solution.thighDir));
  assert.ok(Number.isFinite(solution.kneeRel));
  assert.ok(solution.distance > 0);
});

for (const degrees of [0, 20, 35]) {
  test(`IK stance controller remains numerically stable on ${degrees} degree terrain`, () => {
    const results = SEEDS.slice(0, 4).map(seed => runStanceCase(degrees, seed, 3));
    for (const result of results) {
      assert.equal(result.finite, true, `non-finite state on ${degrees} degree terrain: ${JSON.stringify(result)}`);
      assert.ok(Number.isFinite(result.maxSpeed));
      assert.ok(Number.isFinite(result.maxRelativeTiltDegrees));
      assert.ok(result.maxSpeed < 30, `stance controller became unbounded: ${JSON.stringify(result)}`);
    }
  });
}
