"use strict";

const planck = require("planck");

const GRAVITY = 10;
const STEP = 1 / 60;
const DURATION = 3;
const SEGMENT = { thigh: 0.40, shin: 0.36 };
const V = planck.Vec2;

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

function wrapAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function driveJoint(joint, target, kp, maxSpeed, maxTorque, stiffness) {
  const error = wrapAngle(target - joint.getJointAngle());
  joint.setMotorSpeed(Math.max(-maxSpeed, Math.min(maxSpeed, kp * error)));
  joint.setMaxMotorTorque(maxTorque * stiffness);
}

function legIK(hip, foot, upperLength, lowerLength, bend) {
  const dx = foot.x - hip.x;
  const dy = foot.y - hip.y;
  const distance = Math.max(0.001, Math.min(
    Math.hypot(dx, dy),
    (upperLength + lowerLength) * 0.999
  ));
  const direction = Math.atan2(dy, dx);
  const hipOffset = Math.acos(Math.max(-1, Math.min(1,
    (upperLength ** 2 + distance ** 2 - lowerLength ** 2) /
    (2 * upperLength * distance)
  )));
  const kneeInterior = Math.acos(Math.max(-1, Math.min(1,
    (upperLength ** 2 + lowerLength ** 2 - distance ** 2) /
    (2 * upperLength * lowerLength)
  )));
  return {
    thighDirection: direction + bend * hipOffset,
    kneeRelative: bend * (Math.PI - kneeInterior)
  };
}

function makeSlopeWorld(degrees) {
  const world = new planck.World({ gravity: V(0, -GRAVITY) });
  world.setAllowSleeping(false);
  const radians = degrees * Math.PI / 180;
  const tangent = V(Math.cos(radians), Math.sin(radians));
  const normal = V(-Math.sin(radians), Math.cos(radians));
  const ground = world.createBody();
  const halfLength = 20;
  const center = V(0, 0);
  const a = V(center.x - tangent.x * halfLength, center.y - tangent.y * halfLength);
  const b = V(center.x + tangent.x * halfLength, center.y + tangent.y * halfLength);
  ground.createFixture({ shape: new planck.Edge(a, b), friction: 1.0 });
  return { world, radians, tangent, normal };
}

function createRig(world, degrees, x = 0) {
  const slope = degrees * Math.PI / 180;
  const sine = Math.sin(slope);
  const cosine = Math.cos(slope);
  const surfaceAt = px => Math.tan(slope) * px;
  const parts = { torso: null, head: null, legs: [] };

  const makeBox = (name, position, angle, hx, hy, density = 1) => {
    const body = world.createDynamicBody({
      position,
      angle,
      linearDamping: 0.04,
      angularDamping: 0.08,
      allowSleep: false,
      userData: { kind: "rig-part", name }
    });
    body.createFixture({
      shape: new planck.Box(hx, hy),
      density,
      friction: 0.9,
      filterGroupIndex: -1
    });
    return body;
  };

  const legGeometry = [-1, 1].map(side => {
    const footX = x + side * 0.19;
    const surfaceY = surfaceAt(footX);
    const footPosition = V(footX, surfaceY + 0.035);
    const ankle = V(footX - sine * 0.035, surfaceY + 0.035 + cosine * 0.035);
    const knee = V(ankle.x, ankle.y + SEGMENT.shin);
    const hipX = x + side * 0.105;
    const horizontal = knee.x - hipX;
    const vertical = Math.sqrt(Math.max(0.001, SEGMENT.thigh ** 2 - horizontal ** 2));
    const hip = V(hipX, knee.y + vertical);
    return { side, footX, footPosition, ankle, knee, hip };
  });

  const torsoY = legGeometry.reduce((sum, leg) => sum + leg.hip.y, 0) /
    legGeometry.length + 0.22;
  const torso = makeBox("torso", V(x, torsoY), 0, 0.15, 0.27, 1.5);
  parts.torso = torso;

  const head = world.createDynamicBody({
    position: V(x, torsoY + 0.40),
    allowSleep: false,
    userData: { kind: "rig-part", name: "head" }
  });
  head.createFixture({
    shape: new planck.Circle(0.12),
    density: 0.7,
    friction: 0.5,
    filterGroupIndex: -1
  });
  parts.head = head;

  const revolute = (bodyA, bodyB, anchor, lower, upper, torque) => world.createJoint(
    planck.RevoluteJoint({
      enableLimit: true,
      lowerAngle: lower,
      upperAngle: upper,
      enableMotor: true,
      motorSpeed: 0,
      maxMotorTorque: torque,
      collideConnected: false
    }, bodyA, bodyB, anchor)
  );
  revolute(torso, head, V(x, torsoY + 0.27), -0.65, 0.65, 1);

  for (const geometry of legGeometry) {
    const { side, footX, footPosition, ankle, knee, hip } = geometry;
    const foot = makeBox("foot", footPosition, slope, 0.11, 0.035, 0.25);
    const shinCenter = V((ankle.x + knee.x) / 2, (ankle.y + knee.y) / 2);
    const shinAngle = Math.atan2(ankle.y - knee.y, ankle.x - knee.x) + Math.PI / 2;
    const shin = makeBox("shin", shinCenter, shinAngle, 0.055, SEGMENT.shin / 2, 0.75);
    const thighCenter = V((hip.x + knee.x) / 2, (hip.y + knee.y) / 2);
    const thighAngle = Math.atan2(knee.y - hip.y, knee.x - hip.x) + Math.PI / 2;
    const thigh = makeBox("thigh", thighCenter, thighAngle, 0.07, SEGMENT.thigh / 2, 0.85);

    const hipJoint = revolute(torso, thigh, hip, -1.5, 1.5, 4);
    const kneeJoint = revolute(thigh, shin, knee, -2.4, 2.4, 4);
    const ankleJoint = revolute(shin, foot, ankle, -0.7, 0.7, 1.5);
    parts.legs.push({
      side, footX, targetX: footX, step: null, thigh, shin, foot,
      hipJoint, kneeJoint, ankleJoint
    });
  }
  return { ...parts, mode: "active", stiffness: 1, stableFor: 0, elapsed: 0, outsideTime: 0 };
}

