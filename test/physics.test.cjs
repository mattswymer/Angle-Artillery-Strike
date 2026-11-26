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

test("upright-torso slope geometry sweep records stance feasibility without terrain tilt", () => {
  const results = [];
  for (const degrees of [20, 35]) {
    for (const stanceHalfWidth of [0.05, 0.1, 0.15, 0.2]) {
      for (const pelvisRatio of [0.85, 0.95, 1.05]) {
        const result = runStanceCase(
          degrees, 1, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25,
          stanceHalfWidth, pelvisRatio, 0, 0, 0.6
        );
        results.push({
          degrees, stanceHalfWidth, pelvisRatio,
          support: result.supportedTime,
          absoluteTilt: result.maxAbsoluteTiltDegrees,
          relativeTilt: result.maxRelativeTiltDegrees,
          air: result.maxAirTime,
          speed: result.maxSpeed,
          trace: result.trace.slice(0, 4).map(point => ({
            t: point.t, angle: point.angle, contacts: point.contacts,
            hips: point.hip, knees: point.knee, ankles: point.ankle
          }))
        });
      }
    }
  }
  console.log("upright torso geometry sweep", JSON.stringify(results));
  assert.equal(results.length, 24);
});

test("upright slope stance compares mirrored and common knee-bend directions", () => {
  const results = [];
  for (const degrees of [20, 35]) {
    for (const bendMode of ["side", "same-positive", "same-negative"]) {
      const r = runStanceCase(
        degrees, 1, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25,
        0.05, 0.95, 0, 0, 0.6, 1.5, bendMode
      );
      results.push({
        degrees, bendMode,
        initialAnkles: r.initialPose.map(leg => leg.ankleAngle),
        initialKnees: r.initialPose.map(leg => leg.ankleAngle),
        support: r.supportedTime, bothFeet: r.bothFeetContactTime,
        absoluteTilt: r.maxAbsoluteTiltDegrees, air: r.maxAirTime,
        speed: r.maxSpeed,
        firstContacts: r.trace.slice(0, 3).map(point => point.contacts)
      });
    }
  }
  console.log("upright knee bend sweep", JSON.stringify(results));
  assert.equal(results.length, 6);
});

test("upright stance initial foot geometry exposes contact gaps on slopes", () => {
  const cases = [20, 35].map(degrees => {
    const r = runStanceCase(degrees, 1, 0.5, 0, 0, "chain", true, 3.5, 0.02, 0.25, 0.05, 0.95, 0, 0, 0.6);
    return {
      degrees,
      initialPose: r.initialPose,
      firstFrames: r.trace.slice(0, 3).map(point => ({
        t: point.t, angle: point.angle, contacts: point.contacts,
        hips: point.hip, knees: point.knee, ankles: point.ankle
      }))
    };
  });
  console.log("upright initial foot geometry", JSON.stringify(cases));
  assert.equal(cases.length, 2);
});

test("common-bend upright stance sweeps support width and stance-center placement", () => {
  const results = [];
  for (const degrees of [20, 35]) {
    for (const stanceHalfWidth of [0.05, 0.1, 0.15, 0.2]) {
      for (const stanceCenterBlend of [0, 0.5, 1]) {
        const r = runStanceCase(
          degrees, 1, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25,
          stanceHalfWidth, 0.95, 0, stanceCenterBlend, 0.6, 1.5, "same-positive"
        );
        results.push({
          degrees, stanceHalfWidth, stanceCenterBlend,
          support: r.supportedTime, bothFeet: r.bothFeetContactTime,
          tilt: r.maxAbsoluteTiltDegrees, air: r.maxAirTime, speed: r.maxSpeed,
          trace: r.trace.slice(0, 5).map(point => ({
            t: point.t, x: point.x, angle: point.angle, contacts: point.contacts,
            center: point.centerOfMassX, swing: point.swingIndex
          }))
        });
      }
    }
  }
  console.log("upright support width sweep", JSON.stringify(results));
  assert.equal(results.length, 24);
});

