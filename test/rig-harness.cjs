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
  // A thin solid platform gives the harness an unambiguous upward-facing
  // contact surface; the top face lies on the requested slope through origin.
  ground.createFixture({
    shape: new planck.Box(20, 0.05, V(0, -0.05), radians),
    friction: 1.0
  });
  return { world, radians, tangent, normal };
}

function solveLegIK(hip, ankle, upperLength, lowerLength, bend = 1) {
  const dx = ankle.x - hip.x;
  const dy = ankle.y - hip.y;
  const rawDistance = Math.hypot(dx, dy);
  const minDistance = Math.abs(upperLength - lowerLength) + 0.002;
  const maxDistance = upperLength + lowerLength - 0.002;
  const distance = Math.max(minDistance, Math.min(maxDistance, rawDistance));
  const direction = Math.atan2(dy, dx);
  const hipOffset = Math.acos(Math.max(-1, Math.min(1,
    (upperLength ** 2 + distance ** 2 - lowerLength ** 2) /
    (2 * upperLength * distance)
  )));
  const thighDirection = direction + bend * hipOffset;
  const knee = V(
    hip.x + Math.cos(thighDirection) * upperLength,
    hip.y + Math.sin(thighDirection) * upperLength
  );
  const thighAngle = Math.atan2(knee.y - hip.y, knee.x - hip.x) + Math.PI / 2;
  const shinAngle = Math.atan2(ankle.y - knee.y, ankle.x - knee.x) + Math.PI / 2;
  return {
    knee,
    thighAngle,
    shinAngle,
    kneeRelative: wrapAngle(shinAngle - thighAngle),
    distance: rawDistance,
    reachable: rawDistance <= maxDistance && rawDistance >= minDistance
  };
}

