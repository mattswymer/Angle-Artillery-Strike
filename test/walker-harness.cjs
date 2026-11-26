"use strict";

// A deliberately small port of the Gymnasium/Box2D BipedalWalker control
// pattern. This is a four-joint walker, not the previous 12-body IK rig.
// The lower legs are the ground-contact feet, as in the reference walker.

const planck = require("planck");
const Vec2 = planck.Vec2;
const FIXED_DT = 1 / 50;
const GRAVITY = 10;
const LEG_W = 8 / 30;
const LEG_H = 34 / 30;
const LEG_DOWN = -8 / 30;
const HIP_SPEED = 4;
const KNEE_SPEED = 6;
const MAX_TORQUE = 80;
const FPS = 50;
const VERTICAL_VELOCITY_SCALE = 0.3 * (400 / 30) / FPS;
const HULL_VERTICES = [Vec2(-1, 0.3), Vec2(0.2, 0.3), Vec2(34 / 30, 1 / 30), Vec2(34 / 30, -8 / 30), Vec2(-1, -8 / 30)];
const SUPPORT_KNEE_ANGLE = 0.1;
const WALK_SPEED = 0.29;

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTerrainFunctions(degrees, roughness, phaseA, phaseB) {
  const slope = -degrees * Math.PI / 180;
  const heightAt = x => Math.tan(slope) * x +
    roughness * (0.7 * Math.sin(0.65 * x + phaseA) + 0.3 * Math.sin(1.7 * x + phaseB));
  const terrainAngleAt = x => Math.atan2(heightAt(x + 0.01) - heightAt(x - 0.01), 0.02);
  return { slope, heightAt, terrainAngleAt };
}

function simplifyTerrainPoints(points, tolerance = 1e-9) {
  if (points.length < 3) return points;
  const result = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const previous = result[result.length - 1];
    const current = points[i];
    const next = points[i + 1];
    const ax = current.x - previous.x;
    const ay = current.y - previous.y;
    const bx = next.x - current.x;
    const by = next.y - current.y;
    const cross = ax * by - ay * bx;
    const dot = ax * bx + ay * by;
    if (Math.abs(cross) > tolerance || dot <= 0) result.push(current);
  }
  result.push(points[points.length - 1]);
  return result;
}

function makeWorld(degrees, roughness = 0, phaseA = 0, phaseB = 0, chainStep = 0.25) {
  const world = new planck.World({ gravity: Vec2(0, -GRAVITY) });
  world.setAllowSleeping(false);
  const terrain = makeTerrainFunctions(degrees, roughness, phaseA, phaseB);
  const ground = world.createBody();
  const points = [];
  for (let x = -30; x <= 30.0001; x += chainStep) {
    points.push(Vec2(x, terrain.heightAt(x)));
  }
  // Match TerrainSystem.simplifyLoop: merge collinear grid samples before
  // building a chain so flat/slope runs are one child edge, not dozens of
  // overlapping foot contacts at artificial sample boundaries.
  ground.createFixture({
    shape: new planck.Chain(simplifyTerrainPoints(points), false),
    friction: 2.5,
    restitution: 0
  });
  return { world, ...terrain };
}

function makeSegmentedWorld(degrees, roughness = 0, phaseA = 0, phaseB = 0) {
  const world = new planck.World({ gravity: Vec2(0, -GRAVITY) });
  world.setAllowSleeping(false);
  const terrain = makeTerrainFunctions(degrees, roughness, phaseA, phaseB);
  const ground = world.createBody();
  for (let x = -30; x < 30; x += 0.25) {
    ground.createFixture({
      shape: new planck.Edge(Vec2(x, terrain.heightAt(x)), Vec2(x + 0.25, terrain.heightAt(x + 0.25))),
      friction: 2.5,
      restitution: 0
    });
  }
  return { world, ...terrain };
}

function makeContinuousWorld(degrees = 0) {
  const world = new planck.World({ gravity: Vec2(0, -GRAVITY) });
  world.setAllowSleeping(false);
  const slope = -degrees * Math.PI / 180;
  const heightAt = x => Math.tan(slope) * x;
  const ground = world.createBody();
  ground.createFixture({
    shape: new planck.Edge(Vec2(-30, heightAt(-30)), Vec2(30, heightAt(30))),
    friction: 2.5,
    restitution: 0
  });
  const terrainAngleAt = () => Math.atan(Math.tan(slope));
  return { world, slope, heightAt, terrainAngleAt };
}

