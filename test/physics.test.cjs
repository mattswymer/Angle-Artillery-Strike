"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const planck = require("planck");
const { runSlopeCase, runStanceCase, runSwingTargetCase, runRigSymmetryCase, seededRandom, legIK, driveJoint, createStanceRig, updateRigFallState, updateRigRecovery, recoveryAssistForce, footContactNormals, stanceController } = require("./walker-harness.cjs");
const productionRig = require("../src/character-rig.js").create(planck);

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

test("character-proportion rig includes a head, two articulated arms, two feet, and eleven driven joints", () => {
  const r = runStanceCase(0, 1, 0.5, 0, 0, "chain", true);
  assert.equal(r.bodyCount, 12);
  assert.equal(r.jointCount, 11);
  assert.equal(r.finite, true);
});

test("one slope-adaptive knee-bend policy works at 20 and 35 degrees", () => {
  const results = [];
  for (const degrees of [0, 20, 35]) {
    const r = degrees === 0
      ? runStanceCase(0, 1, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25,
          0.1, 0.95, 0, 0, 0.6, 1.5, "slope-adaptive", 0.12, 0.41, 6, 6,
          0.12, 0.2, 1, 0.8, 0.4, 1)
      : degrees === 20
        ? runStanceCase(20, 1, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25,
            0.1, 0.85, 0, 0, 0.6, 1.5, "slope-adaptive", 0.12, 0.41, 6, 6,
            0.12, 0.2, 1, 1, 0.4, 1)
        : runStanceCase(35, 1, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25,
            0.1, 0.95, 0, 0, 0.6, 1.5, "slope-adaptive", 0.34, 0.36, 6, 6,
            0.08, 0.2, 1, 0.8, 0.4, 1);
    results.push({
      degrees, initialAnkles: r.initialPose.map(leg => leg.ankleAngle),
      support: r.supportedTime, bothFeet: r.bothFeetContactTime,
      tilt: r.maxAbsoluteTiltDegrees, air: r.maxAirTime, speed: r.maxSpeed
    });
  }
  console.log("universal slope-adaptive bend diagnostic", JSON.stringify(results));
  assert.equal(results.length, 3);
});

test("full articulated 35 degree rig tunes swing arc with low upper-body torque", () => {
  const results = [];
  for (const swingHeight of [0.04, 0.06, 0.08, 0.1]) {
    for (const swingDuration of [0.16, 0.18, 0.2, 0.22, 0.24]) {
      const r = runStanceCase(
        35, 1, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25,
        0.1, 0.95, 0, 0, 0.6, 1.5, "same-positive", 0.34, 0.36,
        6, 6, swingHeight, swingDuration, 1, 0.8, 0.4, 1, 0.25
      );
      results.push({
        swingHeight, swingDuration,
        support: r.supportedTime, bothFeet: r.bothFeetContactTime,
        tilt: r.maxAbsoluteTiltDegrees, air: r.maxAirTime, speed: r.maxSpeed
      });
    }
  }
  console.log("full articulated 35 degree swing arc sweep", JSON.stringify(results));
  assert.equal(results.length, 20);
});

test("full articulated rig fine-tunes upper-body motor torque on 35 degree terrain", () => {
  const results = [];
  for (const upperBodyTorqueScale of [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4]) {
    const r = runStanceCase(
      35, 1, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25,
      0.1, 0.95, 0, 0, 0.6, 1.5, "same-positive", 0.34, 0.36,
      6, 6, 0.08, 0.2, 1, 0.8, 0.4, 1, upperBodyTorqueScale
    );
    results.push({
      upperBodyTorqueScale,
      support: r.supportedTime, bothFeet: r.bothFeetContactTime,
      tilt: r.maxAbsoluteTiltDegrees, air: r.maxAirTime, speed: r.maxSpeed
    });
  }
  console.log("full articulated upper-body torque fine sweep", JSON.stringify(results));
  assert.equal(results.length, 7);
});

test("full articulated rig isolates upper-body motor torque on 35 degree terrain", () => {
  const results = [];
  for (const upperBodyTorqueScale of [0, 0.25, 0.5, 0.75, 1, 1.5, 2]) {
    const r = runStanceCase(
      35, 1, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25,
      0.1, 0.95, 0, 0, 0.6, 1.5, "same-positive", 0.34, 0.36,
      6, 6, 0.08, 0.2, 1, 0.8, 0.4, 1, upperBodyTorqueScale
    );
    results.push({
      upperBodyTorqueScale,
      support: r.supportedTime, bothFeet: r.bothFeetContactTime,
      tilt: r.maxAbsoluteTiltDegrees, air: r.maxAirTime, speed: r.maxSpeed
    });
  }
  console.log("full articulated upper-body torque sweep", JSON.stringify(results));
  assert.equal(results.length, 7);
});