function createRig(world, degrees, x = 0) {
  const slope = degrees * Math.PI / 180;
  const tangent = V(Math.cos(slope), Math.sin(slope));
  const normal = V(-Math.sin(slope), Math.cos(slope));
  const surfaceAt = px => Math.tan(slope) * px;
  const footXs = [x - 0.19, x + 0.19];
  const pelvisY = Math.min(...footXs.map(px => surfaceAt(px))) +
    0.035 + 0.95 * (SEGMENT.thigh + SEGMENT.shin);
  const torsoY = pelvisY + 0.22;
  const torso = world.createDynamicBody({
    position: V(x, torsoY),
    linearDamping: 0.35,
    angularDamping: 0.75,
    allowSleep: false,
    userData: { kind: "rig-part", name: "torso" }
  });
  torso.createFixture({
    shape: new planck.Box(0.15, 0.27),
    density: 1.5,
    friction: 0.8,
    filterGroupIndex: -1
  });

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

  const revolute = (bodyA, bodyB, anchor, lower, upper, torque) => {
    // Planck joint angles are measured relative to this construction-time pose.
    // Preserve that reference so world-space IK targets can be converted correctly.
    const referenceAngle = bodyB.getAngle() - bodyA.getAngle();
    const joint = world.createJoint(planck.RevoluteJoint({
      enableLimit: true,
      lowerAngle: lower,
      upperAngle: upper,
      enableMotor: true,
      motorSpeed: 0,
      maxMotorTorque: torque,
      collideConnected: false
    }, bodyA, bodyB, anchor));
    return { joint, referenceAngle };
  };
  const neckHinge = revolute(torso, head, V(x, torsoY + 0.27), -0.65, 0.65, 1);

  const legs = footXs.map((footX, index) => {
    const surfaceY = surfaceAt(footX);
    const footCenter = V(
      footX + normal.x * 0.035,
      surfaceY + normal.y * 0.035
    );
    const ankle = V(
      footCenter.x + normal.x * 0.035,
      footCenter.y + normal.y * 0.035
    );
    const foot = world.createDynamicBody({
      position: footCenter,
      angle: slope,
      linearDamping: 0.35,
      angularDamping: 0.75,
      allowSleep: false,
      userData: { kind: "rig-part", name: "foot" }
    });
    foot.createFixture({
      shape: new planck.Box(0.11, 0.035),
      density: 0.25,
      friction: 1.0,
      filterGroupIndex: -1
    });

    const hip = V(x + (index === 0 ? -0.105 : 0.105), pelvisY);
    const ik = solveLegIK(hip, ankle, SEGMENT.thigh, SEGMENT.shin, index === 0 ? 1 : -1);
    const thighCenter = V((hip.x + ik.knee.x) / 2, (hip.y + ik.knee.y) / 2);
    const shinCenter = V((ik.knee.x + ankle.x) / 2, (ik.knee.y + ankle.y) / 2);

    const thigh = world.createDynamicBody({
      position: thighCenter,
      angle: ik.thighAngle,
      linearDamping: 0.35,
      angularDamping: 0.75,
      allowSleep: false,
      userData: { kind: "rig-part", name: "thigh" }
    });
    thigh.createFixture({
      shape: new planck.Box(0.07, SEGMENT.thigh / 2),
      density: 0.85,
      friction: 0.9,
      filterGroupIndex: -1
    });

    const shin = world.createDynamicBody({
      position: shinCenter,
      angle: ik.shinAngle,
      linearDamping: 0.35,
      angularDamping: 0.75,
      allowSleep: false,
      userData: { kind: "rig-part", name: "shin" }
    });
    shin.createFixture({
      shape: new planck.Box(0.055, SEGMENT.shin / 2),
      density: 0.75,
      friction: 0.9,
      filterGroupIndex: -1
    });

    const hipHinge = revolute(torso, thigh, hip, -1.5, 1.5, 4);
    const kneeHinge = revolute(thigh, shin, ik.knee, -2.4, 2.4, 4);
    const ankleHinge = revolute(shin, foot, ankle, -0.7, 0.7, 1.5);
    return {
      side: index === 0 ? -1 : 1,
      footX,
      targetX: footX,
      foot,
      thigh,
      shin,
      hipJoint: hipHinge.joint,
      kneeJoint: kneeHinge.joint,
      ankleJoint: ankleHinge.joint,
      hipReference: hipHinge.referenceAngle,
      kneeReference: kneeHinge.referenceAngle,
      ankleReference: ankleHinge.referenceAngle,
      initialIK: ik,
      step: null
    };
  });

  return {
    torso, head, neck: neckHinge.joint, neckReference: neckHinge.referenceAngle, legs,
    mode: "active",
    stiffness: 1,
    stableFor: 0,
    elapsed: 0,
    outsideTime: 0,
    noContactTime: 0,
    everLimp: false,
    pelvisTargetY: pelvisY
  };
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
  const slopeNormal = V(-Math.sin(slopeRadians), Math.cos(slopeRadians));
  let contacts = 0;
  let worstNormalAngle = 0;
  let minFootX = Infinity;
  let maxFootX = -Infinity;

  for (const leg of rig.legs) {
    const contact = footContact(leg.foot);
    if (contact) {
      contacts++;
      const footIsFixtureA = contact.contact.getFixtureA().getBody() === leg.foot;
      const upwardNormal = footIsFixtureA
        ? V(-contact.normal.x, -contact.normal.y)
        : contact.normal;
      // The failure threshold is measured from world vertical, not from the
      // local ground normal (otherwise every slope would read as zero degrees).
      const angleFromVertical = Math.acos(Math.max(-1, Math.min(1, upwardNormal.y)));
      worstNormalAngle = Math.max(worstNormalAngle, angleFromVertical);
    }
    const px = leg.foot.getPosition().x;
    minFootX = Math.min(minFootX, px);
    maxFootX = Math.max(maxFootX, px);
  }

  const outsideSupport = torsoPosition.x < minFootX - 0.04 ||
    torsoPosition.x > maxFootX + 0.04;
  rig.outsideTime = outsideSupport ? rig.outsideTime + dt : 0;

  // Step only when the torso COM leaves the current foot support span.
  if (outsideSupport && !rig.legs.some(leg => leg.step)) {
    const left = torsoPosition.x < minFootX;
    const leg = rig.legs.reduce((chosen, candidate) => {
      if (!chosen) return candidate;
      const a = candidate.foot.getPosition().x;
      const b = chosen.foot.getPosition().x;
      return left ? (a < b ? candidate : chosen) : (a > b ? candidate : chosen);
    }, null);
    const fromX = leg.foot.getPosition().x;
    const toX = torsoPosition.x + (left ? -0.22 : 0.22);
    if (Math.abs(toX - fromX) > 0.12) {
      leg.step = { fromX, toX, elapsed: 0, duration: 0.24 };
    }
  }

  for (const leg of rig.legs) {
    if (leg.step) {
      leg.step.elapsed = Math.min(leg.step.duration, leg.step.elapsed + dt);
      const t = leg.step.elapsed / leg.step.duration;
      const smooth = t * t * (3 - 2 * t);
      leg.targetX = leg.step.fromX + (leg.step.toX - leg.step.fromX) * smooth;
      if (t >= 1) {
        leg.targetX = leg.step.toX;
        leg.step = null;
      }
    }
  }

  const supported = contacts > 0;
  rig.noContactTime = supported ? 0 : rig.noContactTime + dt;
  const torsoTilt = Math.abs(wrapAngle(rig.torso.getAngle()));
  const badReasons = [];
  if (worstNormalAngle >= 50 * Math.PI / 180) badReasons.push("contact-normal");
  if (rig.outsideTime > 0.25) badReasons.push("outside-support");
  if (rig.noContactTime > 0.3) badReasons.push("no-foot-contact");
  if (torsoTilt > 60 * Math.PI / 180) badReasons.push("torso-tilt");
  rig.badReasons = badReasons;
  const badSupport = badReasons.length > 0;
  rig.stiffness = badSupport
    ? Math.max(0, rig.stiffness - dt / 0.1)
    : Math.min(1, rig.stiffness + dt / 0.5);
  rig.mode = rig.stiffness <= 0.001 ? "limp" : "active";
  if (rig.mode === "limp") rig.everLimp = true;

  const terrainSlope = Math.tan(slopeRadians);
  const pelvisTargetY = Math.min(...rig.legs.map(leg =>
    terrainSlope * leg.targetX + 0.035 + 0.95 * (SEGMENT.thigh + SEGMENT.shin)
  ));
  rig.pelvisTargetY = pelvisTargetY;

  rig.legs.forEach(leg => {
    const footX = leg.targetX;
    const lift = leg.step
      ? Math.sin(Math.PI * leg.step.elapsed / leg.step.duration) * 0.12
      : 0;
    const footCenter = V(
      footX - Math.sin(slopeRadians) * (0.035 - lift),
      terrainSlope * footX + Math.cos(slopeRadians) * (0.035 - lift)
    );
    const ankle = V(
      footCenter.x - Math.sin(slopeRadians) * 0.035,
      footCenter.y + Math.cos(slopeRadians) * 0.035
    );
    const hip = V(
      torsoPosition.x + leg.side * 0.105,
      pelvisTargetY
    );
    const ik = solveLegIK(hip, ankle, SEGMENT.thigh, SEGMENT.shin, -leg.side);
    const hipTarget = ik.thighAngle - rig.torso.getAngle() - leg.hipReference;
    const kneeTarget = ik.kneeRelative - leg.kneeReference;
    const ankleTarget = slopeRadians - ik.shinAngle - leg.ankleReference;
    driveJoint(leg.hipJoint, hipTarget, 13, 5, 4, rig.stiffness);
    driveJoint(leg.kneeJoint, kneeTarget, 13, 5, 4, rig.stiffness);
    driveJoint(leg.ankleJoint, ankleTarget, 12, 4, 1.5, rig.stiffness);
  });

  driveJoint(rig.neck, -rig.torso.getAngle() - rig.neckReference, 10, 5, 1, rig.stiffness);

  if (rig.stiffness > 0.8 && supported && torsoTilt < 35 * Math.PI / 180) {
    rig.stableFor += dt;
  } else {
    rig.stableFor = 0;
  }
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
    if (i % 6 === 0 && i <= 36) {
      trace.push({
        time: Number((i * STEP).toFixed(2)),
        x: Number(rig.torso.getPosition().x.toFixed(3)),
        y: Number(rig.torso.getPosition().y.toFixed(3)),
        torsoAngle: Number((rig.torso.getAngle() * 180 / Math.PI).toFixed(1)),
        stiffness: Number(rig.stiffness.toFixed(2)),
        stableFor: Number(rig.stableFor.toFixed(2)),
        contacts: rig.legs.filter(leg => footContact(leg.foot)).length,
        hips: rig.legs.map(leg => Number(leg.hipJoint.getJointAngle().toFixed(2))),
        knees: rig.legs.map(leg => Number(leg.kneeJoint.getJointAngle().toFixed(2))),
        ankles: rig.legs.map(leg => Number(leg.ankleJoint.getJointAngle().toFixed(2))),
        badReasons: rig.badReasons,
        feet: rig.legs.map(leg => ({
          x: Number(leg.foot.getPosition().x.toFixed(3)),
          y: Number(leg.foot.getPosition().y.toFixed(3)),
          angle: Number((leg.foot.getAngle() * 180 / Math.PI).toFixed(1)),
          vx: Number(leg.foot.getLinearVelocity().x.toFixed(3)),
          vy: Number(leg.foot.getLinearVelocity().y.toFixed(3))
        }))
      });
    }
  }

  return {
    degrees,
    stable: rig.stableFor >= 0.3,
    stableFor: Number(rig.stableFor.toFixed(3)),
    mode: rig.mode,
    everLimp: rig.everLimp,
    finalAngle: Number((rig.torso.getAngle() * 180 / Math.PI).toFixed(2)),
    finalPosition: { x: rig.torso.getPosition().x, y: rig.torso.getPosition().y },
    trace
  };
}

module.exports = { runSlopeCase, seededRandom, driveJoint, solveLegIK };