function createWalker(world, slope, startX, random = () => 0.5, heightAt = x => Math.tan(slope) * x, terrainAngleAt = () => -slope, options = {}) {
  const surfaceY = heightAt(startX);
  const initY = surfaceY + 2 * LEG_H - (options.alignToTerrain ? LEG_DOWN : 0);
  const initialAngle = options.alignToTerrain ? terrainAngleAt(startX) : 0;
  const hull = world.createDynamicBody({
    position: Vec2(startX, initY),
    angle: initialAngle,
    linearDamping: 0.05,
    angularDamping: 0.05,
    allowSleep: false,
    userData: { part: "torso" }
  });
  hull.createFixture({
    shape: new planck.Polygon(HULL_VERTICES),
    density: 5,
    friction: 0.1,
    restitution: 0,
    filterGroupIndex: -1
  });

  const legs = [];
  const joints = [];
  for (const side of [-1, 1]) {
    const hipOffset = options.separatedHips ? side * 0.16 : 0;
    const stanceTargetX = startX + side * 0.12;
    const stanceTarget = Vec2(stanceTargetX, heightAt(stanceTargetX) + 0.06);
    const hipWorld = hull.getWorldPoint(Vec2(hipOffset, LEG_DOWN));
    const initialIK = options.alignToTerrain
      ? legIK(hipWorld, stanceTarget, LEG_H, LEG_H, 1)
      : null;
    const upperAngle = options.alignToTerrain
      ? initialIK.thighDir + Math.PI / 2
      : initialAngle + side * 0.05 + (random() - 0.5) * 0.08;
    const upperOffset = rotateLocal(Vec2(0, LEG_H / 2), upperAngle);
    const upperPosition = options.alignToTerrain
      ? Vec2(hipWorld.x - upperOffset.x, hipWorld.y - upperOffset.y)
      : Vec2(startX, initY - LEG_H / 2 - LEG_DOWN);
    const upper = world.createDynamicBody({
      position: upperPosition,
      angle: upperAngle,
      linearDamping: 0.05,
      angularDamping: 0.05,
      allowSleep: false,
      userData: { part: side < 0 ? "left-upper-leg" : "right-upper-leg" }
    });
    upper.createFixture({
      shape: new planck.Box(LEG_W / 2, LEG_H / 2),
      density: 1,
      friction: 0.2,
      restitution: 0,
      filterGroupIndex: -1
    });

    const hip = world.createJoint(planck.RevoluteJoint({
      localAnchorA: Vec2(hipOffset, LEG_DOWN),
      localAnchorB: Vec2(0, LEG_H / 2),
      enableMotor: true,
      enableLimit: true,
      lowerAngle: -0.8,
      upperAngle: 1.1,
      maxMotorTorque: MAX_TORQUE,
      motorSpeed: side,
      referenceAngle: 0,
      collideConnected: false
    }, hull, upper));

    const kneeWorld = upper.getWorldPoint(Vec2(0, -LEG_H / 2));
    const lowerAngle = options.alignToTerrain
      ? upperAngle - initialIK.kneeRel
      : initialAngle + side * 0.05;
    const lowerOffset = rotateLocal(Vec2(0, LEG_H / 2), lowerAngle);
    const lowerPosition = options.alignToTerrain
      ? Vec2(kneeWorld.x - lowerOffset.x, kneeWorld.y - lowerOffset.y)
      : Vec2(startX, initY - LEG_H * 1.5 - LEG_DOWN);
    const lower = world.createDynamicBody({
      position: lowerPosition,
      angle: lowerAngle,
      linearDamping: 0.05,
      angularDamping: 0.05,
      allowSleep: false,
      userData: { part: side < 0 ? "left-foot" : "right-foot" }
    });
    lower.createFixture({
      shape: new planck.Box(LEG_W * 0.4, LEG_H / 2),
      density: 1,
      friction: 0.2,
      restitution: 0,
      filterGroupIndex: -1
    });

    const knee = world.createJoint(planck.RevoluteJoint({
      localAnchorA: Vec2(0, -LEG_H / 2),
      localAnchorB: Vec2(0, LEG_H / 2),
      enableMotor: true,
      enableLimit: true,
      lowerAngle: -1.6,
      upperAngle: -0.1,
      maxMotorTorque: MAX_TORQUE,
      motorSpeed: 1,
      referenceAngle: 0,
      collideConnected: false
    }, upper, lower));

    // A separate short, high-friction foot gives the rig a real ankle and
    // a contact surface that can conform to terrain instead of using the shin.
    const FOOT_HALF_HEIGHT = 0.03;
    const footAngle = terrainAngleAt(options.alignToTerrain ? stanceTargetX : startX);
    const ankleAnchor = lower.getWorldPoint(Vec2(0, -LEG_H / 2));
    const foot = world.createDynamicBody({
      position: Vec2(
        ankleAnchor.x + Math.sin(footAngle) * FOOT_HALF_HEIGHT,
        ankleAnchor.y - Math.cos(footAngle) * FOOT_HALF_HEIGHT
      ),
      angle: footAngle,
      linearDamping: 0.05,
      angularDamping: 0.05,
      allowSleep: false,
      userData: { part: side < 0 ? "left-foot" : "right-foot" }
    });
    foot.createFixture({
      shape: new planck.Box(0.09, FOOT_HALF_HEIGHT),
      density: 1,
      friction: 0.9,
      restitution: 0,
      filterGroupIndex: -1
    });
    const ankleReferenceAngle = 0;
    const ankle = world.createJoint(planck.RevoluteJoint({
      localAnchorA: Vec2(0, -LEG_H / 2),
      localAnchorB: Vec2(0, FOOT_HALF_HEIGHT),
      enableMotor: true,
      enableLimit: true,
      lowerAngle: -0.6,
      upperAngle: 0.6,
      maxMotorTorque: 1.5,
      motorSpeed: 0,
      referenceAngle: ankleReferenceAngle,
      collideConnected: false
    }, lower, foot));

    legs.push({ side, upper, lower, foot, hip, knee, ankle, ankleReferenceAngle });
    joints.push(hip, knee, ankle);
  }

  return {
    hull, legs, joints,
    gait: {
      phase: "STAY_ON_ONE_LEG",
      movingLeg: 0,
      supportingLeg: 1,
      supportingKneeAngle: SUPPORT_KNEE_ANGLE,
      elapsed: 0
    },
    everFallen: false,
    stableTime: 0,
    airTime: 0,
    maxAirTime: 0,
    contactTime: 0,
    maxTilt: 0,
    maxSpeed: 0,
    maxAnkleAngle: 0,
    trace: []
  };
}

function rotateLocal(point, angle) {
  return Vec2(
    point.x * Math.cos(angle) - point.y * Math.sin(angle),
    point.x * Math.sin(angle) + point.y * Math.cos(angle)
  );
}


const TORSO_HALF_WIDTH = 0.17;
const TORSO_HALF_HEIGHT = 0.29;
const HIP_X = 0.105;
const HIP_Y = -0.25;
const UPPER_LENGTH = 0.41;
const LOWER_LENGTH = 0.34;
const UPPER_HALF_WIDTH = 0.075;
const LOWER_HALF_WIDTH = 0.06;
const FOOT_HALF_LENGTH = 0.09;
const FOOT_HALF_HEIGHT = 0.03;