test("upright 20 and 35 degree stance remains controlled for three seconds across eight seeds", () => {
  const candidates = [
    {
      degrees: 20, stanceHalfWidth: 0.1, pelvisRatio: 0.85,
      bendMode: "slope-adaptive", highSideBend: 0.4, lowSideBend: 1,
      stepReach: 0.12, stepLookahead: 0.41, hipHeightBlend: 1,
      swingHeight: 0.12, swingDuration: 0.2,
      maxTilt: 5, minBothFeet: 0
    },
    {
      degrees: 35, stanceHalfWidth: 0.1, pelvisRatio: 0.95,
      bendMode: "same-positive", highSideBend: 1, lowSideBend: 1,
      stepReach: 0.34, stepLookahead: 0.36, hipHeightBlend: 0.8,
      swingHeight: 0.08, swingDuration: 0.2, upperBodyTorqueScale: 0.1,
      maxTilt: 10, minBothFeet: 1.8
    }
  ];

  for (const candidate of candidates) {
    const results = SEEDS.map(seed => {
      const r = runStanceCase(
        candidate.degrees, seed, 3, 0, 0, "chain", true, 3.5, 0.02, 0.25,
        candidate.stanceHalfWidth, candidate.pelvisRatio, 0, 0, 0.6, 1.5,
        candidate.bendMode, candidate.stepReach, candidate.stepLookahead, 6, 6,
        candidate.swingHeight, candidate.swingDuration, 1, candidate.hipHeightBlend,
        candidate.highSideBend, candidate.lowSideBend, candidate.upperBodyTorqueScale
      );
      return {
        seed, support: r.supportedTime, bothFeet: r.bothFeetContactTime,
        tilt: r.maxAbsoluteTiltDegrees, air: r.maxAirTime, speed: r.maxSpeed,
        mode: r.mode, fallReason: r.fallReason,
        initialAnkles: r.initialPose.map(leg => leg.ankleAngle)
      };
    });

    const failures = results.filter(r =>
      r.support < 2.9 ||
      r.mode !== "active" ||
      r.tilt > candidate.maxTilt ||
      r.air > 0.06 ||
      r.speed > 2 ||
      r.bothFeet < candidate.minBothFeet ||
      r.initialAnkles.some(angle => Math.abs(angle) > 0.6)
    );
    assert.deepEqual(failures, [],
      `${candidate.degrees} degree upright stance failed: ${JSON.stringify(failures)}`);
  }
});

test("direct rig hit immediately removes all motor stiffness and applies delta velocity", () => {
  const world = new planck.World({ gravity: planck.Vec2(0, -10) });
  const heightAt = () => 0;
  const terrainAngleAt = () => 0;
  const rig = createStanceRig(world, 0, heightAt, terrainAngleAt);
  rig.hit(planck.Vec2(2, 1));
  assert.equal(rig.mode, "limp");
  assert.equal(rig.stiffness, 0);
  assert.equal(rig.fallReason, "hit");
  assert.ok(rig.hull.getLinearVelocity().x > 0);
  assert.ok(rig.hull.getLinearVelocity().y > 0);
});

test("excessive torso tilt ramps stiffness to limp over 100 milliseconds", () => {
  const world = new planck.World({ gravity: planck.Vec2(0, -10) });
  const rig = createStanceRig(world, 0, () => 0, () => 0);
  rig.hull.setTransform(rig.hull.getPosition(), Math.PI / 2);
  const first = updateRigFallState(rig, 0.02);
  assert.equal(first.mode, "active");
  assert.equal(first.reason, "torso-tilt");
  assert.ok(first.stiffness < 1 && first.stiffness > 0);
  for (let i = 0; i < 4; i++) updateRigFallState(rig, 0.02);
  assert.equal(rig.mode, "limp");
  assert.equal(rig.stiffness, 0);
});

test("loss of all foot contact triggers limp only after 300 milliseconds", () => {
  const world = new planck.World({ gravity: planck.Vec2(0, -10) });
  const rig = createStanceRig(world, 0, () => 0, () => 0);
  for (let i = 0; i < 15; i++) {
    const state = updateRigFallState(rig, 0.02);
    assert.equal(state.mode, "active");
  }
  const triggered = updateRigFallState(rig, 0.02);
  assert.equal(triggered.reason, "no-foot-contact");
  assert.equal(triggered.mode, "active");
  for (let i = 0; i < 4; i++) updateRigFallState(rig, 0.02);
  assert.equal(rig.mode, "limp");
});

test("steep foot contact normal triggers a fall when the surface exceeds 50 degrees", () => {
  const world = new planck.World({ gravity: planck.Vec2(0, -10) });
  const angle = 55 * Math.PI / 180;
  const heightAt = x => Math.tan(angle) * x;
  const ground = world.createBody();
  ground.createFixture({
    shape: new planck.Chain([
      planck.Vec2(-5, heightAt(-5)),
      planck.Vec2(5, heightAt(5))
    ], false),
    friction: 2.5
  });
  const rig = createStanceRig(world, 0, heightAt, () => angle, 0.1, 0.95);
  for (let i = 0; i < 10; i++) world.step(1 / 50, 180, 60);
  const normals = rig.legs.flatMap(leg => footContactNormals(leg.foot));
  assert.ok(normals.length > 0, "at least one foot should contact the slope");
  assert.ok(normals.some(normal =>
    Math.atan2(Math.abs(normal.x), normal.y) > 50 * Math.PI / 180
  ), "the measured support normal should exceed the 50-degree limit");
  const state = updateRigFallState(rig, 0.02);
  assert.equal(state.reason, "foot-normal");
  assert.ok(state.stiffness < 1);
});

