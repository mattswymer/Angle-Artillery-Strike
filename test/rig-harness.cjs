"use strict";

const planck = require("planck");

const GRAVITY = 10;
const STEP = 1 / 60;
const DURATION = 3;
const SEGMENT = { thigh: 0.41, shin: 0.34 };
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

function chooseLegIK(hip, ankle, upperLength, lowerLength, side, slopeRadians) {
  const candidates = [-1, 1].map(bend => {
    const ik = solveLegIK(hip, ankle, upperLength, lowerLength, bend);
    const ankleTarget = slopeRadians - ik.shinAngle;
    const violations =
      Math.max(0, Math.abs(ik.thighAngle) - 1.25) +
      Math.max(0, Math.abs(ik.kneeRelative) - 2.4) +
      Math.max(0, Math.abs(ankleTarget) - 0.6);
    const margin = Math.min(
      1.25 - Math.abs(ik.thighAngle),
      2.4 - Math.abs(ik.kneeRelative),
      0.6 - Math.abs(ankleTarget)
    );
    return { ...ik, bend, ankleTarget, violations, margin };
  });
  const preferred = candidates.find(candidate => candidate.bend === side);
  if (preferred && preferred.violations < 1e-6) return preferred;
  const valid = candidates.filter(candidate => candidate.violations < 1e-6);
  if (valid.length) return valid.sort((a, b) => b.margin - a.margin)[0];
  return candidates.sort((a, b) => a.violations - b.violations)[0];
}

