(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CharacterRig = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function create(P) {
    const planck = P;
    const Vec2 = P.Vec2;
    const FIXED_DT = 1 / 50;
    const GRAVITY = 10;

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

    function createStanceRig(world, startX, heightAt, terrainAngleAt, stanceHalfWidth = 0.12, pelvisRatio = 0.95, terrainTiltBlend = 0, stanceCenterBlend = 0, ankleLimit = 0.6, bendMode = "side", highSideBend = 0.4, lowSideBend = 1, collisionGroup = -1) {
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
    filterGroupIndex: collisionGroup
  });

  const makeUpperBodyPart = (name, localCenter, halfWidth, halfHeight, density, circle = false, sensor = false) => {
    const center = hull.getWorldPoint(Vec2(localCenter[0], localCenter[1]));
    const body = world.createDynamicBody({
      position: center,
      angle: initialTerrainAngle,
      linearDamping: 0.08,
      angularDamping: 0.08,
      allowSleep: false,
      userData: { part: name }
    });
    body.createFixture({
      shape: circle ? new planck.Circle(halfWidth) : new planck.Box(halfWidth, halfHeight),
      density,
      friction: sensor ? 0.18 : 0.35,
      restitution: 0,
      isSensor: sensor,
      filterGroupIndex: collisionGroup
    });
    return body;
  };
  const head = makeUpperBodyPart("head", [0, 0.47], 0.135, 0.135, 1.05, true);
  const leftUpperArm = makeUpperBodyPart("left-upper-arm", [-0.17, 0.03], 0.065, 0.19, 0.8);
  const leftLowerArm = makeUpperBodyPart("left-lower-arm", [-0.17, -0.33], 0.055, 0.17, 0.8, false, true);
  const rightUpperArm = makeUpperBodyPart("right-upper-arm", [0.17, 0.03], 0.065, 0.19, 0.8);
  const rightLowerArm = makeUpperBodyPart("right-lower-arm", [0.17, -0.33], 0.055, 0.17, 0.8, false, true);

  const makeUpperJoint = (bodyA, bodyB, anchorA, anchorB, lowerAngle, upperAngle, maxTorque) => {
    const joint = world.createJoint(planck.RevoluteJoint({
      localAnchorA: Vec2(anchorA[0], anchorA[1]),
      localAnchorB: Vec2(anchorB[0], anchorB[1]),
      enableMotor: true,
      enableLimit: true,
      lowerAngle,
      upperAngle,
      maxMotorTorque: maxTorque,
      referenceAngle: 0,
      collideConnected: false
    }, bodyA, bodyB));
    return joint;
  };
  const upperJoints = {
    neck: makeUpperJoint(hull, head, [0, 0.29], [0, -0.18], -0.8, 0.8, 1),
    leftShoulder: makeUpperJoint(hull, leftUpperArm, [-0.17, 0.22], [0, 0.19], -2.35, 1.5, 1),
    leftElbow: makeUpperJoint(leftUpperArm, leftLowerArm, [0, -0.19], [0, 0.17], -2.45, 2.45, 0.8),
    rightShoulder: makeUpperJoint(hull, rightUpperArm, [0.17, 0.22], [0, 0.19], -1.5, 2.35, 1),
    rightElbow: makeUpperJoint(rightUpperArm, rightLowerArm, [0, -0.19], [0, 0.17], -2.45, 2.45, 0.8)
  };

  const legs = [];
  const highSide = heightAt(startX - stanceHalfWidth) >= heightAt(startX + stanceHalfWidth) ? -1 : 1;
  for (const side of [-1, 1]) {
    const targetX = stanceCenterX + side * stanceHalfWidth;
    const ankleTarget = Vec2(targetX, heightAt(targetX) + FOOT_HALF_HEIGHT * 2);
    const actualHip = hull.getWorldPoint(Vec2(side * HIP_X, HIP_Y));
    const hipWorld = actualHip;
    const bend = bendMode === "same-positive" ? 1 : bendMode === "same-negative" ? -1 : bendMode === "slope-adaptive" ? (side === highSide ? highSideBend : lowSideBend) : side;
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
      filterGroupIndex: collisionGroup
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
      filterGroupIndex: collisionGroup
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
      filterGroupIndex: collisionGroup
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

  const bodies = [
    hull, head, leftUpperArm, leftLowerArm, rightUpperArm, rightLowerArm,
    ...legs.flatMap(leg => [leg.upper, leg.lower, leg.foot])
  ];
  const joints = [
    ...Object.values(upperJoints),
    ...legs.flatMap(leg => [leg.hip, leg.knee, leg.ankle])
  ];
  return {
    hull,
    head,
    upperJoints,
    bodies,
    joints,
    legs,
    stanceTargets: [stanceCenterX - stanceHalfWidth, stanceCenterX + stanceHalfWidth],
    stanceHalfWidth,
    pelvisRatio,
    terrainTiltBlend,
    stanceCenterBlend,
    mode: "active",
    stiffness: 1,
    limpElapsed: 0,
    falling: false,
    recovering: false,
    recoveryElapsed: 0,
    recoveryStableTime: 0,
    recoverySettleTime: 0,
    noContactTime: 0,
    outsideSupportTime: 0,
    fallReason: null,
    hit(dv = Vec2(0, 0)) {
      this.mode = "limp";
      this.stiffness = 0;
      this.falling = false;
      this.recovering = false;
      this.recoverySettleTime = 0;
      this.fallReason = "hit";
      for (const joint of this.joints) {
        joint.setMotorSpeed(0);
        joint.setMaxMotorTorque(0);
      }
      this.hull.applyLinearImpulse(
        Vec2(dv.x * this.hull.getMass(), dv.y * this.hull.getMass()),
        this.hull.getWorldCenter(),
        true
      );
    }
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

function footContactNormals(foot) {
  const normals = [];
  for (let edge = foot.getContactList(); edge; edge = edge.next) {
    const contact = edge.contact;
    if (!contact.isTouching()) continue;
    const fixtureA = contact.getFixtureA();
    const fixtureB = contact.getFixtureB();
    const bodyA = fixtureA.getBody();
    const bodyB = fixtureB.getBody();
    if (bodyA !== foot && bodyB !== foot) continue;
    const other = bodyA === foot ? bodyB : bodyA;
    if (!other.isStatic()) continue;
    const manifold = contact.getWorldManifold(null);
    if (!manifold?.normal) continue;
    const sign = bodyA === foot ? -1 : 1;
    normals.push(Vec2(manifold.normal.x * sign, manifold.normal.y * sign));
  }
  return normals;
}

function rigSupportBounds(walker) {
  const planted = walker.legs.filter(leg => isGroundContact(leg.foot));
  if (!planted.length) return null;
  const bounds = planted.map(leg => {
    const foot = leg.foot;
    const angle = foot.getAngle();
    const halfSpan = Math.abs(Math.cos(angle)) * FOOT_HALF_LENGTH +
      Math.abs(Math.sin(angle)) * FOOT_HALF_HEIGHT;
    return {
      min: foot.getPosition().x - halfSpan,
      max: foot.getPosition().x + halfSpan
    };
  });
  // During a commanded step, include the swing foot's committed landing
  // patch in the recoverable support envelope. The foot target is held until
  // contact, so this is a real planned corrective step, not a chasing target.
  if (walker.swingIndex !== undefined && walker.swingIndex !== null) {
    const targetX = walker.stanceTargets[walker.swingIndex];
    bounds.push({ min: targetX - FOOT_HALF_LENGTH, max: targetX + FOOT_HALF_LENGTH });
  }
  return {
    min: Math.min(...bounds.map(bound => bound.min)),
    max: Math.max(...bounds.map(bound => bound.max))
  };
}

function updateRigFallState(walker, deltaTime = FIXED_DT, jumping = false) {
  if (walker.mode === "limp") {
    walker.limpElapsed += deltaTime;
    walker.stiffness = 0;
    return { mode: walker.mode, stiffness: walker.stiffness, reason: walker.fallReason };
  }

  const normals = walker.legs.flatMap(leg => footContactNormals(leg.foot));
  const badContact = normals.some(normal => {
    // Only upward-facing normals represent a foot supporting the character.
    // Toe/heel side contacts against terrain edges are not support normals.
    if (normal.y <= 0.2) return false;
    const angleFromVertical = Math.atan2(Math.abs(normal.x), normal.y);
    return angleFromVertical > 50 * Math.PI / 180;
  });
  const contacts = walker.legs.map(leg => isGroundContact(leg.foot));
  const anyContact = contacts.some(Boolean);
  walker.noContactTime = anyContact || jumping ? 0 : walker.noContactTime + deltaTime;

  const support = rigSupportBounds(walker);
  const centerX = getRigCenterOfMassX(walker);
  // A moving biped can briefly project its COM beyond the planted foot while
  // transferring weight. Judge the predicted COM over the fall-detection
  // horizon so a corrective step that is already carrying it back is not
  // misclassified as an unrecoverable fall.
  const predictedCenterX = centerX + walker.hull.getLinearVelocity().x * 0.25;
  const outsideSupport = support !== null &&
    (predictedCenterX < support.min - 0.04 || predictedCenterX > support.max + 0.04);
  walker.outsideSupportTime = outsideSupport ? walker.outsideSupportTime + deltaTime : 0;

  const torsoTilt = Math.abs(wrapAngle(walker.hull.getAngle()));
  let reason = null;
  if (badContact) reason = "foot-normal";
  else if (torsoTilt > Math.PI / 3) reason = "torso-tilt";
  else if (walker.outsideSupportTime > 0.25) reason = "outside-support";
  else if (!jumping && walker.noContactTime > 0.3) reason = "no-foot-contact";

  if (reason && !walker.falling) {
    walker.falling = true;
    walker.fallReason = reason;
    walker.limpElapsed = 0;
  }
  if (walker.falling) {
    walker.limpElapsed += deltaTime;
    walker.stiffness = Math.max(0, 1 - walker.limpElapsed / 0.1);
    if (walker.stiffness <= 0) walker.mode = "limp";
  }
  return { mode: walker.mode, stiffness: walker.stiffness, reason: walker.fallReason };
}

function hasRigGroundContact(walker) {
  return walker.bodies.some(body => {
    for (let edge = body.getContactList(); edge; edge = edge.next) {
      if (!edge.contact.isTouching()) continue;
      const a = edge.contact.getFixtureA().getBody();
      const b = edge.contact.getFixtureB().getBody();
      if ((a === body && b.isStatic()) || (b === body && a.isStatic())) return true;
    }
    return false;
  });
}

function rigIsStable(walker) {
  const support = rigSupportBounds(walker);
  if (!support || !walker.legs.some(leg => isGroundContact(leg.foot))) return false;
  if (Math.abs(wrapAngle(walker.hull.getAngle())) > 0.22) return false;
  const centerX = getRigCenterOfMassX(walker);
  if (centerX < support.min - 0.04 || centerX > support.max + 0.04) return false;
  return walker.bodies.every(body =>
    body.getLinearVelocity().length() < 0.55 &&
    Math.abs(body.getAngularVelocity()) < 1.5
  );
}

function recoveryAssistForce(mass, heightError, gravity = GRAVITY, hasFootContact = true) {
  if (!hasFootContact) return 0;
  return Math.max(0, Math.min(1.3 * mass * gravity, heightError * mass * 8));
}

function updateRigRecovery(walker, deltaTime = FIXED_DT, heightAt = () => 0) {
  if (walker.mode !== "limp") {
    return { mode: walker.mode, recovering: false, stiffness: walker.stiffness, stable: rigIsStable(walker) };
  }

  if (!walker.recovering) {
    const averageSpeed = walker.bodies.reduce(
      (sum, body) => sum + body.getLinearVelocity().length(), 0
    ) / walker.bodies.length;
    const grounded = hasRigGroundContact(walker);
    walker.recoverySettleTime = averageSpeed < 1 && grounded
      ? walker.recoverySettleTime + deltaTime
      : 0;
    if (walker.recoverySettleTime >= 0.2) {
      walker.recovering = true;
      walker.recoveryElapsed = 0;
      walker.recoveryStableTime = 0;
    }
    return {
      mode: walker.mode, recovering: walker.recovering,
      stiffness: walker.stiffness, stable: false
    };
  }

  walker.recoveryElapsed += deltaTime;
  walker.stiffness = Math.min(1, walker.recoveryElapsed / 0.5);
  const stable = rigIsStable(walker);
  walker.recoveryStableTime = stable ? walker.recoveryStableTime + deltaTime : 0;
  if (walker.recoveryStableTime >= 0.3) {
    walker.mode = "active";
    walker.stiffness = 1;
    walker.recovering = false;
    walker.falling = false;
    walker.fallReason = null;
    walker.noContactTime = 0;
    walker.outsideSupportTime = 0;
  } else if (walker.recoveryElapsed > 3 && !stable) {
    const footContact = walker.legs.some(leg => isGroundContact(leg.foot));
    if (footContact) {
      const lowestFootY = Math.min(
        ...walker.legs.map(leg => heightAt(walker.stanceTargets[walker.legs.indexOf(leg)]))
      );
      const targetY = lowestFootY + FOOT_HALF_HEIGHT * 2 +
        walker.pelvisRatio * (UPPER_LENGTH + LOWER_LENGTH) - HIP_Y;
      const heightError = targetY - walker.hull.getPosition().y;
      const force = recoveryAssistForce(walker.hull.getMass(), heightError, GRAVITY, footContact);
      if (force > 0) walker.hull.applyForceToCenter(Vec2(0, force), true);
    }
  }
  return {
    mode: walker.mode, recovering: walker.recovering,
    stiffness: walker.stiffness, stable
  };
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

    function getRigCenterOfMassX(walker) {
  const bodies = walker.bodies ?? [walker.hull, ...walker.legs.flatMap(leg => [leg.upper, leg.lower, leg.foot])];
  let weightedX = 0;
  let totalMass = 0;
  for (const body of bodies) {
    const mass = body.getMass();
    weightedX += body.getWorldCenter().x * mass;
    totalMass += mass;
  }
  return totalMass > 0 ? weightedX / totalMass : walker.hull.getPosition().x;
}

    function stanceController(walker, heightAt, terrainAngleAt, stiffness = 1, balanceKp = 1.5, balanceKd = 0.06, ankleTorqueMax = 1.5, stepReach = 0.18, stepLookahead = 0.25, hipTorqueMax = 4, kneeTorqueMax = 4, swingHeight = 0.12, swingDuration = 0.2, stanceTorqueScale = 1, hipHeightBlend = 1, upperBodyTorqueScale = 1) {
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
    const progress = swing ? Math.min(1, (walker.swingTime || 0) / swingDuration) : 0;
    const lift = swing ? Math.sin(progress * Math.PI) * swingHeight : 0;
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
    const swing = walker.swingIndex === i;
    const legStiffness = stiffness * (swing ? 1 : stanceTorqueScale);
    const surfaceY = heightAt(target.x);
    const terrainAngle = terrainAngleAt(target.x);
    // Keep the swing lift calculated above. The IK target is the ankle joint
    // anchor (the top of the foot), so its planted height is surface + 2h.
    const actualHip = hull.getWorldPoint(Vec2(leg.side * HIP_X, HIP_Y));
    // Keep the IK target tied to the stance pelvis-height reference.
    const virtualHipY = pelvisTargetY + leg.side * HIP_X * Math.sin(hull.getAngle());
    const hipWorld = Vec2(
      actualHip.x,
      actualHip.y + (virtualHipY - actualHip.y) * hipHeightBlend
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
    driveJoint(leg.hip, hipTarget, 13, 4, hipTorqueMax, legStiffness);
    driveJoint(leg.knee, kneeTarget, 15, 5, kneeTorqueMax, legStiffness);

    const desiredFootAngle = terrainAngle;
    const ankleTargetAngle = wrapAngle(desiredFootAngle - leg.lower.getAngle());
    ankleTargets.push(ankleTargetAngle);
    driveJoint(leg.ankle, ankleTargetAngle, 12, 3, ankleTorqueMax, legStiffness);
  }

  // Keep the head and arms in a neutral, articulated carry pose. These joints
  // use the same bounded motor driver as the lower body.
  for (const [name, joint] of Object.entries(walker.upperJoints ?? {})) {
    const torque = (name === "neck" ? 1 : name.includes("Shoulder") ? 0.9 : 0.7) * upperBodyTorqueScale;
    driveJoint(joint, 0, 8, 4, torque, stiffness);
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

    return {
      createStanceRig,
      stanceController,
      updateRigFallState,
      updateRigRecovery,
      rigIsStable,
      recoveryAssistForce,
      hasRigGroundContact,
      footContactNormals,
      getRigCenterOfMassX,
      legIK,
      driveJoint,
      isGroundContact,
      constants: {
        torsoHalfWidth: TORSO_HALF_WIDTH,
        torsoHalfHeight: TORSO_HALF_HEIGHT,
        hipX: HIP_X,
        hipY: HIP_Y,
        upperLength: UPPER_LENGTH,
        lowerLength: LOWER_LENGTH,
        footHalfLength: FOOT_HALF_LENGTH,
        footHalfHeight: FOOT_HALF_HEIGHT
      }
    };
  }

  return { create };
});
