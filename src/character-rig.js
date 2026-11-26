(() => {
  "use strict";

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

  function buildRig(Planck, world, team, number, origin, options = {}) {
    const V = Planck.Vec2;
    const pieces = [];
    const byName = Object.create(null);
    const collisionGroup = -((team * 4) + number);
    const velocity = options.velocity || V(0, 0);

    function addPart(name, x, y, halfWidth, halfHeight, density, circle = false) {
      const body = world.createBody({
        type: "dynamic",
        position: V(origin.x + x, origin.y + y),
        linearDamping: 0.04,
        angularDamping: 0.08,
        allowSleep: false,
        userData: { kind: "character", team, number, rigPart: name }
      });
      const isArm = name.includes("lower-arm");
      const isLeg = name.includes("lower-leg");
      const fixture = body.createFixture({
        shape: circle ? new Planck.Circle(halfWidth) : new Planck.Box(halfWidth, halfHeight),
        density,
        friction: isLeg ? 0.88 : isArm ? 0.35 : 0.55,
        restitution: 0.02,
        filterGroupIndex: collisionGroup,
        isSensor: isArm
      });
      fixture.setUserData({
        kind: "character",
        location: name === "head" ? "head" : name.includes("leg") ? "legs" : "chest",
        rigPart: name
      });
      body.setLinearVelocity(velocity);
      const piece = { name, body, fixture, halfWidth, halfHeight, circle };
      pieces.push(piece);
      byName[name] = piece;
      return body;
    }

    const torso = addPart("torso", 0, 0, 0.17, 0.29, 1.5);
    addPart("head", 0, 0.47, 0.135, 0.135, 1.05, true);
    addPart("left-upper-arm", -0.17, 0.03, 0.065, 0.19, 0.8);
    addPart("left-lower-arm", -0.17, -0.33, 0.055, 0.17, 0.8);
    addPart("right-upper-arm", 0.17, 0.03, 0.065, 0.19, 0.8);
    addPart("right-lower-arm", 0.17, -0.33, 0.055, 0.17, 0.8);
    addPart("left-upper-leg", -0.105, -0.455, 0.075, 0.205, 1.15);
    addPart("left-lower-leg", -0.105, -0.83, 0.06, 0.17, 1.1);
    addPart("right-upper-leg", 0.105, -0.455, 0.075, 0.205, 1.15);
    addPart("right-lower-leg", 0.105, -0.83, 0.06, 0.17, 1.1);

    function hinge(bodyA, bodyB, anchorA, anchorB, lower, upper) {
      const worldA = bodyA.getWorldPoint(V(anchorA[0], anchorA[1]));
      const worldB = bodyB.getWorldPoint(V(anchorB[0], anchorB[1]));
      const mismatch = Math.hypot(worldA.x - worldB.x, worldA.y - worldB.y);
      if (mismatch > 0.002) {
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
      rightHip: hinge(torso, byName["right-upper-leg"].body, [0.105, -0.25], [0, 0.205], -1.25, 1.25),
      rightKnee: hinge(byName["right-upper-leg"].body, byName["right-lower-leg"].body, [0, -0.205], [0, 0.17], -2.2, 0.25)
    };
    const joints = Object.values(jointMap);

    const rig = {
      team,
      number,
      mode: "active",
      stiffness: 1,
      pieces,
      byName,
      torso,
      jointMap,
      joints,
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
      driveJoint(joint, 0, isLeg ? 14 : 8, 8, isLeg ? 4 : 1, rig.stiffness);
    }

    return rig;
  }

  window.CharacterRig = { buildRig, driveJoint, wrapAngle };
})();