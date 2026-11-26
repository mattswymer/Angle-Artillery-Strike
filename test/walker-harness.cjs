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

function makeWorld(degrees) {
  const world = new planck.World({ gravity: Vec2(0, -GRAVITY) });
  world.setAllowSleeping(false);
  const slope = -degrees * Math.PI / 180;
  const ground = world.createBody();
  ground.createFixture({
    shape: new planck.Box(30, 0.05, Vec2(0, -0.05), slope),
    friction: 2.5,
    restitution: 0
  });
  return { world, slope };
}

function createWalker(world, slope, startX) {
  const surfaceY = Math.tan(slope) * startX;
  const initY = surfaceY + 2 * LEG_H;
  const hull = world.createDynamicBody({
    position: Vec2(startX, initY),
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
    const upper = world.createDynamicBody({
      position: Vec2(startX, initY - LEG_H / 2 - LEG_DOWN),
      angle: side * 0.05,
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
      localAnchorA: Vec2(0, LEG_DOWN),
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

    const lower = world.createDynamicBody({
      position: Vec2(startX, initY - LEG_H * 1.5 - LEG_DOWN),
      angle: side * 0.05,
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

    legs.push({ side, upper, lower, hip, knee });
    joints.push(hip, knee);
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
    maxTilt: 0,
    maxSpeed: 0,
    trace: []
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

function applyMotor(joint, action, speed) {
  const amount = Math.max(-1, Math.min(1, action));
  joint.setMotorSpeed(speed * Math.sign(amount));
  joint.setMaxMotorTorque(MAX_TORQUE * Math.abs(amount));
}

function walkerController(walker) {
  const { hull, legs, gait } = walker;
  const moving = legs[gait.movingLeg];
  const supporting = legs[gait.supportingLeg];
  const movingContact = isGroundContact(moving.lower);
  const supportingContact = isGroundContact(supporting.lower);
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
    applyMotor(legs[i].hip, actions[i * 2] * 0.5, HIP_SPEED);
    applyMotor(legs[i].knee, actions[i * 2 + 1] * 0.5, KNEE_SPEED);
  }

  gait.elapsed += FIXED_DT;
  return { movingContact, supportingContact, actions };
}

function runSlopeCase(degrees, seed = 12345, duration = 3) {
  const random = seededRandom(seed);
  const { world, slope } = makeWorld(degrees);
  const startX = (random() - 0.5) * 0.02;
  const walker = createWalker(world, slope, startX);
  const warmup = 45;
  const steps = Math.ceil(duration / FIXED_DT);
  const trace = [];

  for (let i = 0; i < warmup + steps; i++) {
    const contacts = walker.legs.map(leg => isGroundContact(leg.lower));
    const control = walkerController(walker);
    world.step(FIXED_DT, 180, 60);

    const angle = Math.abs(walker.hull.getAngle());
    walker.maxTilt = Math.max(walker.maxTilt, angle);
    walker.maxSpeed = Math.max(walker.maxSpeed, Math.abs(walker.hull.getLinearVelocity().x));
    const grounded = contacts.some(Boolean);
    if (grounded && angle < 0.9) walker.stableTime += FIXED_DT;
    else walker.stableTime = 0;
    if (angle > Math.PI * 0.65 || walker.hull.getPosition().y < -2) {
      walker.everFallen = true;
    }

    if (i >= warmup && (i % 10 === 0 || i === warmup + steps - 1)) {
      trace.push({
        time: Number(((i - warmup) * FIXED_DT).toFixed(2)),
        x: Number(walker.hull.getPosition().x.toFixed(3)),
        y: Number(walker.hull.getPosition().y.toFixed(3)),
        angle: Number((walker.hull.getAngle() * 180 / Math.PI).toFixed(1)),
        vx: Number(walker.hull.getLinearVelocity().x.toFixed(3)),
        contacts: walker.legs.map(leg => isGroundContact(leg.lower)),
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
    stableTime: Number(walker.stableTime.toFixed(3)),
    everFallen: walker.everFallen,
    maxTiltDegrees: Number((walker.maxTilt * 180 / Math.PI).toFixed(2)),
    maxSpeed: Number(walker.maxSpeed.toFixed(3)),
    finalPosition: {
      x: Number(walker.hull.getPosition().x.toFixed(4)),
      y: Number(finalY.toFixed(4))
    },
    trace
  };
}

module.exports = { runSlopeCase, seededRandom, walkerController, createWalker };
