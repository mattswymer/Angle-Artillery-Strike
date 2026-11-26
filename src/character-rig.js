(() => {
  "use strict";

  const LEG_UPPER = 0.41;
  const LEG_LOWER = 0.34;

  const wrapAngle = angle => {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  };

  function driveJoint(joint, target, kp, wMax, tauMax, stiffness) {
    const error = wrapAngle(target - joint.getJointAngle());
    joint.setMotorSpeed(Math.max(-wMax, Math.min(wMax, kp * error)));
    joint.setMaxMotorTorque(tauMax * stiffness);
  }

  function legIK(hip, foot, bend) {
    const dx = foot.x - hip.x;
    const dy = foot.y - hip.y;
    const rawDistance = Math.hypot(dx, dy);
    const distance = Math.max(Math.abs(LEG_UPPER - LEG_LOWER) + 0.001,
      Math.min(rawDistance, (LEG_UPPER + LEG_LOWER) * 0.999));
    const direction = Math.atan2(dy, dx);
    const hipCos = Math.max(-1, Math.min(1,
      (LEG_UPPER * LEG_UPPER + distance * distance - LEG_LOWER * LEG_LOWER) /
      (2 * LEG_UPPER * distance)));
    const kneeCos = Math.max(-1, Math.min(1,
      (LEG_UPPER * LEG_UPPER + LEG_LOWER * LEG_LOWER - distance * distance) /
      (2 * LEG_UPPER * LEG_LOWER)));
    const hipOffset = Math.acos(hipCos);
    const kneeInterior = Math.acos(kneeCos);
    const thighDirection = direction + bend * hipOffset;
    const knee = {
      x: hip.x + Math.cos(thighDirection) * LEG_UPPER,
      y: hip.y + Math.sin(thighDirection) * LEG_UPPER
    };
    const thighAngle = thighDirection + Math.PI / 2;
    const kneeRelative = bend * (Math.PI - kneeInterior);
    const shinAngle = thighAngle + kneeRelative;
    return {
      knee,
      thighAngle,
      shinAngle,
      kneeRelative,
      distance: rawDistance
    };
  }

  function buildRig(Planck, world, team, number, origin, options = {}) {
    const V = Planck.Vec2;
    const pieces = [];
    const byName = Object.create(null);
    const collisionGroup = -((team * 4) + number);
    const footTargets = options.footTargets || [
      { x: origin.x - 0.18, y: origin.y - 0.9625, angle: 0 },
      { x: origin.x + 0.18, y: origin.y - 0.9625, angle: 0 }
    ];

    function addPart(name, position, angle, halfWidth, halfHeight, density, circle = false, friction = 0.55) {
      const body = world.createBody({
        type: "dynamic",
        position: V(position.x, position.y),
        angle,
        linearDamping: 0.04,
        angularDamping: 0.08,
        allowSleep: false,
        userData: { kind: "character", team, number, rigPart: name }
      });
      const isArm = name.includes("lower-arm");
      const fixture = body.createFixture({
        shape: circle ? new Planck.Circle(halfWidth) : new Planck.Box(halfWidth, halfHeight),
        density,
        friction: isArm ? 0.35 : friction,
        restitution: 0.02,
        filterGroupIndex: collisionGroup,
        isSensor: isArm
      });
      fixture.setUserData({
        kind: "character",
        location: name === "head" ? "head" : name.includes("leg") || name.includes("foot") ? "legs" : "chest",
        rigPart: name
      });
      const piece = { name, body, fixture, halfWidth, halfHeight, circle };
      pieces.push(piece);
      byName[name] = piece;
      return body;
    }

    const torsoAngle = options.torsoAngle || 0;
    const torso = addPart("torso", origin, torsoAngle, 0.17, 0.29, 1.5);
    const headPosition = { x: origin.x, y: origin.y + 0.47 };
    addPart("head", headPosition, torsoAngle, 0.135, 0.135, 1.05, true);
    addPart("left-upper-arm", { x: origin.x - 0.17, y: origin.y + 0.03 }, torsoAngle, 0.065, 0.19, 0.8);
    addPart("left-lower-arm", { x: origin.x - 0.17, y: origin.y - 0.33 }, torsoAngle, 0.055, 0.17, 0.8);
    addPart("right-upper-arm", { x: origin.x + 0.17, y: origin.y + 0.03 }, torsoAngle, 0.065, 0.19, 0.8);
    addPart("right-lower-arm", { x: origin.x + 0.17, y: origin.y - 0.33 }, torsoAngle, 0.055, 0.17, 0.8);

    const hipLeft = torso.getWorldPoint(V(-0.105, -0.25));
    const hipRight = torso.getWorldPoint(V(0.105, -0.25));
    const leftLeg = legIK(hipLeft, footTargets[0], 1);
    const rightLeg = legIK(hipRight, footTargets[1], -1);

    function placeLeg(side, hip, target, solved) {
      const upperCenter = {
        x: (hip.x + solved.knee.x) * 0.5,
        y: (hip.y + solved.knee.y) * 0.5
      };
      const lowerCenter = {
        x: (solved.knee.x + target.x) * 0.5,
        y: (solved.knee.y + target.y) * 0.5
      };
      addPart(side + "-upper-leg", upperCenter, solved.thighAngle, 0.075, 0.205, 1.15, false, 0.88);
      addPart(side + "-lower-leg", lowerCenter, solved.shinAngle, 0.06, 0.17, 1.1, false, 0.88);
      const footAngle = target.angle || 0;
      const footCenter = {
        x: target.x + Math.sin(footAngle) * 0.03,
        y: target.y - Math.cos(footAngle) * 0.03
      };
      addPart(side + "-foot", footCenter, footAngle, 0.09, 0.03, 0.55, false, 0.9);
    }

    placeLeg("left", hipLeft, footTargets[0], leftLeg);
    placeLeg("right", hipRight, footTargets[1], rightLeg);

    function hinge(bodyA, bodyB, anchorA, anchorB, lower, upper) {
      const worldA = bodyA.getWorldPoint(V(anchorA[0], anchorA[1]));
      const worldB = bodyB.getWorldPoint(V(anchorB[0], anchorB[1]));
      const mismatch = Math.hypot(worldA.x - worldB.x, worldA.y - worldB.y);
      if (mismatch > 0.003) {
        throw new Error("Rig joint anchors do not align (" + mismatch.toFixed(5) + ")");
      }
      return world.createJoint(new Planck.RevoluteJoint({
        enableLimit: true,
        lowerAngle: lower,
        upperAngle: upper,
        referenceAngle: 0,
        collideConnected: false
      }, bodyA, bodyB, worldA));
    }

    const jointMap = {
      neck: hinge(torso, byName.head.body, [0, 0.29], [0, -0.18], -0.8, 0.8),
      leftShoulder: hinge(torso, byName["left-upper-arm"].body, [-0.17, 0.22], [0, 0.19], -2.35, 1.5),
      leftElbow: hinge(byName["left-upper-arm"].body, byName["left-lower-arm"].body, [0, -0.19], [0, 0.17], -2.45, 2.45),
      rightShoulder: hinge(torso, byName["right-upper-arm"].body, [0.17, 0.22], [0, 0.19], -1.5, 2.35),
      rightElbow: hinge(byName["right-upper-arm"].body, byName["right-lower-arm"].body, [0, -0.19], [0, 0.17], -2.45, 2.45),
      leftHip: hinge(torso, byName["left-upper-leg"].body, [-0.105, -0.25], [0, 0.205], -1.25, 1.25),
      leftKnee: hinge(byName["left-upper-leg"].body, byName["left-lower-leg"].body, [0, -0.205], [0, 0.17], -0.25, 2.2),
      leftAnkle: hinge(byName["left-lower-leg"].body, byName["left-foot"].body, [0, -0.17], [0, 0.03], -0.6, 0.6),
      rightHip: hinge(torso, byName["right-upper-leg"].body, [0.105, -0.25], [0, 0.205], -1.25, 1.25),
      rightKnee: hinge(byName["right-upper-leg"].body, byName["right-lower-leg"].body, [0, -0.205], [0, 0.17], -2.2, 0.25),
      rightAnkle: hinge(byName["right-lower-leg"].body, byName["right-foot"].body, [0, -0.17], [0, 0.03], -0.6, 0.6)
    };
    const joints = Object.values(jointMap);
    const initialTargets = Object.fromEntries(
      Object.entries(jointMap).map(([name, joint]) => [name, joint.getJointAngle()])
    );

    const rig = {
      team,
      number,
      mode: "active",
      stiffness: 1,
      pieces,
      byName,
      torso,
      footBodies: [byName["left-foot"].body, byName["right-foot"].body],
      jointMap,
      joints,
      initialTargets,
      hit(dv = null) {
        this.mode = "limp";
        this.stiffness = 0;
        for (const joint of this.joints) joint.setMaxMotorTorque(0);
        if (dv) {
          for (const piece of this.pieces) {
            const v = piece.body.getLinearVelocity();
            piece.body.setLinearVelocity(V(v.x + dv.x, v.y + dv.y));
            piece.body.setAwake(true);
          }
        }
      },
      setStiffness(value) {
        this.stiffness = Math.max(0, Math.min(1, value));
        this.mode = this.stiffness > 0 ? "active" : "limp";
      },
      driveJoint
    };

    for (const [name, joint] of Object.entries(jointMap)) {
      joint.enableMotor(true);
      const isLeg = name.includes("Hip") || name.includes("Knee");
      const isAnkle = name.includes("Ankle");
      driveJoint(joint, initialTargets[name], isLeg ? 14 : 8, 8,
        isLeg ? 4 : isAnkle ? 1.5 : 1, rig.stiffness);
    }

    return rig;
  }

  const root = typeof window !== "undefined" ? window : globalThis;
  root.CharacterRig = { buildRig, driveJoint, wrapAngle, legIK, LEG_UPPER, LEG_LOWER };
})();