function footContact(foot) {
  for (let edge = foot.getContactList(); edge; edge = edge.next) {
    if (edge.contact.isTouching()) {
      const manifold = edge.contact.getWorldManifold(null);
      if (manifold && manifold.normal) return { normal: manifold.normal, contact: edge.contact };
    }
  }
  return null;
}

function stepRig(world, rig, slopeRadians, dt = STEP) {
  rig.elapsed += dt;
  const torsoPosition = rig.torso.getPosition();
  let contacts = 0;
  let worstNormalAngle = 0;
  let minFootX = Infinity;
  let maxFootX = -Infinity;

  for (const leg of rig.legs) {
    const contact = footContact(leg.foot);
    if (contact) {
      contacts++;
      const fixtureAIsFoot = contact.contact.getFixtureA().getBody() === leg.foot;
      const upwardNormal = fixtureAIsFoot
        ? V(-contact.normal.x, -contact.normal.y)
        : contact.normal;
      const slopeNormal = V(-Math.sin(slopeRadians), Math.cos(slopeRadians));
      const alignment = Math.max(-1, Math.min(1,
        upwardNormal.x * slopeNormal.x + upwardNormal.y * slopeNormal.y));
      worstNormalAngle = Math.max(worstNormalAngle, Math.acos(alignment));
    }
    const footX = leg.foot.getPosition().x;
    minFootX = Math.min(minFootX, footX);
    maxFootX = Math.max(maxFootX, footX);
  }

  const outsideSupport = torsoPosition.x < minFootX - 0.04 ||
    torsoPosition.x > maxFootX + 0.04;
  rig.outsideTime = outsideSupport ? (rig.outsideTime || 0) + dt : 0;

  // A foot only steps when the COM leaves the support interval.
  if (outsideSupport && !rig.legs.some(leg => leg.step)) {
    const leftOfSupport = torsoPosition.x < minFootX - 0.04;
    const steppingLeg = rig.legs.reduce((chosen, leg) => {
      const x = leg.foot.getPosition().x;
      if (!chosen) return leg;
      const chosenX = chosen.foot.getPosition().x;
      return leftOfSupport ? (x < chosenX ? leg : chosen) : (x > chosenX ? leg : chosen);
    }, null);
    const destination = torsoPosition.x + (leftOfSupport ? -0.22 : 0.22);
    if (Math.abs(destination - steppingLeg.foot.getPosition().x) > 0.12) {
      steppingLeg.step = {
        fromX: steppingLeg.foot.getPosition().x,
        toX: destination,
        elapsed: 0,
        duration: 0.24
      };
    }
  }

  for (const leg of rig.legs) {
    if (!leg.step) continue;
    leg.step.elapsed = Math.min(leg.step.duration, leg.step.elapsed + dt);
    const progress = leg.step.elapsed / leg.step.duration;
    const smooth = progress * progress * (3 - 2 * progress);
    leg.targetX = leg.step.fromX + (leg.step.toX - leg.step.fromX) * smooth;
    if (progress >= 1) {
      leg.targetX = leg.step.toX;
      leg.step = null;
    }
  }

  const supported = contacts > 0;
  const torsoTilt = Math.abs(wrapAngle(rig.torso.getAngle()));
  const badSupport = worstNormalAngle > 50 * Math.PI / 180 ||
    rig.outsideTime > 0.25 ||
    (!supported && rig.elapsed > 0.3) ||
    torsoTilt > 60 * Math.PI / 180;

  if (badSupport) rig.stiffness = Math.max(0, rig.stiffness - dt / 0.1);
  else rig.stiffness = Math.min(1, rig.stiffness + dt / 0.5);

  const torsoAngle = rig.torso.getAngle();
  const slope = Math.tan(slopeRadians);
  const footTargets = rig.legs.map(leg => {
    const x = leg.targetX;
    const lift = leg.step
      ? Math.sin(Math.PI * leg.step.elapsed / leg.step.duration) * 0.12
      : 0;
    return V(
      x - Math.sin(slopeRadians) * 0.035,
      slope * x + 0.035 + Math.cos(slopeRadians) * 0.035 + lift
    );
  });

  rig.legs.forEach((leg, index) => {
    const hip = rig.torso.getWorldPoint(V(leg.side * 0.105, -0.22));
    const ik = legIK(hip, footTargets[index], SEGMENT.thigh, SEGMENT.shin, leg.side);
    const thighTarget = ik.thighDirection + Math.PI / 2 - torsoAngle;
    driveJoint(leg.hipJoint, thighTarget, 13, 8, 4, rig.stiffness);
    driveJoint(leg.kneeJoint, ik.kneeRelative, 13, 8, 4, rig.stiffness);
    driveJoint(leg.ankleJoint, slopeRadians - leg.shin.getAngle(), 12, 6, 1.5, rig.stiffness);
  });

  if (rig.stiffness > 0.8 && supported && torsoTilt < 35 * Math.PI / 180) rig.stableFor += dt;
  else rig.stableFor = 0;
}