function createStanceRig(world, startX, heightAt, terrainAngleAt, stanceHalfWidth = 0.12, pelvisRatio = 0.95, terrainTiltBlend = 0, stanceCenterBlend = 0, ankleLimit = 0.6, bendMode = "side") {
  // Start the torso aligned with the local terrain frame; the feet independently
  // align to the surface normal through their ankle joints.
  const initialTerrainAngle = terrainAngleAt(startX) * terrainTiltBlend;
  const stanceCenterX = startX - HIP_Y * Math.sin(initialTerrainAngle) * stanceCenterBlend;
  const initialFootY = Math.min(
    heightAt(stanceCenterX - stanceHalfWidth) + FOOT_HALF_HEIGHT * 2,
    heightAt(stanceCenterX + stanceHalfWidth) + FOOT_HALF_HEIGHT * 2
  );
  const pelvisTargetY = initialFootY +
    pelvisRatio * (UPPER_LENGTH + LOWER_LENGTH);
  const hull = world.createDynamicBody({
    position: Vec2(startX, pelvisTargetY - HIP_Y * Math.cos(initialTerrainAngle)),
    angle: initialTerrainAngle,
    linearDamping: 0.08,
    angularDamping: 0.08,
    allowSleep: false,
    userData: { part: "torso" }
  });
  hull.createFixture({
    shape: new planck.Box(TORSO_HALF_WIDTH, TORSO_HALF_HEIGHT),
    density: 1.5,
    friction: 0.18,
    restitution: 0,
    filterGroupIndex: -1
  });

  const legs = [];
  for (const side of [-1, 1]) {
    const targetX = stanceCenterX + side * stanceHalfWidth;
    const ankleTarget = Vec2(targetX, heightAt(targetX) + FOOT_HALF_HEIGHT * 2);
    const actualHip = hull.getWorldPoint(Vec2(side * HIP_X, HIP_Y));
    const hipWorld = actualHip;
    const bend = bendMode === "same-positive" ? 1 : bendMode === "same-negative" ? -1 : side;
    const solution = legIK(hipWorld, ankleTarget, UPPER_LENGTH, LOWER_LENGTH, bend);

    const upperAngle = solution.thighDir + Math.PI / 2;
    const upperAnchorOffset = rotateLocal(Vec2(0, UPPER_LENGTH / 2), upperAngle);
    const upper = world.createDynamicBody({
      position: Vec2(hipWorld.x - upperAnchorOffset.x, hipWorld.y - upperAnchorOffset.y),
      angle: upperAngle,
      linearDamping: 0.08,
      angularDamping: 0.08,
      allowSleep: false,
      userData: { part: side < 0 ? "left-upper-leg" : "right-upper-leg" }
    });
    upper.createFixture({
      shape: new planck.Box(UPPER_HALF_WIDTH, UPPER_LENGTH / 2),
      density: 1.15,
      friction: 0.2,
      restitution: 0,
      filterGroupIndex: -1
    });

    const hip = world.createJoint(planck.RevoluteJoint({
      localAnchorA: Vec2(side * HIP_X, HIP_Y),
      localAnchorB: Vec2(0, UPPER_LENGTH / 2),
      enableMotor: true,
      enableLimit: true,
      lowerAngle: -1.25,
      upperAngle: 1.25,
      maxMotorTorque: 18,
      referenceAngle: 0,
      collideConnected: false
    }, hull, upper));

    const kneeWorld = upper.getWorldPoint(Vec2(0, -UPPER_LENGTH / 2));
    const lowerAngle = upperAngle - solution.kneeRel;
    const lowerAnchorOffset = rotateLocal(Vec2(0, LOWER_LENGTH / 2), lowerAngle);
    const lower = world.createDynamicBody({
      position: Vec2(kneeWorld.x - lowerAnchorOffset.x, kneeWorld.y - lowerAnchorOffset.y),
      angle: lowerAngle,
      linearDamping: 0.08,
      angularDamping: 0.08,
      allowSleep: false,
      userData: { part: side < 0 ? "left-lower-leg" : "right-lower-leg" }
    });
    lower.createFixture({
      shape: new planck.Box(LOWER_HALF_WIDTH, LOWER_LENGTH / 2),
      density: 1.1,
      friction: 0.2,
      restitution: 0,
      filterGroupIndex: -1
    });

    const knee = world.createJoint(planck.RevoluteJoint({
      localAnchorA: Vec2(0, -UPPER_LENGTH / 2),
      localAnchorB: Vec2(0, LOWER_LENGTH / 2),
      enableMotor: true,
      enableLimit: true,
      lowerAngle: bend < 0 ? -0.25 : -2.2,
      upperAngle: bend < 0 ? 2.2 : 0.25,
      maxMotorTorque: 18,
      referenceAngle: 0,
      collideConnected: false
    }, upper, lower));

    const footAngle = terrainAngleAt(targetX);
    const ankleAnchor = lower.getWorldPoint(Vec2(0, -LOWER_LENGTH / 2));
    const footAnchorOffset = rotateLocal(Vec2(0, FOOT_HALF_HEIGHT), footAngle);
    const foot = world.createDynamicBody({
      position: Vec2(ankleAnchor.x - footAnchorOffset.x, ankleAnchor.y - footAnchorOffset.y),
      angle: footAngle,
      linearDamping: 0.08,
      angularDamping: 0.08,
      allowSleep: false,
      userData: { part: side < 0 ? "left-foot" : "right-foot" }
    });
    foot.createFixture({
      shape: new planck.Box(FOOT_HALF_LENGTH, FOOT_HALF_HEIGHT),
      density: 0.65,
      friction: 0.9,
      restitution: 0,
      filterGroupIndex: -1
    });

    const ankle = world.createJoint(planck.RevoluteJoint({
      localAnchorA: Vec2(0, -LOWER_LENGTH / 2),
      localAnchorB: Vec2(0, FOOT_HALF_HEIGHT),
      enableMotor: true,
      enableLimit: true,
      lowerAngle: -ankleLimit,
      upperAngle: ankleLimit,
      maxMotorTorque: 4,
      referenceAngle: 0,
      collideConnected: false
    }, lower, foot));

    legs.push({
      side, bend, upper, lower, foot, hip, knee, ankle,
      upperLength: UPPER_LENGTH, lowerLength: LOWER_LENGTH,
      targetX
    });
  }

  return {
    hull,
    legs,
    stanceTargets: [stanceCenterX - stanceHalfWidth, stanceCenterX + stanceHalfWidth],
    stanceHalfWidth,
    pelvisRatio,
    terrainTiltBlend,
    stanceCenterBlend
  };
}

function isGroundContact(body) {
  for (let edge = body.getContactList(); edge; edge = edge.next) {
    if (edge.contact.isTouching()) {
      const a = edge.contact.getFixtureA().getBody();
      const b = edge.contact.getFixtureB().getBody();
      if ((a === body && b.isStatic()) || (b === body && a.isStatic())) return true;
    }
  }
  return false;
}

function jointPD(joint, target, kp, speedScale) {
  // Preserve the reference controller's normalized joint-speed feedback.
  return kp * (target - joint.getJointAngle()) - 0.25 * (joint.getJointSpeed() / speedScale);
}

function legIK(hip, foot, upperLength, lowerLength, bend = 1) {
  const dx = foot.x - hip.x;
  const dy = foot.y - hip.y;
  const rawDistance = Math.hypot(dx, dy);
  const minDistance = Math.abs(upperLength - lowerLength) + 1e-6;
  const maxDistance = (upperLength + lowerLength) * 0.999;
  const distance = Math.max(minDistance, Math.min(rawDistance, maxDistance));
  const direction = Math.atan2(dy, dx);
  const hipCos = Math.max(-1, Math.min(1,
    (upperLength * upperLength + distance * distance - lowerLength * lowerLength) /
    (2 * upperLength * distance)
  ));
  const kneeCos = Math.max(-1, Math.min(1,
    (upperLength * upperLength + lowerLength * lowerLength - distance * distance) /
    (2 * upperLength * lowerLength)
  ));
  const hipOffset = Math.acos(hipCos);
  const kneeInterior = Math.acos(kneeCos);
  return {
    thighDir: direction + bend * hipOffset,
    kneeRel: bend * (Math.PI - kneeInterior),
    distance: rawDistance
  };
}

function wrapAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function driveJoint(joint, target, kp, wMax, tauMax, stiffness) {
  const error = wrapAngle(target - joint.getJointAngle());
  joint.setMotorSpeed(Math.max(-wMax, Math.min(wMax, kp * error)));
  joint.setMaxMotorTorque(tauMax * stiffness);
}

function applyMotor(joint, action, speed, kp) {
  const amount = Math.max(-1, Math.min(1, action));
  // Convert the reference controller's normalized motor command into a
  // bounded target-angle error. All six joints now pass through driveJoint;
  // preserving this mapping keeps the proven hip/knee gait behavior intact.
  const target = joint.getJointAngle() + Math.sign(amount) * (speed / 2);
  driveJoint(joint, target, 2, speed, MAX_TORQUE, Math.abs(amount));
}

function walkerController(walker, terrainAngleAt = () => 0) {
  const { hull, legs, gait } = walker;
  const moving = legs[gait.movingLeg];
  const supporting = legs[gait.supportingLeg];
  const movingContact = isGroundContact(moving.foot);
  const supportingContact = isGroundContact(supporting.foot);
  const hullAngle = hull.getAngle();
  const hullAngularVelocity = hull.getAngularVelocity();
  const hullVelocity = hull.getLinearVelocity();

  const hipTargets = [null, null];
  const kneeTargets = [null, null];

  if (gait.phase === "STAY_ON_ONE_LEG") {
    hipTargets[gait.movingLeg] = 1.1;
    kneeTargets[gait.movingLeg] = -0.6;
    gait.supportingKneeAngle = Math.min(
      SUPPORT_KNEE_ANGLE,
      gait.supportingKneeAngle + 0.03 + (0.12 * hullVelocity.x > WALK_SPEED ? 0.03 : 0)
    );
    kneeTargets[gait.supportingLeg] = gait.supportingKneeAngle;
    if (supporting.hip.getJointAngle() < 0.1) gait.phase = "PUT_OTHER_DOWN";
  }

  if (gait.phase === "PUT_OTHER_DOWN") {
    hipTargets[gait.movingLeg] = 0.1;
    kneeTargets[gait.movingLeg] = SUPPORT_KNEE_ANGLE;
    kneeTargets[gait.supportingLeg] = gait.supportingKneeAngle;
    if (movingContact) {
      gait.phase = "PUSH_OFF";
      gait.supportingKneeAngle = Math.min(
        moving.knee.getJointAngle() + 1,
        SUPPORT_KNEE_ANGLE
      );
    }
  }

  if (gait.phase === "PUSH_OFF") {
    kneeTargets[gait.movingLeg] = gait.supportingKneeAngle;
    kneeTargets[gait.supportingLeg] = 1.0;
    if (supporting.knee.getJointAngle() + 1 > 0.88 || 0.12 * hullVelocity.x > WALK_SPEED * 1.2) {
      gait.phase = "STAY_ON_ONE_LEG";
      gait.movingLeg = 1 - gait.movingLeg;
      gait.supportingLeg = 1 - gait.movingLeg;
    }
  }

  const actions = [0, 0, 0, 0];
  for (let i = 0; i < 2; i++) {
    const leg = legs[i];
    if (hipTargets[i] !== null) {
      actions[i * 2] = jointPD(leg.hip, hipTargets[i], 0.9, HIP_SPEED);
    }
    if (kneeTargets[i] !== null) {
      actions[i * 2 + 1] = jointPD(leg.knee, kneeTargets[i] - 1, 4, KNEE_SPEED);
    }
    // Both hips share torso upright feedback. Both knees damp vertical bounce.
    actions[i * 2] -= 0.9 * (0 - hullAngle) - 1.5 * (2 * hullAngularVelocity / FPS);
    actions[i * 2 + 1] -= 15 * (VERTICAL_VELOCITY_SCALE * hullVelocity.y);
  }

  // Match the reference controller's conservative output scaling.
  for (let i = 0; i < 2; i++) {
    applyMotor(legs[i].hip, actions[i * 2] * 0.5, HIP_SPEED, 1);
    applyMotor(legs[i].knee, actions[i * 2 + 1] * 0.5, KNEE_SPEED, 1);
    const targetFootAngle = terrainAngleAt(legs[i].foot.getPosition().x);
    const targetAnkleAngle = targetFootAngle - legs[i].lower.getAngle();
    driveJoint(legs[i].ankle, targetAnkleAngle, 12, 4, 1.5, 1);
  }

  gait.elapsed += FIXED_DT;
  return { movingContact, supportingContact, actions };
}


function getRigCenterOfMassX(walker) {
  const bodies = [walker.hull];
  for (const leg of walker.legs) bodies.push(leg.upper, leg.lower, leg.foot);
  let weightedX = 0;
  let totalMass = 0;
  for (const body of bodies) {
    const mass = body.getMass();
    weightedX += body.getWorldCenter().x * mass;
    totalMass += mass;
  }
  return totalMass > 0 ? weightedX / totalMass : walker.hull.getPosition().x;
}