function createRig(world, degrees, x = 0) {
  const slope = degrees * Math.PI / 180;
  const normal = V(-Math.sin(slope), Math.cos(slope));
  const surfaceAt = px => Math.tan(slope) * px;
  const footXs = [x - 0.105, x + 0.105];
  const pelvisY = Math.min(...footXs.map(px =>
    surfaceAt(px) + Math.cos(slope) * 0.067
  )) + 0.95 * (SEGMENT.thigh + SEGMENT.shin);
  const torsoY = pelvisY + 0.25;

  const addBox = (name, position, angle, hx, hy, density, options = {}) => {
    const body = world.createDynamicBody({
      position,
      angle,
      linearDamping: 0.35,
      angularDamping: 0.75,
      allowSleep: false,
      userData: { kind: "rig-part", name }
    });
    body.createFixture({
      shape: new planck.Box(hx, hy),
      density,
      friction: options.friction ?? 0.9,
      restitution: 0.04,
      isSensor: options.sensor ?? false,
      filterGroupIndex: -1
    });
    return body;
  };

  const torso = addBox("torso", V(x, torsoY), 0, 0.17, 0.29, 1.5);
  const head = world.createDynamicBody({
    position: V(x, torsoY + 0.425),
    linearDamping: 0.35,
    angularDamping: 0.75,
    allowSleep: false,
    userData: { kind: "rig-part", name: "head" }
  });
  head.createFixture({
    shape: new planck.Circle(0.135),
    density: 1.05,
    friction: 0.5,
    restitution: 0.04,
    filterGroupIndex: -1
  });

  // The complete articulated character is present from frame zero:
  // torso, head, two upper/lower arms, two upper/lower legs, and two feet.
  const arms = [-1, 1].map(side => {
    const upper = addBox(
      side < 0 ? "left-upper-arm" : "right-upper-arm",
      V(x + side * 0.17, torsoY + 0.03), 0, 0.065, 0.19, 0.8
    );
    const lower = addBox(
      side < 0 ? "left-lower-arm" : "right-lower-arm",
      V(x + side * 0.17, torsoY - 0.33), 0, 0.055, 0.17, 0.8,
      { sensor: true, friction: 0.18 }
    );
    return { side, upper, lower };
  });

  const revolute = (bodyA, bodyB, anchor, lower, upper, torque) => world.createJoint(
    planck.RevoluteJoint({
      enableLimit: true,
      lowerAngle: lower,
      upperAngle: upper,
      referenceAngle: 0,
      enableMotor: true,
      motorSpeed: 0,
      maxMotorTorque: torque,
      collideConnected: false
    }, bodyA, bodyB, anchor)
  );

  const neck = revolute(torso, head, V(x, torsoY + 0.29), -0.8, 0.8, 1);
  const armJoints = arms.map(arm => ({
    side: arm.side,
    shoulder: revolute(
      torso, arm.upper, V(x + arm.side * 0.17, torsoY + 0.22),
      arm.side < 0 ? -2.35 : -1.5,
      arm.side < 0 ? 1.5 : 2.35,
      0
    ),
    elbow: revolute(
      arm.upper, arm.lower, V(x + arm.side * 0.17, torsoY - 0.16),
      -2.45, 2.45, 0
    )
  }));

  const legs = footXs.map((footX, index) => {
    const side = index === 0 ? -1 : 1;
    const surfaceY = surfaceAt(footX);
    const footCenter = V(
      footX + normal.x * 0.032,
      surfaceY + normal.y * 0.032
    );
    const ankle = V(
      footCenter.x + normal.x * 0.035,
      footCenter.y + normal.y * 0.035
    );
    const foot = addBox(
      "foot", footCenter, slope, 0.11, 0.035, 0.25,
      { friction: 0.9 }
    );

    const hip = V(x + side * 0.105, pelvisY);
    const ik = chooseLegIK(hip, ankle, SEGMENT.thigh, SEGMENT.shin, side, slope);
    const thighCenter = V((hip.x + ik.knee.x) / 2, (hip.y + ik.knee.y) / 2);
    const shinCenter = V((ik.knee.x + ankle.x) / 2, (ik.knee.y + ankle.y) / 2);
    const thigh = addBox(
      side < 0 ? "left-upper-leg" : "right-upper-leg",
      thighCenter, ik.thighAngle, 0.075, SEGMENT.thigh / 2, 1.15
    );
    const shin = addBox(
      side < 0 ? "left-lower-leg" : "right-lower-leg",
      shinCenter, ik.shinAngle, 0.06, SEGMENT.shin / 2, 1.1
    );

    const hipJoint = revolute(torso, thigh, hip, -1.25, 1.25, 4);
    const kneeJoint = revolute(thigh, shin, ik.knee, -2.4, 2.4, 4);
    const ankleJoint = revolute(shin, foot, ankle, -0.6, 0.6, 1.5);
    return {
      side,
      footX,
      targetX: footX,
      foot,
      thigh,
      shin,
      hipJoint,
      kneeJoint,
      ankleJoint,
      initialIK: ik,
      bend: ik.bend,
      step: null
    };
  });

  return {
    torso, head, neck, arms, armJoints, legs,
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

function getRigCenterOfMass(rig) {
  const bodies = [
    rig.torso, rig.head,
    ...rig.arms.flatMap(arm => [arm.upper, arm.lower]),
    ...rig.legs.flatMap(leg => [leg.thigh, leg.shin, leg.foot])
  ];
  let totalMass = 0;
  let x = 0;
  let y = 0;
  let vx = 0;
  let vy = 0;
  for (const body of bodies) {
    const mass = body.getMass();
    const center = body.getWorldCenter();
    const velocity = body.getLinearVelocity();
    totalMass += mass;
    x += center.x * mass;
    y += center.y * mass;
    vx += velocity.x * mass;
    vy += velocity.y * mass;
  }
  return { x: x / totalMass, y: y / totalMass, vx: vx / totalMass, vy: vy / totalMass };
}

function stepRig(world, rig, slopeRadians, dt = STEP, allowSteps = true) {
  rig.elapsed += dt;
  const torsoPosition = rig.torso.getPosition();
  const centerOfMass = getRigCenterOfMass(rig);
  let contacts = 0;
  let worstNormalAngle = 0;
  let minFootX = Infinity;
  let maxFootX = -Infinity;
  const supportingLegs = [];

  for (const leg of rig.legs) {
    const contact = footContact(leg.foot);
    if (!contact) continue;
    contacts++;
    supportingLegs.push(leg);
    const footIsFixtureA = contact.contact.getFixtureA().getBody() === leg.foot;
    const upwardNormal = footIsFixtureA
      ? V(-contact.normal.x, -contact.normal.y)
      : contact.normal;
    const angleFromVertical = Math.acos(Math.max(-1, Math.min(1, upwardNormal.y)));
    worstNormalAngle = Math.max(worstNormalAngle, angleFromVertical);
    const px = leg.foot.getPosition().x;
    minFootX = Math.min(minFootX, px);
    maxFootX = Math.max(maxFootX, px);
  }

  // Only planted feet count as support. A swinging foot is not part of the
  // support interval until it actually touches the ground again.
  const outsideSupport = contacts === 0 ||
    centerOfMass.x < minFootX - 0.04 ||
    centerOfMass.x > maxFootX + 0.04;
  rig.outsideTime = outsideSupport ? rig.outsideTime + dt : 0;

  if (allowSteps && outsideSupport && !rig.legs.some(leg => leg.step)) {
    let steppingLeg;
    let left;
    if (supportingLegs.length === 1) {
      steppingLeg = rig.legs.find(leg => leg !== supportingLegs[0]);
      left = centerOfMass.x < supportingLegs[0].foot.getPosition().x;
    } else if (supportingLegs.length === 2) {
      left = centerOfMass.x < minFootX;
      // Keep the foot under the COM planted; move the opposite foot across.
      steppingLeg = left
        ? supportingLegs.reduce((a, b) => a.foot.getPosition().x > b.foot.getPosition().x ? a : b)
        : supportingLegs.reduce((a, b) => a.foot.getPosition().x < b.foot.getPosition().x ? a : b);
    } else {
      left = centerOfMass.vx < 0;
      steppingLeg = rig.legs[0];
    }

    const stepDistance = Math.max(0.18, Math.min(0.26,
      0.18 + Math.abs(centerOfMass.vx) * 0.06
    ));
    const fromX = steppingLeg.foot.getPosition().x;
    const toX = centerOfMass.x + (left ? -stepDistance : stepDistance);
    // Even a nearly-under-COM airborne foot must complete a swing/plant cycle.
    // Skipping short horizontal steps left the foot suspended indefinitely.
    steppingLeg.step = {
      fromX,
      toX: Math.abs(toX - fromX) < 0.12 ? fromX : toX,
      elapsed: 0,
      duration: 0.18
    };
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
    terrainSlope * leg.targetX + Math.cos(slopeRadians) * 0.067 +
    0.95 * (SEGMENT.thigh + SEGMENT.shin)
  ));
  rig.pelvisTargetY = pelvisTargetY;

  rig.legs.forEach(leg => {
    const footX = leg.targetX;
    const lift = leg.step
      ? Math.sin(Math.PI * leg.step.elapsed / leg.step.duration) * 0.12
      : 0;
    const footCenter = V(
      footX - Math.sin(slopeRadians) * (0.032 - lift),
      terrainSlope * footX + Math.cos(slopeRadians) * (0.032 - lift)
    );
    const ankle = V(
      footCenter.x - Math.sin(slopeRadians) * 0.035,
      footCenter.y + Math.cos(slopeRadians) * 0.035
    );
    // Solve from the live hinge anchor. The pelvis height is a spawn/stance
    // reference; using it as a fictitious hinge point makes the IK command a
    // pose the physical joint cannot actually reach when the torso moves.
    const actualHipAnchor = rig.torso.getWorldPoint(V(leg.side * 0.105, -0.25));
    const hip = actualHipAnchor;
    const ik = solveLegIK(hip, ankle, SEGMENT.thigh, SEGMENT.shin, leg.bend);
    const hipTarget = ik.thighAngle - rig.torso.getAngle();
    const kneeTarget = ik.kneeRelative;
    const ankleTarget = slopeRadians - ik.shinAngle;
    driveJoint(leg.hipJoint, hipTarget, 13, 8, 4, rig.stiffness);
    driveJoint(leg.kneeJoint, kneeTarget, 13, 8, 4, rig.stiffness);
    driveJoint(leg.ankleJoint, ankleTarget, 12, 6, 1.5, rig.stiffness);
  });

  driveJoint(rig.neck, -rig.torso.getAngle(), 10, 5, 1, rig.stiffness);
  // Arms remain articulated but passive during stance; leg and neck motors
  // provide active support instead of arm motors fighting the balance loop.

  if (rig.stiffness > 0.8 && supported && torsoTilt < 35 * Math.PI / 180) {
    rig.stableFor += dt;
  } else {
    rig.stableFor = 0;
  }
}

function runSlopeCase(degrees, seed = 12345, allowSteps = true) {
  const random = seededRandom(seed);
  const { world, radians } = makeSlopeWorld(degrees);
  const startX = (random() - 0.5) * 0.04;
  const rig = createRig(world, degrees, startX);
  const frames = Math.round(DURATION / STEP);
  const trace = [];

  // Planck builds contact edges during a world step. Establish the initial
  // contact graph before the stance controller reads foot contact lists.
  world.step(STEP, 8, 3);

  // Production also settles the spawned rig for 90 fixed steps before render.
  const warmupSteps = 90;
  for (let i = 0; i < warmupSteps; i++) {
    stepRig(world, rig, radians, STEP, allowSteps);
    world.step(STEP, 8, 3);
  }

  for (let i = 0; i < frames; i++) {
    stepRig(world, rig, radians, STEP, allowSteps);
    world.step(STEP, 8, 3);
    if (i % 30 === 0 || (i % 6 === 0 && i <= 36)) {
      trace.push({
        time: Number(((warmupSteps + i) * STEP).toFixed(2)),
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
        comX: Number(getRigCenterOfMass(rig).x.toFixed(3)),
        comVx: Number(getRigCenterOfMass(rig).vx.toFixed(3)),
        outsideSupport: rig.outsideTime > 0,
        steps: rig.legs.map(leg => leg.step ? Number((leg.step.elapsed / leg.step.duration).toFixed(2)) : 0),
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
    stable: rig.stableFor >= DURATION - STEP,
    stableFor: Number(rig.stableFor.toFixed(3)),
    mode: rig.mode,
    everLimp: rig.everLimp,
    spawnJointTargets: rig.legs.map(leg => ({
      side: leg.side,
      bend: leg.bend,
      hip: Number(leg.initialIK.thighAngle.toFixed(3)),
      knee: Number(leg.initialIK.kneeRelative.toFixed(3)),
      ankle: Number((radians - leg.initialIK.shinAngle).toFixed(3))
    })),
    finalAngle: Number((rig.torso.getAngle() * 180 / Math.PI).toFixed(2)),
    finalPosition: { x: rig.torso.getPosition().x, y: rig.torso.getPosition().y },
    trace
  };
}

module.exports = { runSlopeCase, seededRandom, driveJoint, solveLegIK };