function runSlopeCase(degrees, seed = 12345) {
  const random = seededRandom(seed);
  const { world, radians } = makeSlopeWorld(degrees);
  const startX = (random() - 0.5) * 0.04;
  const rig = createRig(world, degrees, startX);
  const frames = Math.round(DURATION / STEP);
  const trace = [];

  for (let i = 0; i < frames; i++) {
    stepRig(world, rig, radians);
    world.step(STEP, 8, 3);
    if (i % 30 === 0) {
      trace.push({
        time: Number((i * STEP).toFixed(2)),
        x: Number(rig.torso.getPosition().x.toFixed(3)),
        y: Number(rig.torso.getPosition().y.toFixed(3)),
        torsoAngle: Number((rig.torso.getAngle() * 180 / Math.PI).toFixed(1)),
        stiffness: Number(rig.stiffness.toFixed(2)),
        stableFor: Number(rig.stableFor.toFixed(2)),
        contacts: rig.legs.filter(leg => footContact(leg.foot)).length
      });
    }
  }

  return {
    degrees,
    stable: rig.stableFor >= 0.3,
    stableFor: Number(rig.stableFor.toFixed(3)),
    mode: rig.stiffness > 0 ? "active" : "limp",
    finalAngle: Number((rig.torso.getAngle() * 180 / Math.PI).toFixed(2)),
    finalPosition: { x: rig.torso.getPosition().x, y: rig.torso.getPosition().y },
    trace
  };
}

module.exports = { runSlopeCase, seededRandom, driveJoint, legIK };