function stanceController(walker, heightAt, terrainAngleAt, stiffness = 1, balanceKp = 1.5, balanceKd = 0.06, ankleTorqueMax = 1.5, stepReach = 0.18, stepLookahead = 0.25) {
  const { hull, legs } = walker;
  const centerX = getRigCenterOfMassX(walker);
  const predictedCenterX = centerX + hull.getLinearVelocity().x * stepLookahead;
  const halfStance = walker.stanceHalfWidth ?? 0.12;
  if (!walker.stanceTargets) {
    walker.stanceTargets = [centerX - halfStance, centerX + halfStance];
  }
  // Support is determined by feet that are actually touching terrain,
  // not by planned foot locations. A swing target is assigned once and held
  // until that foot lands, so it cannot chase the torso every physics step.
  const contacts = legs.map(leg => isGroundContact(leg.foot));
  if (walker.swingIndex !== undefined && walker.swingIndex !== null) {
    walker.swingTime = (walker.swingTime || 0) + FIXED_DT;
    if (!contacts[walker.swingIndex]) walker.swingAirborne = true;
    if (walker.swingAirborne && contacts[walker.swingIndex] && walker.swingTime > 0.1) {
      walker.swingIndex = null;
      walker.swingTime = 0;
      walker.swingAirborne = false;
    }
  }
  if (walker.swingIndex === undefined || walker.swingIndex === null) {
    const planted = legs
      .map((leg, i) => contacts[i] ? leg.foot : null)
      .filter(foot => foot !== null);
    if (planted.length) {
      const bounds = planted.map(foot => {
        const angle = foot.getAngle();
        const halfSpan = Math.abs(Math.cos(angle)) * FOOT_HALF_LENGTH +
          Math.abs(Math.sin(angle)) * FOOT_HALF_HEIGHT;
        return {
          min: foot.getPosition().x - halfSpan,
          max: foot.getPosition().x + halfSpan
        };
      });
      const minFootX = Math.min(...bounds.map(bound => bound.min));
      const maxFootX = Math.max(...bounds.map(bound => bound.max));
      if (predictedCenterX < minFootX - 0.04) {
        walker.swingIndex = 0;
        walker.swingTime = 0;
        walker.swingAirborne = false;
        const hipMidX = hull.getPosition().x - HIP_Y * Math.sin(hull.getAngle());
        const stanceCenterX = centerX + (hipMidX - centerX) * (walker.stanceCenterBlend ?? 0);
        walker.stanceTargets[0] = predictedCenterX - stepReach;
      } else if (predictedCenterX > maxFootX + 0.04) {
        walker.swingIndex = 1;
        walker.swingTime = 0;
        walker.swingAirborne = false;
        const hipMidX = hull.getPosition().x - HIP_Y * Math.sin(hull.getAngle());
        const stanceCenterX = centerX + (hipMidX - centerX) * (walker.stanceCenterBlend ?? 0);
        walker.stanceTargets[1] = predictedCenterX + stepReach;
      }
    }
  }
  const footTargets = walker.stanceTargets.map((x, i) => {
    const swing = walker.swingIndex === i;
    const progress = swing ? Math.min(1, (walker.swingTime || 0) / 0.2) : 0;
    const lift = swing ? Math.sin(progress * Math.PI) * 0.12 : 0;
    return { x, y: heightAt(x) + FOOT_HALF_HEIGHT * 2 + lift };
  });
  const terrainReferenceAngle = terrainAngleAt(hull.getPosition().x) * (walker.terrainTiltBlend ?? 0);
  const pelvisTargetY = Math.min(
    heightAt(walker.stanceTargets[0]) + FOOT_HALF_HEIGHT * 2,
    heightAt(walker.stanceTargets[1]) + FOOT_HALF_HEIGHT * 2
  ) + (walker.pelvisRatio ?? 0.95) * (UPPER_LENGTH + LOWER_LENGTH);
  const hipTargets = [];
  const kneeTargets = [];
  const ankleTargets = [];
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const target = footTargets[i];
    const surfaceY = heightAt(target.x);
    const terrainAngle = terrainAngleAt(target.x);
    // Keep the swing lift calculated above. The IK target is the ankle joint
    // anchor (the top of the foot), so its planted height is surface + 2h.
    const actualHip = hull.getWorldPoint(Vec2(leg.side * HIP_X, HIP_Y));
    // Keep the IK target tied to the stance pelvis-height reference.
    const hipWorld = Vec2(
      actualHip.x,
      pelvisTargetY + leg.side * HIP_X * Math.sin(hull.getAngle())
    );
    const ankleTarget = Vec2(target.x, target.y);
    const solution = legIK(hipWorld, ankleTarget, leg.upperLength, leg.lowerLength, leg.bend);

    // Box long axes point down at body angle zero. Convert the IK's
    // mathematical +X segment direction into Planck body/joint angles.
    const upperBodyAngle = solution.thighDir + Math.PI / 2;
    const lowerBodyAngle = solution.thighDir - solution.kneeRel + Math.PI / 2;
    // Joint-only torso stabilization: positive torso angle/velocity biases
    // both hip targets so their motor reaction applies counter-torque to hull.
    const torsoTilt = wrapAngle(hull.getAngle() - terrainReferenceAngle);
    const hipTarget = wrapAngle(
      upperBodyAngle - hull.getAngle() +
      balanceKp * torsoTilt +
      balanceKd * hull.getAngularVelocity()
    );
    const kneeTarget = wrapAngle(lowerBodyAngle - upperBodyAngle);
    hipTargets.push(hipTarget);
    kneeTargets.push(kneeTarget);
    driveJoint(leg.hip, hipTarget, 13, 4, 4, stiffness);
    driveJoint(leg.knee, kneeTarget, 15, 5, 4, stiffness);

    const desiredFootAngle = terrainAngle;
    const ankleTargetAngle = wrapAngle(desiredFootAngle - leg.lower.getAngle());
    ankleTargets.push(ankleTargetAngle);
    driveJoint(leg.ankle, ankleTargetAngle, 12, 3, ankleTorqueMax, stiffness);
  }

  return {
    targets: footTargets,
    contacts: legs.map(leg => isGroundContact(leg.foot)),
    hipTargets,
    kneeTargets,
    ankleTargets,
    hipAngles: legs.map(leg => leg.hip.getJointAngle())
  };
}


function postureController(walker, terrainAngleAt, stiffness = 1) {
  const terrainAngle = terrainAngleAt(walker.hull.getPosition().x);
  for (const leg of walker.legs) {
    // Keep the upper segments aligned to the local ground normal and use a
    // modest knee flexion to avoid a locked, straight-legged singularity.
    const hipTarget = wrapAngle(terrainAngle - walker.hull.getAngle());
    driveJoint(leg.hip, hipTarget, 8, 4, 18, stiffness);
    driveJoint(leg.knee, -0.42, 8, 4, 18, stiffness);
    const ankleTarget = wrapAngle(terrainAngle - leg.lower.getAngle());
    driveJoint(leg.ankle, ankleTarget, 10, 4, 4, stiffness);
  }
}

