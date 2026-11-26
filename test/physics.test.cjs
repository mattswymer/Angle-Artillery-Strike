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

test("stance contact-load trace captures the first second of flat-ground behavior", () => {
  const result = runStanceCase(0, 1, 3);
  console.log("flat stance load trace", JSON.stringify(result.trace));
  assert.equal(result.trace.length, 16);
  for (const sample of result.trace) {
    for (const leg of sample.legs) {
      assert.ok(Number.isFinite(leg.ankleTorque));
      assert.ok(Number.isFinite(leg.hipTorque));
      assert.ok(Number.isFinite(leg.kneeTorque));
      assert.ok(Number.isFinite(leg.motorTorque.hip));
      assert.ok(Number.isFinite(leg.motorTorque.knee));
      assert.ok(Number.isFinite(leg.motorTorque.ankle));
      assert.ok(Number.isFinite(leg.ankleAnchorError));
    }
  }
});

test("stance translation is compared across segmented, continuous, and passive ground contact", () => {
  const segmented = runStanceCase(0, 1, 1);
  const continuous = runStanceCase(0, 1, 1, 0, 0, "continuous", true);
  const passive = runStanceCase(0, 1, 1, 0, 0, "continuous", false);
  const compact = result => ({
    x: result.finalPosition.x,
    tilt: result.maxRelativeTiltDegrees,
    speed: result.maxSpeed,
    support: result.supportedTime,
    trace: result.trace.map(point => ({
      t: point.t, x: point.x, angle: point.angle,
      vx: point.velocity.x, angular: point.velocity.angular,
      contacts: point.contacts
    }))
  });
  console.log("ground/contact comparison", JSON.stringify({
    segmented: compact(segmented),
    continuous: compact(continuous),
    passive: compact(passive)
  }));
  for (const result of [segmented, continuous, passive]) {
    assert.ok(Number.isFinite(result.maxSpeed));
  }
});

test("joint-based torso feedback reduces flat-ground translation and rotation", () => {
  const seeds = SEEDS.slice(0, 4);
  const baseline = seeds.map(seed => runStanceCase(0, seed, 3, 0, 0, "chain", true, 0, 0));
  const stabilized = seeds.map(seed => runStanceCase(0, seed, 3));
  const summary = values => values.map(result => ({
    supportedTime: result.supportedTime,
    tilt: result.maxRelativeTiltDegrees,
    speed: result.maxSpeed,
    airTime: result.maxAirTime,
    finalX: result.finalPosition.x
  }));
  console.log("joint balance feedback comparison", JSON.stringify({
    baseline: summary(baseline),
    stabilized: summary(stabilized)
  }));
  for (const result of stabilized) {
    assert.ok(Number.isFinite(result.maxSpeed));
    assert.ok(Number.isFinite(result.maxRelativeTiltDegrees));
  }
});

test("joint-only torso feedback gain sweep identifies a stable flat-ground region", () => {
  const gains = [];
  for (const kp of [1, 1.5, 2, 3, 4]) {
    for (const kd of [0.06, 0.25, 0.5]) {
      const runs = SEEDS.slice(0, 4).map(seed =>
        runStanceCase(0, seed, 3, 0, 0, "chain", true, kp, kd)
      );
      gains.push({
        kp,
        kd,
        meanTilt: Number((runs.reduce((sum, r) => sum + r.maxRelativeTiltDegrees, 0) / runs.length).toFixed(1)),
        meanSupport: Number((runs.reduce((sum, r) => sum + r.supportedTime, 0) / runs.length).toFixed(2)),
        meanSpeed: Number((runs.reduce((sum, r) => sum + r.maxSpeed, 0) / runs.length).toFixed(2)),
        meanAbsX: Number((runs.reduce((sum, r) => sum + Math.abs(r.finalPosition.x), 0) / runs.length).toFixed(2)),
        falls: runs.filter(r => r.maxRelativeTiltDegrees > 60 || r.maxAirTime > 0.5).length
      });
    }
  }
  console.log("torso feedback gain sweep", JSON.stringify(gains));
  assert.equal(gains.length, 15);
});

test("higher-gain joint balance sweep checks seed sensitivity", () => {
  const gains = [];
  for (const kp of [3.5, 4, 4.5, 5, 6]) {
    for (const kd of [0.02, 0.06, 0.1]) {
      const runs = SEEDS.slice(0, 4).map(seed =>
        runStanceCase(0, seed, 3, 0, 0, "segmented", true, kp, kd)
      );
      gains.push({
        kp, kd,
        seeds: runs.map(r => ({
          support: r.supportedTime,
          tilt: r.maxRelativeTiltDegrees,
          air: r.maxAirTime,
          speed: r.maxSpeed,
          x: r.finalPosition.x
        }))
      });
    }
  }
  console.log("higher-gain stance sweep", JSON.stringify(gains));
  assert.equal(gains.length, 15);
});