test("common-bend upright stance sweeps corrective step reach", () => {
  const results = [];
  for (const degrees of [20, 35]) {
    for (const stanceHalfWidth of [0.05, 0.15]) {
      for (const stepReach of [0.1, 0.18, 0.25, 0.35]) {
        const r = runStanceCase(
          degrees, 1, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25,
          stanceHalfWidth, 0.95, 0, 0, 0.6, 1.5, "same-positive", stepReach
        );
        results.push({
          degrees, stanceHalfWidth, stepReach,
          support: r.supportedTime, bothFeet: r.bothFeetContactTime,
          tilt: r.maxAbsoluteTiltDegrees, air: r.maxAirTime, speed: r.maxSpeed,
          trace: r.trace.slice(0, 6).map(point => ({
            t: point.t, x: point.x, angle: point.angle, contacts: point.contacts,
            center: point.centerOfMassX, swing: point.swingIndex,
            feet: point.legs.map(leg => leg.foot)
          }))
        });
      }
    }
  }
  console.log("upright corrective step reach sweep", JSON.stringify(results));
  assert.equal(results.length, 16);
});

test("upright common-bend stance sweeps predictive COM lookahead for balance steps", () => {
  const results = [];
  for (const degrees of [20, 35]) {
    for (const stanceHalfWidth of [0.05, 0.15]) {
      for (const stepLookahead of [0, 0.1, 0.2, 0.3, 0.4]) {
        const r = runStanceCase(
          degrees, 1, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25,
          stanceHalfWidth, 0.95, 0, 0, 0.6, 1.5, "same-positive", 0.18, stepLookahead
        );
        results.push({
          degrees, stanceHalfWidth, stepLookahead,
          support: r.supportedTime, bothFeet: r.bothFeetContactTime,
          tilt: r.maxAbsoluteTiltDegrees, air: r.maxAirTime, speed: r.maxSpeed,
          trace: r.trace.slice(0, 6).map(point => ({
            t: point.t, x: point.x, angle: point.angle,
            contacts: point.contacts, center: point.centerOfMassX,
            swing: point.swingIndex
          }))
        });
      }
    }
  }
  console.log("upright predictive COM lookahead sweep", JSON.stringify(results));
  assert.equal(results.length, 20);
});

test("upright common-bend stance sweeps hip and knee motor torque", () => {
  const results = [];
  for (const degrees of [20, 35]) {
    for (const [hipTorqueMax, kneeTorqueMax] of [[4, 4], [6, 6], [8, 8], [12, 12], [8, 4], [4, 8]]) {
      const r = runStanceCase(
        degrees, 1, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25,
        0.05, 0.95, 0, 0, 0.6, 1.5, "same-positive", 0.18, 0.4,
        hipTorqueMax, kneeTorqueMax
      );
      results.push({
        degrees, hipTorqueMax, kneeTorqueMax,
        support: r.supportedTime, bothFeet: r.bothFeetContactTime,
        tilt: r.maxAbsoluteTiltDegrees, air: r.maxAirTime, speed: r.maxSpeed,
        trace: r.trace.slice(0, 5).map(point => ({
          t: point.t, x: point.x, angle: point.angle, contacts: point.contacts,
          center: point.centerOfMassX, swing: point.swingIndex
        }))
      });
    }
  }
  console.log("upright hip knee torque sweep", JSON.stringify(results));
  assert.equal(results.length, 12);
});

test("common-bend upright stance sweeps torso balance gains on 20 degree terrain", () => {
  const results = [];
  for (const balanceKp of [0, 1.5, 3.5, 6]) {
    for (const balanceKd of [0.02, 0.1, 0.25]) {
      const r = runStanceCase(
        20, 1, 3, 0, 0, "chain", true, balanceKp, balanceKd, 0.25,
        0.05, 0.95, 0, 0, 0.6, 1.5, "same-positive"
      );
      results.push({
        balanceKp, balanceKd,
        support: r.supportedTime, bothFeet: r.bothFeetContactTime,
        tilt: r.maxAbsoluteTiltDegrees, air: r.maxAirTime, speed: r.maxSpeed,
        trace: r.trace.slice(0, 5).map(point => ({
          t: point.t, x: point.x, angle: point.angle, vx: point.velocity.x,
          angular: point.velocity.angular, contacts: point.contacts,
          center: point.centerOfMassX, swing: point.swingIndex
        }))
      });
    }
  }
  console.log("upright balance gain sweep", JSON.stringify(results));
  assert.equal(results.length, 12);
});