function runPostureCase(degrees, seed = 12345, duration = 3, roughness = 0) {
  const random = seededRandom(seed);
  const phaseA = random() * Math.PI * 2;
  const phaseB = random() * Math.PI * 2;
  const { world, slope, heightAt, terrainAngleAt } = makeWorld(degrees, roughness, phaseA, phaseB);
  const startX = (random() - 0.5) * 0.2;
  const walker = createStanceRig(world, startX, heightAt, terrainAngleAt);
  const steps = Math.ceil(duration / FIXED_DT);
  let supportedTime = 0;
  let maxRelativeTilt = 0;
  let maxAbsoluteTilt = 0;
  let maxSpeed = 0;
  let maxAirTime = 0;
  let airTime = 0;
  for (let i = 0; i < steps; i++) {
    postureController(walker, terrainAngleAt);
    world.step(FIXED_DT, 180, 60);
    const contacts = walker.legs.map(leg => isGroundContact(leg.foot));
    if (contacts.some(Boolean)) {
      supportedTime += FIXED_DT;
      airTime = 0;
    } else {
      airTime += FIXED_DT;
      maxAirTime = Math.max(maxAirTime, airTime);
    }
    maxRelativeTilt = Math.max(maxRelativeTilt, Math.abs(wrapAngle(walker.hull.getAngle() - slope)));
    maxAbsoluteTilt = Math.max(maxAbsoluteTilt, Math.abs(wrapAngle(walker.hull.getAngle())));
    maxSpeed = Math.max(maxSpeed, walker.hull.getLinearVelocity().length());
  }
  return {
    degrees,
    supportedTime: Number(supportedTime.toFixed(3)),
    maxRelativeTiltDegrees: Number((maxRelativeTilt * 180 / Math.PI).toFixed(2)),
    maxAbsoluteTiltDegrees: Number((maxAbsoluteTilt * 180 / Math.PI).toFixed(2)),
    maxSpeed: Number(maxSpeed.toFixed(3)),
    maxAirTime: Number(maxAirTime.toFixed(3)),
    finalPosition: {
      x: Number(walker.hull.getPosition().x.toFixed(4)),
      y: Number(walker.hull.getPosition().y.toFixed(4))
    }
  };
}

function runSwingTargetCase() {
  const { world, heightAt, terrainAngleAt } = makeWorld(0, 0, 0, 0);
  const walker = createStanceRig(world, 0, heightAt, terrainAngleAt);
  walker.swingIndex = 0;
  walker.swingTime = 0.05;
  walker.swingAirborne = false;
  const result = stanceController(walker, heightAt, terrainAngleAt);
  return {
    targetY: result.targets[0].y,
    plantedY: heightAt(result.targets[0].x) + FOOT_HALF_HEIGHT * 2,
    swingIndex: walker.swingIndex
  };
}

function runRigSymmetryCase(continuousGround = false, runController = true) {
  let world, heightAt, terrainAngleAt;
  if (continuousGround === true || continuousGround === "none") {
    world = new planck.World({ gravity: Vec2(0, -GRAVITY) });
    world.setAllowSleeping(false);
    if (continuousGround === true) {
      const ground = world.createBody();
      ground.createFixture({
        shape: new planck.Edge(Vec2(-30, 0), Vec2(30, 0)),
        friction: 2.5,
        restitution: 0
      });
    }
    heightAt = () => 0;
    terrainAngleAt = () => 0;
  } else {
    ({ world, heightAt, terrainAngleAt } = makeWorld(0, 0, 0, 0));
  }
  const walker = createStanceRig(world, 0, heightAt, terrainAngleAt);
  const measure = () => {
    const left = walker.legs[0];
    const right = walker.legs[1];
    const details = {};
    for (const key of ["upper", "lower", "foot"]) {
      const a = left[key];
      const b = right[key];
      const pa = walker.hull.getLocalPoint(a.getPosition());
      const pb = walker.hull.getLocalPoint(b.getPosition());
      details[key] = {
        x: Number((pa.x + pb.x).toFixed(8)),
        y: Number((pa.y - pb.y).toFixed(8)),
        angle: Number(wrapAngle(
          (a.getAngle() - walker.hull.getAngle()) +
          (b.getAngle() - walker.hull.getAngle())
        ).toFixed(8))
      };
    }
    for (const key of ["hip", "knee", "ankle"]) {
      details[key] = Number((left[key].getJointAngle() + right[key].getJointAngle()).toFixed(8));
    }
    const error = Math.max(...Object.values(details).flatMap(value =>
      typeof value === "number" ? [Math.abs(value)] : Object.values(value).map(Math.abs)
    ));
    return { error, details };
  };
  const initial = measure();
  if (runController) stanceController(walker, heightAt, terrainAngleAt);
  world.step(FIXED_DT, 180, 60);
  const afterStep = measure();
  return {
    initialError: initial.error,
    oneStepError: afterStep.error,
    initial: initial.details,
    afterStep: afterStep.details,
    contacts: walker.legs.map(leg => isGroundContact(leg.foot)),
    continuousGround,
    runController,
    torsoAngle: walker.hull.getAngle(),
    torsoVelocity: walker.hull.getLinearVelocity()
  };
}