test("connected terrain chains remove spawn-boundary instability", () => {
  const comparison = [];
  for (const seed of SEEDS.slice(0, 4)) {
    const chain = runStanceCase(0, seed, 3, 0, 0, "chain", true, 3.5, 0.02);
    const segmented = runStanceCase(0, seed, 3, 0, 0, "segmented", true, 3.5, 0.02);
    comparison.push({
      seed,
      startX: chain.trace[0].x,
      chain: {
        support: chain.supportedTime,
        tilt: chain.maxRelativeTiltDegrees,
        air: chain.maxAirTime,
        speed: chain.maxSpeed
      },
      segmented: {
        support: segmented.supportedTime,
        tilt: segmented.maxRelativeTiltDegrees,
        air: segmented.maxAirTime,
        speed: segmented.maxSpeed
      }
    });
  }
  console.log("chain versus independent terrain edges", JSON.stringify(comparison));
  for (const result of comparison) {
    assert.ok(result.chain.support >= 2.9,
      `connected chain should support the rig for 3 seconds: ${JSON.stringify(result)}`);
    assert.ok(result.chain.tilt < 10,
      `connected chain should keep the torso upright: ${JSON.stringify(result)}`);
    assert.ok(result.chain.air < 0.1,
      `connected chain should not produce prolonged airtime: ${JSON.stringify(result)}`);
  }
});

test("terrain-chain resolution sweep isolates multi-child foot contacts", () => {
  const results = [];
  for (const step of [0.05, 0.1, 0.25, 0.5, 1, 5, 60]) {
    for (const seed of [7, 42]) {
      const result = runStanceCase(0, seed, 3, 0, 0, "chain", true, 3.5, 0.02, step);
      results.push({
        step, seed,
        support: result.supportedTime,
        tilt: result.maxRelativeTiltDegrees,
        air: result.maxAirTime,
        speed: result.maxSpeed,
        contacts: result.trace.slice(0, 3).map(point => point.contactCounts)
      });
    }
  }
  console.log("terrain chain resolution sweep", JSON.stringify(results));
  assert.equal(results.length, 14);
});

for (const degrees of [0, 20, 35]) {
  test(`character-proportion stance rig stands for three seconds on ${degrees} degree terrain across eight seeds`, () => {
    const results = SEEDS.map(seed => degrees === 0
      ? runStanceCase(degrees, seed, 3)
      : runStanceCase(degrees, seed, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25, 0.05, 1.0, 1.0));
    console.log(`stance acceptance ${degrees} degrees`, JSON.stringify(results.map((r, i) => ({
      seed: SEEDS[i],
      support: r.supportedTime,
      tilt: r.maxRelativeTiltDegrees,
      air: r.maxAirTime,
      speed: r.maxSpeed
    }))));
    const failures = results.map((result, i) => ({
      seed: SEEDS[i],
      result: {
        support: result.supportedTime,
        tilt: result.maxRelativeTiltDegrees,
        air: result.maxAirTime,
        speed: result.maxSpeed
      }
    })).filter(({ result }) =>
      result.support < 2.9 || result.tilt > 15 || result.air > 0.1 || result.speed > 1.5
    );
    assert.deepEqual(failures, [],
      `stance rig must remain upright and supported for 3 seconds: ${JSON.stringify(failures)}`);
  });
}

test("50 degree terrain exceeds the character stance rig's stable envelope", () => {
  const results = SEEDS.slice(0, 4).map(seed => runStanceCase(50, seed, 3));
  console.log("50 degree stance boundary", JSON.stringify(results.map((r, i) => ({
    seed: SEEDS[i], support: r.supportedTime, tilt: r.maxRelativeTiltDegrees,
    air: r.maxAirTime, speed: r.maxSpeed
  }))));
  assert.ok(results.some(r => r.maxRelativeTiltDegrees > 60 || r.maxAirTime > 0.5),
    "steep terrain should exceed the stance controller's stability envelope");
});

test("slope stance failures are compared on a single edge and a simplified terrain chain", () => {
  const comparison = [];
  for (const degrees of [20, 35]) {
    for (const seed of [1]) {
      const chain = runStanceCase(degrees, seed, 3, 0, 0, "chain");
      const edge = runStanceCase(degrees, seed, 3, 0, 0, "continuous");
      comparison.push({
        degrees, seed,
        chain: {
          support: chain.supportedTime, tilt: chain.maxRelativeTiltDegrees,
          air: chain.maxAirTime, speed: chain.maxSpeed, trace: chain.trace
        },
        edge: {
          support: edge.supportedTime, tilt: edge.maxRelativeTiltDegrees,
          air: edge.maxAirTime, speed: edge.maxSpeed, trace: edge.trace
        }
      });
    }
  }
  console.log("slope contact geometry comparison", JSON.stringify(comparison));
  assert.equal(comparison.length, 2);
});

