"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runSlopeCase, seededRandom } = require("./walker-harness.cjs");

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