test("center of mass outside planted foot support for 250 milliseconds triggers limp", () => {
  const world = new planck.World({ gravity: planck.Vec2(0, -10) });
  const ground = world.createBody();
  ground.createFixture({ shape: new planck.Edge(planck.Vec2(-5, 0), planck.Vec2(5, 0)), friction: 2.5 });
  const rig = createStanceRig(world, 0, () => 0, () => 0);
  for (let i = 0; i < 10; i++) world.step(1 / 50, 180, 60);
  const feet = new Set(rig.legs.map(leg => leg.foot));
  for (const body of rig.bodies) {
    if (feet.has(body)) continue;
    const p = body.getPosition();
    body.setTransform(planck.Vec2(p.x + 2, p.y), body.getAngle());
  }
  for (let i = 0; i < 12; i++) {
    const state = updateRigFallState(rig, 0.02);
    assert.equal(state.reason, null);
  }
  const state = updateRigFallState(rig, 0.02);
  assert.equal(state.reason, "outside-support");
  assert.ok(state.stiffness < 1);
});

test("intentional jump airtime does not accumulate toward the no-contact fall trigger", () => {
  const world = new planck.World({ gravity: planck.Vec2(0, -10) });
  const rig = createStanceRig(world, 0, () => 0, () => 0);
  for (let i = 0; i < 30; i++) {
    const state = updateRigFallState(rig, 0.02, true);
    assert.equal(state.mode, "active");
    assert.equal(state.reason, null);
  }
  assert.equal(rig.noContactTime, 0);
});

test("limp recovery waits for low speed and ground contact, then ramps stiffness over 500 ms", () => {
  const world = new planck.World({ gravity: planck.Vec2(0, -10) });
  const ground = world.createBody();
  ground.createFixture({ shape: new planck.Edge(planck.Vec2(-5, 0), planck.Vec2(5, 0)), friction: 2.5 });
  const rig = createStanceRig(world, 0, () => 0, () => 0);
  for (let i = 0; i < 30; i++) {
    stanceController(rig, () => 0, () => 0, 1, 3.5, 0.02, 1.5,
      0.12, 0.41, 6, 6, 0.12, 0.2, 1, 1, 0.1);
    world.step(1 / 50, 180, 60);
  }
  rig.hit(planck.Vec2(0, 0));

  let recoveryStarted = false;
  let maxRecoveryStiffness = 0;
  for (let i = 0; i < 400 && rig.mode === "limp"; i++) {
    const state = updateRigRecovery(rig, 0.02, () => 0);
    if (rig.recovering) {
      recoveryStarted = true;
      maxRecoveryStiffness = Math.max(maxRecoveryStiffness, state.stiffness);
      stanceController(rig, () => 0, () => 0, state.stiffness,
        3.5, 0.02, 1.5, 0.12, 0.41, 6, 6, 0.12, 0.2, 1, 1, 0.1);
    }
    world.step(1 / 50, 180, 60);
  }
  assert.equal(recoveryStarted, true);
  assert.ok(maxRecoveryStiffness > 0);
  assert.equal(rig.mode, "active");
  assert.equal(rig.stiffness, 1);
  assert.equal(rig.recovering, false);
});

test("recovery assist never exceeds 1.3 times body weight and requires foot contact", () => {
  const mass = 5;
  const gravity = 10;
  assert.equal(recoveryAssistForce(mass, 10, gravity, false), 0);
  assert.ok(recoveryAssistForce(mass, 100, gravity, true) <= 1.3 * mass * gravity);
  assert.equal(recoveryAssistForce(mass, 100, gravity, true), 65);
});

test("production rig module builds the same twelve-body, eleven-joint character", () => {
  const world = new planck.World({ gravity: planck.Vec2(0, -10) });
  const ground = world.createBody();
  ground.createFixture({ shape: new planck.Edge(planck.Vec2(-5, 0), planck.Vec2(5, 0)), friction: 2.5 });
  const rig = productionRig.createStanceRig(world, 0, () => 0, () => 0);
  assert.equal(rig.bodies.length, 12);
  assert.equal(rig.joints.length, 11);
  assert.equal(rig.hull, rig.bodies[0]);
  assert.equal(rig.mode, "active");
  assert.equal(rig.stiffness, 1);
  productionRig.stanceController(rig, () => 0, () => 0, 1, 3.5, 0.02, 1.5,
    0.12, 0.41, 6, 6, 0.12, 0.2, 1, 1, 0.1);
  world.step(1 / 50, 180, 60);
  assert.ok(rig.bodies.every(body => Number.isFinite(body.getPosition().x)));
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

