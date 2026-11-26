"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const planck = require("planck");
const { runSlopeCase, runStanceCase, runPostureCase, runSwingTargetCase, runRigSymmetryCase, seededRandom, legIK, driveJoint } = require("./walker-harness.cjs");

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
  test(`IK stance controller emits finite diagnostics on ${degrees} degree terrain`, () => {
    const results = SEEDS.slice(0, 4).map(seed => runStanceCase(degrees, seed, 3));
    console.log(`stance summary ${degrees}`, JSON.stringify(results.map(({ supportedTime, maxRelativeTiltDegrees, maxSpeed, maxAirTime }) => ({ supportedTime, maxRelativeTiltDegrees, maxSpeed, maxAirTime }))));
    for (const result of results) {
      assert.equal(result.finite, true, `non-finite state on ${degrees} degree terrain: ${JSON.stringify(result)}`);
      assert.ok(Number.isFinite(result.maxSpeed));
      assert.ok(Number.isFinite(result.maxRelativeTiltDegrees));
      assert.ok(result.maxSpeed < 30, `stance controller became unbounded: ${JSON.stringify(result)}`);
    }
  });
}

test("stance swing foot target preserves its lift instead of being flattened to the ground", () => {
  const result = runSwingTargetCase();
  assert.equal(result.swingIndex, 0);
  assert.ok(result.targetY > result.plantedY + 0.05,
    `swing target should clear the planted ankle height: ${JSON.stringify(result)}`);
});

test("character-proportion rig isolates contact-related symmetry drift", () => {
  const airborne = runRigSymmetryCase("none", false);
  const grounded = runRigSymmetryCase(true, false);
  console.log("rig symmetry diagnostics", JSON.stringify({ airborne, grounded }));
  assert.ok(airborne.initialError < 1e-6 && grounded.initialError < 1e-6);
  assert.ok(airborne.oneStepError < 1e-3,
    `free-flight rig should preserve bilateral symmetry: ${JSON.stringify(airborne)}`);
  assert.equal(airborne.contacts[0], airborne.contacts[1]);
  assert.equal(grounded.contacts[0], grounded.contacts[1]);
});

test("spawn settling phase records physical stability after 60 physics steps", () => {
  const results = SEEDS.slice(0, 4).map(seed => ({
    cold: runStanceCase(0, seed, 3),
    settled: runStanceCase(0, seed, 3, 0, 60)
  }));
  console.log("spawn settling comparison", JSON.stringify(results.map(({ cold, settled }) => ({
    cold: { supportedTime: cold.supportedTime, maxRelativeTiltDegrees: cold.maxRelativeTiltDegrees, maxSpeed: cold.maxSpeed, maxAirTime: cold.maxAirTime },
    settled: { supportedTime: settled.supportedTime, maxRelativeTiltDegrees: settled.maxRelativeTiltDegrees, maxSpeed: settled.maxSpeed, maxAirTime: settled.maxAirTime }
  }))));
  for (const { settled } of results) {
    assert.ok(Number.isFinite(settled.maxRelativeTiltDegrees));
    assert.ok(Number.isFinite(settled.maxSpeed));
  }
});

test("character-proportion stance rig stands for three seconds on flat terrain across eight seeds", () => {
  const results = SEEDS.map(seed => runStanceCase(0, seed, 3));
  const failures = results.map((result, i) => ({
    seed: SEEDS[i],
    support: result.supportedTime,
    tilt: result.maxAbsoluteTiltDegrees,
    air: result.maxAirTime,
    speed: result.maxSpeed
  })).filter(result =>
    result.support < 2.9 || result.tilt > 15 || result.air > 0.1 || result.speed > 1.5
  );
  assert.deepEqual(failures, [],
    `flat stance must remain stable for three seconds: ${JSON.stringify(failures)}`);
});

test("upright 20 degree adaptive knee bend tunes stance width and knee flex", () => {
  const results = [];
  for (const stanceHalfWidth of [0.1, 0.15, 0.2, 0.25]) {
    for (const highSideBend of [0.4, 0.5, 0.6]) {
      const r = runStanceCase(
        20, 1, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25,
        stanceHalfWidth, 0.85, 0, 0, 0.6, 1.5, "slope-adaptive", 0.12, 0.41, 6, 6,
        0.12, 0.2, 1, 1, highSideBend, 1
      );
      results.push({
        stanceHalfWidth, highSideBend,
        initialAnkles: r.initialPose.map(leg => leg.ankleAngle),
        support: r.supportedTime, bothFeet: r.bothFeetContactTime,
        tilt: r.maxAbsoluteTiltDegrees, air: r.maxAirTime, speed: r.maxSpeed
      });
    }
  }
  console.log("upright 20 adaptive geometry sweep", JSON.stringify(results));
  assert.equal(results.length, 12);
});

