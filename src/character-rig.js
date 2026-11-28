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
      bullet: true,
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
      bullet: true,
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
      bullet: true,
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
      bullet: true,
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
      bullet: true,
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
  const byName = {
    torso: { body: hull },
    head: { body: head },
    "left-upper-arm": { body: leftUpperArm },
    "left-lower-arm": { body: leftLowerArm },
    "right-upper-arm": { body: rightUpperArm },
    "right-lower-arm": { body: rightLowerArm }
  };
  const pieces = [
    { name: "torso", body: hull, halfWidth: TORSO_HALF_WIDTH, halfHeight: TORSO_HALF_HEIGHT },
    { name: "head", body: head, halfWidth: 0.135, halfHeight: 0.135, circle: true },
    { name: "left-upper-arm", body: leftUpperArm, halfWidth: 0.065, halfHeight: 0.19 },
    { name: "left-lower-arm", body: leftLowerArm, halfWidth: 0.055, halfHeight: 0.17 },
    { name: "right-upper-arm", body: rightUpperArm, halfWidth: 0.065, halfHeight: 0.19 },
    { name: "right-lower-arm", body: rightLowerArm, halfWidth: 0.055, halfHeight: 0.17 }
  ];
  for (const leg of legs) {
    const prefix = leg.side < 0 ? "left" : "right";
    byName[`${prefix}-upper-leg`] = { body: leg.upper };
    byName[`${prefix}-lower-leg`] = { body: leg.lower };
    byName[`${prefix}-foot`] = { body: leg.foot };
    pieces.push(
      { name: `${prefix}-upper-leg`, body: leg.upper, halfWidth: UPPER_HALF_WIDTH, halfHeight: UPPER_LENGTH / 2 },
      { name: `${prefix}-lower-leg`, body: leg.lower, halfWidth: LOWER_HALF_WIDTH, halfHeight: LOWER_LENGTH / 2 },
      { name: `${prefix}-foot`, body: leg.foot, halfWidth: FOOT_HALF_LENGTH, halfHeight: FOOT_HALF_HEIGHT }
    );
  }
  const jointMap = {
    ...upperJoints,
    leftHip: legs[0].hip,
    leftKnee: legs[0].knee,
    leftAnkle: legs[0].ankle,
    rightHip: legs[1].hip,
    rightKnee: legs[1].knee,
    rightAnkle: legs[1].ankle
  };
  return {
    hull,
    torso: hull,
    head,
    upperJoints,
    jointMap,
    byName,
    pieces,
    bodies,
    joints,
    legs,
    ragdollTerrainFixtures: [leftLowerArm.getFixtureList(), rightLowerArm.getFixtureList()],
    stanceTargets: [stanceCenterX - stanceHalfWidth, stanceCenterX + stanceHalfWidth],
    stanceHalfWidth,
    pelvisRatio,
    terrainTiltBlend,
    stanceCenterBlend,
    mode: "active",
    stiffness: 1,
    stableTime: 0,
    walkDirection: 0,
    walkSpeed: 1.2,
    walkingPelvisRatio: 0.84,
    nextSwingIndex: 0,
    jumpPhase: "idle",
    jumpElapsed: 0,
    jumpAirborne: false,
    jumpLandContactTime: 0,
    jumping: false,
    limpElapsed: 0,
    falling: false,
    recovering: false,
    recoveryElapsed: 0,
    recoveryProgress: 0,
    recoveryPelvisRatio: pelvisRatio,
    recoveryStableTime: 0,
    recoverySettleTime: 0,
    recoveryGroundTime: 0,
    noContactTime: 0,
    outsideSupportTime: 0,
    fallReason: null,
    hit(dv = Vec2(0, 0), targetBody = this.hull, impactPoint = null) {
      setRagdollTerrainCollision(this, true);
      this.mode = "limp";
      this.stiffness = 0;
      this.falling = false;
      this.recovering = false;
      this.recoverySettleTime = 0;
      this.recoveryGroundTime = 0;
      this.walkDirection = 0;
      this.jumpPhase = "idle";
      this.jumpAirborne = false;
      this.jumpLandContactTime = 0;
      this.jumping = false;
      this.fallReason = "hit";
      for (const joint of this.joints) {
        joint.setMotorSpeed(0);
        joint.setMaxMotorTorque(0);
      }
      const mass = targetBody.getMass();
      targetBody.applyLinearImpulse(
        Vec2(dv.x * mass, dv.y * mass),
        impactPoint || targetBody.getWorldCenter(),
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
  // The two committed stance targets define the support envelope while a
  // foot is transferring. They are fixed landing/stance locations, not a
  // continuously chasing COM target; include them alongside actual contact
  // patches so single-support gait phases are not mistaken for a fall.
  for (const targetX of walker.stanceTargets) {
    bounds.push({ min: targetX - FOOT_HALF_LENGTH, max: targetX + FOOT_HALF_LENGTH });
  }
  return {
    min: Math.min(...bounds.map(bound => bound.min)),
    max: Math.max(...bounds.map(bound => bound.max))
  };
}

function setRagdollTerrainCollision(walker, solid) {
  for (const fixture of walker.ragdollTerrainFixtures || []) {
    fixture.setSensor(!solid);
  }
}

function updateRigFallState(walker, deltaTime = FIXED_DT, jumping = false) {
  if (walker.mode === "limp") {
    setRagdollTerrainCollision(walker, true);
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
  // An intentional jump has no planted support while airborne. Do not
  // interpret the expected COM/support separation as an uncontrolled fall.
  walker.outsideSupportTime = jumping
    ? 0
    : (outsideSupport ? walker.outsideSupportTime + deltaTime : 0);

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
    if (walker.stiffness <= 0) {
      walker.mode = "limp";
      setRagdollTerrainCollision(walker, true);
    }
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
  // Stable means the main mass is upright, supported, and no longer moving
  // fast enough to make a turn unsafe. Arms and free limbs may still settle;
  // requiring every segment to be nearly motionless caused false lockouts.
  if (Math.abs(wrapAngle(walker.hull.getAngle())) > 0.35) return false;
  const hullVelocity = walker.hull.getLinearVelocity();
  if (hullVelocity.length() > 1.3 || Math.abs(walker.hull.getAngularVelocity()) > 2) return false;
  const centerX = getRigCenterOfMassX(walker);
  if (centerX < support.min - 0.04 || centerX > support.max + 0.04) return false;
  return walker.legs.some(leg => isGroundContact(leg.foot) &&
    leg.foot.getLinearVelocity().length() < 1.5 &&
    Math.abs(leg.foot.getAngularVelocity()) < 2.5
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
    // A ragdoll can keep jittering against uneven terrain forever. Track
    // grounded time separately so contact jitter cannot permanently prevent
    // the get-up controller from engaging.
    walker.recoveryGroundTime = grounded
      ? walker.recoveryGroundTime + deltaTime
      : 0;
    walker.recoverySettleTime = averageSpeed < 1.5 && grounded
      ? walker.recoverySettleTime + deltaTime
      : 0;
    const settledEnough = walker.recoverySettleTime >= 0.18;
    const groundedTimeout = walker.recoveryGroundTime >= 0.75;
    if (settledEnough || groundedTimeout) {
      walker.recovering = true;
      walker.recoveryElapsed = 0;
      walker.recoveryProgress = 0;
      walker.recoveryPelvisRatio = Math.min(walker.pelvisRatio, 0.72);
      walker.recoveryStableTime = 0;
      // Rebuild the get-up stance around where the feet actually landed.
      walker.stanceTargets = walker.legs.map(leg => leg.foot.getPosition().x);
      walker.swingIndex = null;
      walker.swingTime = 0;
      walker.swingAirborne = false;
    }
    return {
      mode: walker.mode, recovering: walker.recovering,
      stiffness: walker.stiffness, stable: false
    };
  }

  walker.recoveryElapsed += deltaTime;
  const smoothStep = value => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  };
  walker.recoveryProgress = smoothStep(walker.recoveryElapsed / 0.95);
  walker.recoveryPelvisRatio = Math.min(walker.pelvisRatio, 0.72) +
    (walker.pelvisRatio - Math.min(walker.pelvisRatio, 0.72)) * walker.recoveryProgress;
  walker.stiffness = smoothStep(walker.recoveryElapsed / 0.85);
  const stable = rigIsStable(walker);
  walker.recoveryStableTime = stable ? walker.recoveryStableTime + deltaTime : 0;
  if (walker.recoveryStableTime >= 0.3) {
    walker.mode = "active";
    setRagdollTerrainCollision(walker, false);
    walker.stiffness = 1;
    walker.recovering = false;
    walker.falling = false;
    walker.fallReason = null;
    walker.noContactTime = 0;
    walker.outsideSupportTime = 0;
    walker.recoveryGroundTime = 0;
    walker.recoverySettleTime = 0;
    walker.recoveryProgress = 1;
    walker.recoveryPelvisRatio = walker.pelvisRatio;
  } else if (walker.recoveryElapsed > 0.12 && !stable) {
    const rightingT = Math.max(0, Math.min(1, (walker.recoveryElapsed - 0.12) / 0.55));
    const rightingBlend = rightingT * rightingT * (3 - 2 * rightingT);
    // A limp rig cannot get up by asking the normal walking IK to solve a
    // sideways or inverted pelvis. Give the torso a bounded physical righting
    // torque first; joint motors then bring the limbs back under it.
    const angleError = wrapAngle(walker.hull.getAngle());
    const angularVelocity = walker.hull.getAngularVelocity();
    const mass = walker.hull.getMass();
    const maxTorque = mass * GRAVITY * 0.85 * rightingBlend;
    const requestedTorque = (-angleError * 7 - angularVelocity * 2.2) * mass * rightingBlend;
    const rightingTorque = Math.max(-maxTorque, Math.min(maxTorque, requestedTorque));
    walker.hull.applyTorque(rightingTorque, true);

    // Use any terrain contact as a brace, not only a foot contact. A character
    // lying on its torso/head otherwise never receives the lift needed to
    // bring its pelvis clear of the ground.
    if (hasRigGroundContact(walker)) {
      const stanceX = walker.stanceTargets?.length
        ? walker.stanceTargets
        : walker.legs.map(leg => leg.foot.getPosition().x);
      const targetY = Math.min(...stanceX.map(heightAt)) +
        FOOT_HALF_HEIGHT * 2 + walker.pelvisRatio * (UPPER_LENGTH + LOWER_LENGTH) - HIP_Y;
      const heightError = targetY - walker.hull.getPosition().y;
      const force = recoveryAssistForce(mass, heightError, GRAVITY, true) * rightingBlend;
      if (force > 0.05) walker.hull.applyForceToCenter(Vec2(0, force), true);
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

    function requestJump(walker) {
      if (walker.mode !== "active" || walker.jumpPhase !== "idle") return false;
      if (walker.swingIndex !== undefined && walker.swingIndex !== null) return false;
      if (!walker.legs.every(leg => isGroundContact(leg.foot))) return false;
      walker.jumpPhase = "crouch";
      walker.jumpElapsed = 0;
      walker.jumpAirborne = false;
      walker.jumpLandContactTime = 0;
      walker.jumping = true;
      walker.walkDirection = 0;
      walker.swingIndex = null;
      walker.swingTime = 0;
      walker.swingAirborne = false;
      return true;
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
  if (walker.jumpPhase !== "idle") {
    walker.jumpElapsed += FIXED_DT;
    if (walker.jumpPhase === "crouch" && walker.jumpElapsed >= 0.12) {
      walker.jumpPhase = "extend";
      walker.jumpElapsed = 0;
    } else if (walker.jumpPhase === "extend" && walker.jumpElapsed >= 0.1) {
      // The knee motors create the crouch-to-extension motion. Apply the
      // resulting ground-reaction impulse coherently to every rig body so
      // the articulated character launches as one assembly rather than
      // stretching the torso away from its limbs.
      const launchDeltaV = walker.jumpLaunchDeltaV ?? 2.4;
      for (const body of walker.bodies) {
        body.applyLinearImpulse(
          Vec2(0, body.getMass() * launchDeltaV),
          body.getWorldCenter(),
          true
        );
      }
      walker.jumpPhase = "air";
      walker.jumpElapsed = 0;
    } else if (walker.jumpPhase === "air") {
      if (!contacts.some(Boolean)) walker.jumpAirborne = true;
      if (walker.jumpAirborne && contacts.some(Boolean)) {
        // Preserve the first planted foot's actual landing point and bring the
        // other foot underneath the moving pelvis. Reusing takeoff coordinates
        // can leave both feet reaching behind the body after a long jump.
        // Hold both feet at their actual horizontal positions for the
        // landing phase. The swing foot may still be behind the pelvis after
        // flight; forcing it to a nominal stance offset can make the target
        // unreachable and leave the torso to collapse onto the terrain.
        walker.stanceTargets = walker.legs.map(leg => leg.foot.getPosition().x);
        walker.jumpPhase = "land";
        walker.jumpElapsed = 0;
        walker.jumpLandContactTime = 0;
      }
    } else if (walker.jumpPhase === "land") {
      walker.jumpLandContactTime = contacts.every(Boolean)
        ? walker.jumpLandContactTime + FIXED_DT
        : 0;
      if (walker.jumpLandContactTime >= 0.1) {
        walker.jumpPhase = "idle";
        walker.jumpElapsed = 0;
        walker.jumpAirborne = false;
        walker.jumpLandContactTime = 0;
        walker.jumping = false;
      }
    }
  }

  // During landing, keep an unplanted foot over its current horizontal
  // position and lower it toward the terrain. Once planted, its x target is
  // held, so the second foot can find support without dragging the first.
  if (walker.jumpPhase === "land") {
    for (let i = 0; i < legs.length; i++) {
      if (!contacts[i]) walker.stanceTargets[i] = legs[i].foot.getPosition().x;
    }
  }

  const walkDirection = Math.sign(walker.walkDirection || 0);
  if (walkDirection && contacts.some(Boolean) && walker.jumpPhase === "idle") {
    const terrainAngle = terrainAngleAt(hull.getPosition().x);
    const tangent = Vec2(Math.cos(terrainAngle), Math.sin(terrainAngle));
    const velocity = hull.getLinearVelocity();
    const tangentSpeed = velocity.x * tangent.x + velocity.y * tangent.y;
    const targetSpeed = walkDirection * (walker.walkSpeed || 3.4);
    const desiredForce = (targetSpeed - tangentSpeed) * hull.getMass() * 4;
    const maxForce = hull.getMass() * GRAVITY * 0.3;
    const force = Math.max(-maxForce, Math.min(maxForce, desiredForce));
    hull.applyForceToCenter(Vec2(tangent.x * force, tangent.y * force), true);
  }

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
    if (walkDirection && walker.jumpPhase === "idle" && contacts.some(Boolean)) {
      let swingIndex = walker.nextSwingIndex ?? 0;
      if (!contacts[swingIndex]) swingIndex = 1 - swingIndex;
      if (contacts[swingIndex]) {
        const tangent = terrainAngleAt(hull.getPosition().x);
        const velocity = hull.getLinearVelocity();
        const tangentSpeed = Math.abs(velocity.x * Math.cos(tangent) + velocity.y * Math.sin(tangent));
        const speedRatio = Math.max(0, Math.min(1, tangentSpeed / (walker.walkSpeed || 3.4)));
        const stride = Math.max(stepReach, walker.minimumWalkingStride ?? 0.22) * speedRatio;
        walker.swingIndex = swingIndex;
        walker.swingTime = 0;
        walker.swingAirborne = false;
        walker.stanceTargets[swingIndex] = predictedCenterX + walkDirection * stride;
        walker.nextSwingIndex = 1 - swingIndex;
      }
    } else if (!walkDirection && walker.jumpPhase === "idle") {
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
            walker.stanceTargets[0] = predictedCenterX - stepReach;
        } else if (predictedCenterX > maxFootX + 0.04) {
          walker.swingIndex = 1;
          walker.swingTime = 0;
          walker.swingAirborne = false;
            walker.stanceTargets[1] = predictedCenterX + stepReach;
        }
      }
    }
  }
  const footTargets = walker.stanceTargets.map((x, i) => {
    if (walker.jumpPhase === "air") {
      return {
        x: hull.getPosition().x + legs[i].side * 0.12,
        y: hull.getPosition().y - 0.42
      };
    }
    const swing = walker.swingIndex === i;
    const progress = swing ? Math.min(1, (walker.swingTime || 0) / swingDuration) : 0;
    const lift = swing ? Math.sin(progress * Math.PI) * swingHeight : 0;
    return { x, y: heightAt(x) + FOOT_HALF_HEIGHT * 2 + lift };
  });
  const terrainReferenceAngle = terrainAngleAt(hull.getPosition().x) * (walker.terrainTiltBlend ?? 0);
  const walking = walkDirection !== 0 && walker.jumpPhase === "idle";
  const pelvisRatio = walking
    ? (walker.walkingPelvisRatio ?? 0.82)
    : (walker.recovering
      ? (walker.recoveryPelvisRatio ?? walker.pelvisRatio ?? 0.95)
      : (walker.pelvisRatio ?? 0.95));
  const pelvisTargetY = Math.min(
    heightAt(walker.stanceTargets[0]) + FOOT_HALF_HEIGHT * 2,
    heightAt(walker.stanceTargets[1]) + FOOT_HALF_HEIGHT * 2
  ) + pelvisRatio * (UPPER_LENGTH + LOWER_LENGTH);
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
    // Keep balance feedback corrective but bounded. Large torso angles
    // during a jump landing must not rotate the thighs sideways and prevent
    // the feet from reaching the ground.
    // Hip motors counter-rotate the torso through their reaction torque.
    // Keep this feedback deliberately modest so the stance controller settles
    // instead of continually hunting around its target.
    const rawBalanceCorrection =
      balanceKp * torsoTilt + balanceKd * hull.getAngularVelocity();
    const balanceCorrection = walker.jumpPhase === "idle"
      ? rawBalanceCorrection
      : Math.max(-0.35, Math.min(0.35, rawBalanceCorrection));
    const hipTarget = wrapAngle(
      upperBodyAngle - hull.getAngle() + balanceCorrection
    );
    let kneeTarget = wrapAngle(lowerBodyAngle - upperBodyAngle);
    let kneeTorque = kneeTorqueMax;
    let hipTorque = hipTorqueMax;
    if (walker.jumpPhase === "crouch") {
      kneeTarget = wrapAngle(kneeTarget + leg.bend * 0.5);
    } else if (walker.jumpPhase === "extend") {
      kneeTarget = leg.bend * 0.02;
      kneeTorque = kneeTorqueMax * 2;
    } else if (walker.jumpPhase === "air") {
      kneeTarget = wrapAngle(kneeTarget + leg.bend * 0.4);
    } else if (walker.jumpPhase === "land") {
      // Recover to the normal IK extension after the first contact rather
      // than holding the knees in a permanently deep landing crouch.
      kneeTorque = kneeTorqueMax * 1.5;
      hipTorque = hipTorqueMax * 2;
    }
    hipTargets.push(hipTarget);
    kneeTargets.push(kneeTarget);
    driveJoint(leg.hip, hipTarget, 13, 4, hipTorque, legStiffness);
    driveJoint(leg.knee, kneeTarget, 15, 5, kneeTorque, legStiffness);

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
      requestJump,
      updateRigFallState,
      updateRigRecovery,
      rigIsStable,
      recoveryAssistForce,
      hasRigGroundContact,
      footContactNormals,
      rigSupportBounds,
      getRigCenterOfMassX,
      wrapAngle,
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