function runStanceCase(degrees, seed = 12345, duration = 3, roughness = 0, warmupSteps = 0, groundStyle = "chain", controllerEnabled = true, balanceKp = 3.5, balanceKd = 0.02, chainStep = 0.25, stanceHalfWidth = 0.12, pelvisRatio = 0.95, terrainTiltBlend = 0, stanceCenterBlend = 0, ankleLimit = 0.6, ankleTorqueMax = 1.5, bendMode = "side", stepReach = 0.18, stepLookahead = 0.25) {
  const random = seededRandom(seed);
  const phaseA = random() * Math.PI * 2;
  const phaseB = random() * Math.PI * 2;
  const { world, slope, heightAt, terrainAngleAt } = groundStyle === "continuous"
    ? makeContinuousWorld(degrees)
    : groundStyle === "segmented"
      ? makeSegmentedWorld(degrees, roughness, phaseA, phaseB)
      : makeWorld(degrees, roughness, phaseA, phaseB, chainStep);
  const startX = (random() - 0.5) * 0.2;
  const walker = createStanceRig(world, startX, heightAt, terrainAngleAt, stanceHalfWidth, pelvisRatio, terrainTiltBlend, stanceCenterBlend, ankleLimit, bendMode);
  const initialPose = walker.legs.map(leg => {
    const footCorners = [
      leg.foot.getWorldPoint(Vec2(-FOOT_HALF_LENGTH, -FOOT_HALF_HEIGHT)),
      leg.foot.getWorldPoint(Vec2(FOOT_HALF_LENGTH, -FOOT_HALF_HEIGHT))
    ];
    const lowerAnchor = leg.lower.getWorldPoint(Vec2(0, -leg.lowerLength / 2));
    const footAnchor = leg.foot.getWorldPoint(Vec2(0, FOOT_HALF_HEIGHT));
    return {
      side: leg.side,
      hip: [Number(walker.hull.getWorldPoint(Vec2(leg.side * HIP_X, HIP_Y)).x.toFixed(4)),
        Number(walker.hull.getWorldPoint(Vec2(leg.side * HIP_X, HIP_Y)).y.toFixed(4))],
      targetX: Number(leg.targetX.toFixed(4)),
      lowerAnchor: [Number(lowerAnchor.x.toFixed(4)), Number(lowerAnchor.y.toFixed(4))],
      footAnchor: [Number(footAnchor.x.toFixed(4)), Number(footAnchor.y.toFixed(4))],
      footAngle: Number((leg.foot.getAngle() * 180 / Math.PI).toFixed(3)),
      ankleAngle: Number(leg.ankle.getJointAngle().toFixed(4)),
      ankleError: Number(Math.hypot(lowerAnchor.x - footAnchor.x, lowerAnchor.y - footAnchor.y).toFixed(6)),
      bottomCorners: footCorners.map(point => ({
        x: Number(point.x.toFixed(4)), y: Number(point.y.toFixed(4)),
        clearance: Number((point.y - heightAt(point.x)).toFixed(4))
      }))
    };
  });
  if (!controllerEnabled) {
    for (const leg of walker.legs) {
      leg.hip.enableMotor(false);
      leg.knee.enableMotor(false);
      leg.ankle.enableMotor(false);
    }
  }
  for (let i = 0; i < warmupSteps; i++) {
    if (controllerEnabled) stanceController(walker, heightAt, terrainAngleAt, 1, balanceKp, balanceKd, ankleTorqueMax, stepReach, stepLookahead);
    world.step(FIXED_DT, 180, 60);
  }
  const steps = Math.ceil(duration / FIXED_DT);
  let supportedTime = 0;
  let bothFeetContactTime = 0;
  let oneFootContactTime = 0;
  let maxRelativeTilt = 0;
  let maxAbsoluteTilt = 0;
  let maxSpeed = 0;
  let maxAirTime = 0;
  let airTime = 0;
  let finite = true;
  const trace = [];

  for (let i = 0; i < steps; i++) {
    const control = controllerEnabled
      ? stanceController(walker, heightAt, terrainAngleAt, 1, balanceKp, balanceKd, ankleTorqueMax, stepReach, stepLookahead)
      : { targets: walker.stanceTargets.map(x => Vec2(x, heightAt(x) + FOOT_HALF_HEIGHT * 2)) };
    world.step(FIXED_DT, 180, 60);
    const contacts = walker.legs.map(leg => isGroundContact(leg.foot));
    if (contacts.some(Boolean)) {
      supportedTime += FIXED_DT;
      if (contacts.every(Boolean)) bothFeetContactTime += FIXED_DT;
      else oneFootContactTime += FIXED_DT;
      airTime = 0;
    } else {
      airTime += FIXED_DT;
      maxAirTime = Math.max(maxAirTime, airTime);
    }
    maxRelativeTilt = Math.max(maxRelativeTilt, Math.abs(wrapAngle(walker.hull.getAngle() - slope)));
    maxAbsoluteTilt = Math.max(maxAbsoluteTilt, Math.abs(walker.hull.getAngle()));
    maxSpeed = Math.max(maxSpeed, walker.hull.getLinearVelocity().length());
    if (i % 10 === 0 || i === steps - 1) {
      trace.push({
        t: Number((i * FIXED_DT).toFixed(2)),
        x: Number(walker.hull.getPosition().x.toFixed(3)),
        y: Number(walker.hull.getPosition().y.toFixed(3)),
        angle: Number((walker.hull.getAngle() * 180 / Math.PI).toFixed(1)),
        hip: walker.legs.map(leg => Number(leg.hip.getJointAngle().toFixed(2))),
        knee: walker.legs.map(leg => Number(leg.knee.getJointAngle().toFixed(2))),
        ankle: walker.legs.map(leg => Number(leg.ankle.getJointAngle().toFixed(2))),
        contacts: walker.legs.map(leg => isGroundContact(leg.foot)),
        contactCounts: walker.legs.map(leg => {
          let count = 0;
          for (let edge = leg.foot.getContactList(); edge; edge = edge.next) {
            if (edge.contact.isTouching()) count++;
          }
          return count;
        }),
        centerOfMassX: Number(getRigCenterOfMassX(walker).toFixed(3)),
        velocity: {
          x: Number(walker.hull.getLinearVelocity().x.toFixed(3)),
          y: Number(walker.hull.getLinearVelocity().y.toFixed(3)),
          angular: Number(walker.hull.getAngularVelocity().toFixed(3))
        },
        targets: control.targets.map(point => [Number(point.x.toFixed(3)), Number(point.y.toFixed(3))]),
        swingIndex: walker.swingIndex ?? null,
        motorTargets: {
          hip: control.hipTargets?.map(value => Number(value.toFixed(3))),
          knee: control.kneeTargets?.map(value => Number(value.toFixed(3))),
          ankle: control.ankleTargets?.map(value => Number(value.toFixed(3)))
        },
        legs: walker.legs.map(leg => ({
          foot: [Number(leg.foot.getPosition().x.toFixed(3)), Number(leg.foot.getPosition().y.toFixed(3))],
          footAngle: Number((leg.foot.getAngle() * 180 / Math.PI).toFixed(1)),
          lowerAngle: Number((leg.lower.getAngle() * 180 / Math.PI).toFixed(1)),
          ankle: Number(leg.ankle.getJointAngle().toFixed(3)),
          ankleSpeed: Number(leg.ankle.getJointSpeed().toFixed(3)),
          ankleTorque: Number(leg.ankle.getReactionTorque(50).toFixed(3)),
          hipTorque: Number(leg.hip.getReactionTorque(50).toFixed(3)),
          kneeTorque: Number(leg.knee.getReactionTorque(50).toFixed(3)),
          motorTorque: {
            hip: Number(leg.hip.getMotorTorque(50).toFixed(3)),
            knee: Number(leg.knee.getMotorTorque(50).toFixed(3)),
            ankle: Number(leg.ankle.getMotorTorque(50).toFixed(3))
          },
          motorSpeed: {
            hip: Number(leg.hip.getMotorSpeed().toFixed(3)),
            knee: Number(leg.knee.getMotorSpeed().toFixed(3)),
            ankle: Number(leg.ankle.getMotorSpeed().toFixed(3))
          },
          ankleAnchorError: Number(Math.hypot(
            leg.lower.getWorldPoint(Vec2(0, -leg.lowerLength / 2)).x -
              leg.foot.getWorldPoint(Vec2(0, FOOT_HALF_HEIGHT)).x,
            leg.lower.getWorldPoint(Vec2(0, -leg.lowerLength / 2)).y -
              leg.foot.getWorldPoint(Vec2(0, FOOT_HALF_HEIGHT)).y
          ).toFixed(6)),
          motorTorqueLimit: {
            hip: Number(leg.hip.getMaxMotorTorque().toFixed(2)),
            knee: Number(leg.knee.getMaxMotorTorque().toFixed(2)),
            ankle: Number(leg.ankle.getMaxMotorTorque().toFixed(2))
          }
        }))
      });
    }
    finite = finite &&
      Number.isFinite(walker.hull.getAngle()) &&
      Number.isFinite(walker.hull.getPosition().x) &&
      control.targets.every(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  }

  return {
    degrees,
    warmupSteps,
    groundStyle,
    controllerEnabled,
    balanceKp,
    balanceKd,
    chainStep,
    stanceHalfWidth,
    pelvisRatio,
    terrainTiltBlend,
    stanceCenterBlend,
    ankleLimit,
    ankleTorqueMax,
    bendMode,
    stepReach,
    stepLookahead,
    initialPose,
    supportedTime: Number(supportedTime.toFixed(3)),
    bothFeetContactTime: Number(bothFeetContactTime.toFixed(3)),
    oneFootContactTime: Number(oneFootContactTime.toFixed(3)),
    maxRelativeTiltDegrees: Number((maxRelativeTilt * 180 / Math.PI).toFixed(2)),
    maxAbsoluteTiltDegrees: Number((maxAbsoluteTilt * 180 / Math.PI).toFixed(2)),
    maxSpeed: Number(maxSpeed.toFixed(3)),
    maxAirTime: Number(maxAirTime.toFixed(3)),
    finite,
    trace,
    finalPosition: {
      x: Number(walker.hull.getPosition().x.toFixed(4)),
      y: Number(walker.hull.getPosition().y.toFixed(4))
    }
  };
}

function runSlopeCase(degrees, seed = 12345, duration = 3, roughness = 0) {
  const random = seededRandom(seed);
  const phaseA = random() * Math.PI * 2;
  const phaseB = random() * Math.PI * 2;
  const { world, slope, heightAt, terrainAngleAt } = makeWorld(degrees, roughness, phaseA, phaseB);
  const startX = (random() - 0.5) * 0.5;
  const walker = createWalker(world, slope, startX, random, heightAt, terrainAngleAt);
  const warmup = 45;
  const steps = Math.ceil(duration / FIXED_DT);
  const trace = [];

  for (let i = 0; i < warmup + steps; i++) {
    const contacts = walker.legs.map(leg => isGroundContact(leg.foot));
    const control = walkerController(walker, terrainAngleAt);
    world.step(FIXED_DT, 180, 60);

    const angle = Math.abs(walker.hull.getAngle());
    const relativeTilt = Math.abs(walker.hull.getAngle() - slope);
    for (const leg of walker.legs) {
      walker.maxAnkleAngle = Math.max(walker.maxAnkleAngle, Math.abs(leg.ankle.getJointAngle()));
    }
    walker.maxTilt = Math.max(walker.maxTilt, angle);
    walker.maxSpeed = Math.max(walker.maxSpeed, Math.abs(walker.hull.getLinearVelocity().x));
    const grounded = contacts.some(Boolean);
    if (grounded) {
      walker.contactTime += FIXED_DT;
      walker.airTime = 0;
    } else {
      walker.airTime += FIXED_DT;
      walker.maxAirTime = Math.max(walker.maxAirTime, walker.airTime);
    }
    if (grounded && relativeTilt < Math.PI / 4) walker.stableTime += FIXED_DT;
    const relativeHeight = walker.hull.getPosition().y - heightAt(walker.hull.getPosition().x);
    if (angle > Math.PI * 0.61 || relativeHeight < -0.5) {
      walker.everFallen = true;
    }

    if (i >= warmup && (i % 10 === 0 || i === warmup + steps - 1)) {
      trace.push({
        time: Number(((i - warmup) * FIXED_DT).toFixed(2)),
        x: Number(walker.hull.getPosition().x.toFixed(3)),
        y: Number(walker.hull.getPosition().y.toFixed(3)),
        angle: Number((walker.hull.getAngle() * 180 / Math.PI).toFixed(1)),
        vx: Number(walker.hull.getLinearVelocity().x.toFixed(3)),
        contacts: walker.legs.map(leg => isGroundContact(leg.foot)),
        gait: walker.gait.phase,
        movingLeg: walker.gait.movingLeg,
        knees: walker.legs.map(leg => Number(leg.knee.getJointAngle().toFixed(2))),
        hips: walker.legs.map(leg => Number(leg.hip.getJointAngle().toFixed(2))),
        actions: control.actions.map(value => Number(value.toFixed(2)))
      });
    }
  }

  const finalY = walker.hull.getPosition().y;
  return {
    degrees,
    stable: !walker.everFallen && walker.stableTime >= duration * 0.5,
    lostControl: walker.maxSpeed > 6.5 || walker.maxAirTime > 0.5,
    stableTime: Number(walker.stableTime.toFixed(3)),
    contactTime: Number(walker.contactTime.toFixed(3)),
    maxAirTime: Number(walker.maxAirTime.toFixed(3)),
    everFallen: walker.everFallen,
    maxTiltDegrees: Number((walker.maxTilt * 180 / Math.PI).toFixed(2)),
    maxSpeed: Number(walker.maxSpeed.toFixed(3)),
    maxAnkleAngle: Number(walker.maxAnkleAngle.toFixed(4)),
    footCount: walker.legs.filter(leg => Boolean(leg.foot)).length,
    ankleJointCount: walker.legs.filter(leg => Boolean(leg.ankle)).length,
    ankleLowerLimit: walker.legs[0].ankle.getLowerLimit(),
    ankleUpperLimit: walker.legs[0].ankle.getUpperLimit(),
    jointCount: walker.joints.length,
    motorJointCount: walker.joints.filter(joint =>
      Number.isFinite(joint.getMotorSpeed()) &&
      Number.isFinite(joint.getMaxMotorTorque())
    ).length,
    finalPosition: {
      x: Number(walker.hull.getPosition().x.toFixed(4)),
      y: Number(finalY.toFixed(4))
    },
    trace
  };
}

module.exports = { runSlopeCase, runStanceCase, runPostureCase, runSwingTargetCase, runRigSymmetryCase, seededRandom, walkerController, stanceController, postureController, createWalker, createStanceRig, getRigCenterOfMassX, legIK, driveJoint };