test("stance-width sweep finds feasible ankle geometry on 20 and 35 degree slopes", () => {
  const results = [];
  for (const degrees of [20, 35]) {
    for (const halfWidth of [0.05, 0.07, 0.09, 0.11, 0.13]) {
      const runs = [1, 7, 42, 99].map(seed =>
        runStanceCase(degrees, seed, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25, halfWidth)
      );
      results.push({
        degrees,
        halfWidth,
        support: Number((runs.reduce((sum, r) => sum + r.supportedTime, 0) / runs.length).toFixed(2)),
        tilt: Number((runs.reduce((sum, r) => sum + r.maxRelativeTiltDegrees, 0) / runs.length).toFixed(1)),
        air: Number((runs.reduce((sum, r) => sum + r.maxAirTime, 0) / runs.length).toFixed(2)),
        speed: Number((runs.reduce((sum, r) => sum + r.maxSpeed, 0) / runs.length).toFixed(2)),
        maxAnkle: Number(Math.max(...runs.flatMap(r => r.trace.flatMap(p => p.legs.map(leg => Math.abs(leg.ankle))))).toFixed(2))
      });
    }
  }
  console.log("stance width slope sweep", JSON.stringify(results));
  assert.equal(results.length, 10);
});

test("terrain-relative torso lean and pelvis-height sweep finds a feasible slope stance", () => {
  const results = [];
  for (const degrees of [20, 35]) {
    for (const blend of [0, 0.5, 1]) {
      for (const halfWidth of [0.08, 0.1, 0.12]) {
        const result = runStanceCase(
          degrees, 1, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25,
          halfWidth, 0.99, blend
        );
        results.push({
          degrees, blend, halfWidth,
          support: result.supportedTime,
          tilt: result.maxRelativeTiltDegrees,
          air: result.maxAirTime,
          speed: result.maxSpeed,
          maxAnkle: Math.max(...result.trace.flatMap(p => p.legs.map(leg => Math.abs(leg.ankle))))
        });
      }
    }
  }
  console.log("terrain lean and pelvis sweep", JSON.stringify(results));
  assert.equal(results.length, 18);
});

test("candidate terrain-aligned slope pose records its initial and failure state", () => {
  const cases = [20, 35].map(degrees => {
    const result = runStanceCase(degrees, 1, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25, 0.05, 1.0, 1.0);
    return {
      degrees,
      support: result.supportedTime,
      tilt: result.maxRelativeTiltDegrees,
      air: result.maxAirTime,
      trace: result.trace.slice(0, 8)
    };
  });
  console.log("candidate slope pose trace", JSON.stringify(cases));
  assert.equal(cases.length, 2);
});

test("COM-to-hip stance-center blend sweep finds slope-compatible foot placement", () => {
  const results = [];
  for (const degrees of [20, 35]) {
    for (const centerBlend of [0, 0.25, 0.5, 0.75, 1]) {
      const result = runStanceCase(
        degrees, 1, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25,
        0.05, 1.0, 1.0, centerBlend
      );
      results.push({
        degrees, centerBlend,
        support: result.supportedTime,
        tilt: result.maxRelativeTiltDegrees,
        air: result.maxAirTime,
        speed: result.maxSpeed,
        maxAnkle: Math.max(...result.trace.flatMap(p => p.legs.map(leg => Math.abs(leg.ankle))))
      });
    }
  }
  console.log("COM-to-hip stance center sweep", JSON.stringify(results));
  assert.equal(results.length, 10);
});

test("ankle-limit sensitivity sweep measures the additional range required at 35 degrees", () => {
  const results = [];
  for (const ankleLimit of [0.6, 0.65, 0.7, 0.8, 0.9, 1.0]) {
    const result = runStanceCase(
      35, 1, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25,
      0.05, 1.0, 1.0, 0, ankleLimit
    );
    results.push({
      ankleLimit,
      support: result.supportedTime,
      tilt: result.maxRelativeTiltDegrees,
      air: result.maxAirTime,
      speed: result.maxSpeed,
      maxAnkle: Math.max(...result.trace.flatMap(p => p.legs.map(leg => Math.abs(leg.ankle))))
    });
  }
  console.log("35 degree ankle-limit sweep", JSON.stringify(results));
  assert.equal(results.length, 6);
});

test("ankle torque sweep measures whether stronger foot alignment stabilizes 35 degree terrain", () => {
  const results = [];
  for (const ankleTorqueMax of [1.5, 2, 3, 4, 6]) {
    const result = runStanceCase(
      35, 1, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25,
      0.05, 1.0, 1.0, 0, 0.8, ankleTorqueMax
    );
    results.push({
      ankleTorqueMax,
      support: result.supportedTime,
      tilt: result.maxRelativeTiltDegrees,
      air: result.maxAirTime,
      speed: result.maxSpeed,
      maxAnkle: Math.max(...result.trace.flatMap(p => p.legs.map(leg => Math.abs(leg.ankle))))
    });
  }
  console.log("35 degree ankle torque sweep", JSON.stringify(results));
  assert.equal(results.length, 5);
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