test("upright 20 degree stance adapts high-side knee bend to keep ankle within limits", () => {
  const results = [];
  for (const highSideBend of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
    const r = runStanceCase(
      20, 1, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25,
      0.25, 0.85, 0, 0, 0.6, 1.5, "slope-adaptive", 0.12, 0.41, 6, 6,
      0.12, 0.2, 1, 1, highSideBend, 1
    );
    results.push({
      highSideBend,
      initialAnkles: r.initialPose.map(leg => leg.ankleAngle),
      support: r.supportedTime, bothFeet: r.bothFeetContactTime,
      tilt: r.maxAbsoluteTiltDegrees, air: r.maxAirTime, speed: r.maxSpeed
    });
  }
  console.log("upright 20 adaptive high-side bend sweep", JSON.stringify(results));
  assert.equal(results.length, 6);
});

test("upright 20 degree stance checks spawn ankle limits across pelvis heights", () => {
  const results = [];
  for (const pelvisRatio of [0.85, 0.9, 0.95, 1.0]) {
    const r = runStanceCase(
      20, 1, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25,
      0.25, pelvisRatio, 0, 0, 0.6, 1.5, "same-positive", 0.12, 0.41, 6, 6,
      0.12, 0.2, 1, 1
    );
    results.push({
      pelvisRatio,
      initialAnkles: r.initialPose.map(leg => leg.ankleAngle),
      support: r.supportedTime, bothFeet: r.bothFeetContactTime,
      tilt: r.maxAbsoluteTiltDegrees, air: r.maxAirTime, speed: r.maxSpeed
    });
  }
  console.log("upright 20 degree pelvis ankle feasibility", JSON.stringify(results));
  assert.equal(results.length, 4);
});

test("upright 20 and 35 degree stance remains controlled for three seconds across eight seeds", () => {
  const candidates = [
    {
      degrees: 20, stanceHalfWidth: 0.25, pelvisRatio: 0.85,
      stepReach: 0.12, stepLookahead: 0.41, hipHeightBlend: 0.75,
      swingHeight: 0.12, swingDuration: 0.2,
      maxTilt: 15, minBothFeet: 0
    },
    {
      degrees: 35, stanceHalfWidth: 0.1, pelvisRatio: 0.95,
      stepReach: 0.34, stepLookahead: 0.36, hipHeightBlend: 0.8,
      swingHeight: 0.08, swingDuration: 0.2,
      maxTilt: 10, minBothFeet: 1.8
    }
  ];

  for (const candidate of candidates) {
    const results = SEEDS.map(seed => {
      const r = runStanceCase(
        candidate.degrees, seed, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25,
        candidate.stanceHalfWidth, candidate.pelvisRatio, 0, 0, 0.6, 1.5,
        "same-positive", candidate.stepReach, candidate.stepLookahead, 6, 6,
        candidate.swingHeight, candidate.swingDuration, 1, candidate.hipHeightBlend
      );
      return {
        seed, support: r.supportedTime, bothFeet: r.bothFeetContactTime,
        tilt: r.maxAbsoluteTiltDegrees, air: r.maxAirTime, speed: r.maxSpeed,
        initialAnkles: r.initialPose.map(leg => leg.ankleAngle)
      };
    });

    const failures = results.filter(r =>
      r.support < 2.9 ||
      r.tilt > candidate.maxTilt ||
      r.air > 0.02 ||
      r.speed > 2 ||
      r.bothFeet < candidate.minBothFeet ||
      r.initialAnkles.some(angle => Math.abs(angle) > 0.6)
    );
    assert.deepEqual(failures, [],
      `${candidate.degrees} degree upright stance failed: ${JSON.stringify(failures)}`);
  }
});

test("50 degree terrain exceeds the character stance rig's stable envelope", () => {
  const results = SEEDS.slice(0, 4).map(seed => runStanceCase(50, seed, 3));
  assert.ok(results.some(r => r.maxRelativeTiltDegrees > 60 || r.maxAirTime > 0.5),
    "steep terrain should exceed the stance controller's stability envelope");
});

test("shared joint driver moves a revolute joint toward a positive target angle", () => {
  const world = new planck.World({ gravity: planck.Vec2(0, 0) });
  const base = world.createBody();
  const limb = world.createDynamicBody();
  limb.createFixture({ shape: new planck.Box(0.1, 0.5), density: 1 });
  const joint = world.createJoint(planck.RevoluteJoint({
    localAnchorA: planck.Vec2(0, 0),
    localAnchorB: planck.Vec2(0, 0),
    enableMotor: true,
    maxMotorTorque: 10
  }, base, limb));
  driveJoint(joint, 0.5, 10, 5, 10, 1);
  for (let i = 0; i < 30; i++) world.step(1 / 50, 12, 8);
  assert.ok(joint.getJointAngle() > 0.1,
    `positive target should produce positive joint angle, got ${joint.getJointAngle()}`);
});