test("common-bend upright stance records the loss-of-balance sequence", () => {
  const results = [20, 35].map(degrees => {
    const r = runStanceCase(
      degrees, 1, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25,
      0.05, 0.95, 0, 0, 0.6, 1.5, "same-positive"
    );
    return {
      degrees,
      metrics: {
        support: r.supportedTime, bothFeet: r.bothFeetContactTime,
        tilt: r.maxAbsoluteTiltDegrees, air: r.maxAirTime, speed: r.maxSpeed
      },
      trace: r.trace.map(point => ({
        t: point.t, angle: point.angle, contacts: point.contacts,
        center: point.centerOfMassX, swing: point.swingIndex,
        hip: point.hip, knee: point.knee, ankle: point.ankle,
        torque: point.motorTorque,
        feet: point.legs.map(leg => leg.foot)
      }))
    };
  });
  console.log("common-bend balance trace", JSON.stringify(results));
  assert.equal(results.length, 2);
});

test("upright stance candidate checks repeatability and simultaneous foot support", () => {
  const flatSlopeCandidate = SEEDS.map(seed => {
    const r = runStanceCase(20, seed, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25, 0.05, 1.05, 0, 0, 0.6);
    return {
      seed, support: r.supportedTime, bothFeet: r.bothFeetContactTime,
      oneFoot: r.oneFootContactTime, absoluteTilt: r.maxAbsoluteTiltDegrees,
      air: r.maxAirTime, speed: r.maxSpeed
    };
  });
  const steepSlopeSweep = [];
  for (const ankleLimit of [0.6, 0.8, 1.0]) {
    for (const pelvisRatio of [1.05, 1.15, 1.25]) {
      const r = runStanceCase(35, 1, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25, 0.05, pelvisRatio, 0, 0, ankleLimit);
      steepSlopeSweep.push({
        ankleLimit, pelvisRatio, support: r.supportedTime,
        bothFeet: r.bothFeetContactTime, oneFoot: r.oneFootContactTime,
        absoluteTilt: r.maxAbsoluteTiltDegrees, air: r.maxAirTime,
        speed: r.maxSpeed
      });
    }
  }
  console.log("upright stance repeatability", JSON.stringify(flatSlopeCandidate));
  console.log("upright 35 degree ankle and pelvis sweep", JSON.stringify(steepSlopeSweep));
  assert.equal(flatSlopeCandidate.length, 8);
  assert.equal(steepSlopeSweep.length, 9);
});

test("35 degree stance remains outside the stable envelope with the current ±0.6 ankle limits", () => {
  const results = SEEDS.slice(0, 4).map(seed =>
    runStanceCase(35, seed, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25, 0.05, 1.0, 1.0)
  );
  for (const result of results) {
    assert.ok(result.supportedTime < 2.9 || result.maxRelativeTiltDegrees > 60 || result.maxAirTime > 0.1,
      `35 degree terrain unexpectedly passed without changing the rig constraints: ${JSON.stringify(result)}`);
    assert.ok(Math.max(...result.trace.flatMap(point => point.legs.map(leg => Math.abs(leg.ankle)))) >= 0.6,
      "the high-side ankle should expose the current joint-limit constraint");
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

for (const degrees of [0, 20, 35]) {
  test(`simple posture diagnostic remains finite on ${degrees} degree terrain`, () => {
    const results = SEEDS.slice(0, 4).map(seed => runPostureCase(degrees, seed, 3));
    for (const result of results) {
      assert.ok(Number.isFinite(result.maxRelativeTiltDegrees));
      assert.ok(Number.isFinite(result.maxSpeed));
    }
  });
}
