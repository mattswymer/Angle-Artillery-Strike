(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ActiveCharacter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const BODY = Object.freeze({
    radius: 0.19,
    boxHalfWidth: 0.19,
    boxHalfHeight: 0.4,
    boxCenterY: 0.62,
    footCenterY: 0.16,
    height: 1.02,
    walkSpeed: 2.7,
    jumpSpeed: 4.8,
    maxSlopeDegrees: 50,
    maxStepHeight: 0.4,
    snapDistance: 0.46,
    snapDownDistance: 0.42,
    skin: 0.025
  });

  function create(Planck, world, options = {}) {
    const Vec2 = Planck.Vec2;
    const heightAt = options.heightAt || (() => 0);
    const collisionGroup = options.collisionGroup ?? -1;
    const team = options.team ?? 0;
    const number = options.number ?? 1;
    const x = options.x ?? 0;
    const surface = heightAt(x);
    const body = world.createDynamicBody({
      position: Vec2(x, surface + BODY.skin),
      fixedRotation: true,
      bullet: true,
      linearDamping: 0.45,
      angularDamping: 0,
      allowSleep: false,
      userData: { kind: "character", team, number, part: "active-body" }
    });

    const filter = { filterGroupIndex: collisionGroup };
    body.createFixture({
      shape: new Planck.Box(BODY.boxHalfWidth, BODY.boxHalfHeight,
        Vec2(0, BODY.boxCenterY), 0),
      density: 1.8,
      friction: 0.65,
      restitution: 0,
      ...filter,
      userData: { kind: "character", location: "chest", part: "active-body" }
    });
    body.createFixture({
      shape: new Planck.Circle(Vec2(0, BODY.footCenterY), BODY.radius),
      density: 1.8,
      friction: 0.8,
      restitution: 0,
      ...filter,
      userData: { kind: "character", location: "legs", part: "active-foot" }
    });

    let grounded = false;
    let jumpLock = false;
    let gaitPhase = 0;
    let lastGroundY = surface;
    let lockedX = x;
    let facing = team === 0 ? 1 : -1;

    function rayGround(sampleX, originY) {
      const from = Vec2(sampleX, originY + 0.42);
      const to = Vec2(sampleX, originY - 0.58);
      let hit = null;
      world.rayCast(from, to, (fixture, point, normal, fraction) => {
        const data = fixture.getBody().getUserData();
        if (data?.kind !== "terrain") return -1;
        if (Math.abs(normal.y) < Math.cos(BODY.maxSlopeDegrees * Math.PI / 180)) return -1;
        if (!hit || fraction < hit.fraction) {
          const upwardNormal = normal.y < 0 ? Vec2(-normal.x, -normal.y) : Vec2(normal.x, normal.y);
          hit = { x: point.x, y: point.y, normal: upwardNormal, fraction };
        }
        return fraction;
      });
      return hit;
    }

    function snapToGround(direction = 0) {
      const position = body.getPosition();
      // Keep a stable support sample while standing on a slope, but refresh it
      // continuously during a jump so releasing direction cannot snap backward.
      const sampleX = direction === 0 ? lockedX : position.x;
      const centerHit = rayGround(sampleX, position.y);
      if (!centerHit) {
        grounded = false;
        return false;
      }
      let target = centerHit;
      if (direction !== 0) {
        const ahead = rayGround(sampleX + direction * 0.3, position.y);
        if (ahead && ahead.y - centerHit.y <= BODY.maxStepHeight) {
          if (ahead.y > centerHit.y) target = ahead;
        }
      }
      const bottom = position.y + BODY.footCenterY - BODY.radius;
      const gap = target.y - bottom;
      const velocity = body.getLinearVelocity();
      const canSnap = !jumpLock && velocity.y <= 0.65 &&
        gap <= BODY.snapDistance && gap >= -BODY.snapDownDistance;
      if (direction !== 0) lockedX = sampleX;
      if (!canSnap) {
        grounded = false;
        return false;
      }
      const nextY = target.y - BODY.footCenterY + BODY.radius + BODY.skin;
      body.setTransform(Vec2(sampleX, nextY), 0);
      body.setLinearVelocity(Vec2(direction === 0 ? 0 : velocity.x, 0));
      grounded = true;
      lastGroundY = target.y;
      return true;
    }

    function setMove(direction, dt = 1 / 50) {
      direction = Math.max(-1, Math.min(1, Math.sign(direction)));
      if (direction) facing = direction;
      const velocity = body.getLinearVelocity();
      if (direction !== 0) gaitPhase += dt * BODY.walkSpeed * 3.2;
      body.setLinearVelocity(Vec2(direction * BODY.walkSpeed, velocity.y));
      if (!jumpLock) snapToGround(direction);
      return grounded;
    }

    function jump() {
      if (!grounded) return false;
      const velocity = body.getLinearVelocity();
      body.setLinearVelocity(Vec2(velocity.x, BODY.jumpSpeed));
      grounded = false;
      jumpLock = true;
      return true;
    }

    function update(dt = 1 / 50, direction = 0) {
      const velocity = body.getLinearVelocity();
      if (jumpLock) lockedX = body.getPosition().x;
      if (jumpLock && velocity.y <= 0) jumpLock = false;
      if (direction !== null) {
        if (direction === 0) body.setLinearVelocity(Vec2(0, velocity.y));
        else {
          body.setLinearVelocity(Vec2(direction * BODY.walkSpeed, velocity.y));
          lockedX = body.getPosition().x;
        }
      }
      if (!jumpLock) snapToGround(direction || 0);
    }

    function pose() {
      const p = body.getPosition();
      const moving = Math.abs(body.getLinearVelocity().x) > 0.15 && grounded;
      const phase = gaitPhase % (Math.PI * 2);
      const H = 2.16;
      const headRadius = 0.135; // Match the physical ragdoll head exactly.
      const neckLength = H / 16;
      const torsoLength = H * 5 / 16;
      const armLength = H * 3 / 16;
      const legLength = H / 4;
      const direction = facing >= 0 ? 1 : -1;
      const bob = moving ? Math.abs(Math.sin(phase)) * 0.065 : 0;
      const hip = { x: p.x, y: p.y + BODY.skin + legLength * 2 + bob };
      
      // The reference walk is a forward-leaning, alternating two-leg gait.
      // Positive angles swing a limb in the facing direction.
      const torsoLean = 10 - (moving ? Math.sin(phase) * 3 : 0);
      const upperTorso = {
        x: hip.x + direction * Math.sin(torsoLean * Math.PI / 180) * torsoLength,
        y: hip.y + Math.cos(torsoLean * Math.PI / 180) * torsoLength
      };
      const neckTip = {
        x: upperTorso.x + direction * Math.sin((torsoLean - 2) * Math.PI / 180) * neckLength,
        y: upperTorso.y + Math.cos((torsoLean - 2) * Math.PI / 180) * neckLength
      };
      const head = {
        x: neckTip.x + direction * Math.sin((torsoLean - 4) * Math.PI / 180) * headRadius,
        y: neckTip.y + Math.cos((torsoLean - 4) * Math.PI / 180) * headRadius
      };

      const leg = (side, legPhase) => {
        const swing = moving ? Math.sin(legPhase) : 0;
        const hipAngle = swing * 34;
        const kneeBend = moving ? -Math.max(0, Math.cos(legPhase)) * 42 : 0;
        const hipRad = hipAngle * Math.PI / 180;
        const kneeRad = (hipAngle + kneeBend) * Math.PI / 180;
        const knee = {
          x: hip.x + direction * Math.sin(hipRad) * legLength,
          y: hip.y - Math.cos(hipRad) * legLength
        };
        const ankle = {
          x: knee.x + direction * Math.sin(kneeRad) * legLength,
          y: knee.y - Math.cos(kneeRad) * legLength +
            (moving ? Math.max(0, swing) * 0.11 : 0)
        };
        return { knee, foot: ankle };
      };
      const leftLeg = leg(-1, phase);
      const rightLeg = leg(1, phase + Math.PI);

      const arm = (armPhase) => {
        const shoulderAngle = moving ? Math.sin(armPhase) * 30 : 0;
        const elbowBend = 24 + (moving ? Math.max(0, -Math.sin(armPhase)) * 28 : 0);
        const shoulderRad = shoulderAngle * Math.PI / 180;
        const handRad = (shoulderAngle + elbowBend) * Math.PI / 180;
        const elbow = {
          x: upperTorso.x + direction * Math.sin(shoulderRad) * armLength,
          y: upperTorso.y - Math.cos(shoulderRad) * armLength
        };
        const hand = {
          x: elbow.x + direction * Math.sin(handRad) * armLength,
          y: elbow.y - Math.cos(handRad) * armLength
        };
        return { elbow, hand };
      };
      const leftArm = arm(phase);
      const rightArm = arm(phase + Math.PI);

      return {
        x: p.x, y: p.y, facing, grounded, head, headRadius,
        neckTop: neckTip, torsoTop: upperTorso, torso: upperTorso, hips: hip,
        leftFoot: leftLeg.foot, rightFoot: rightLeg.foot,
        leftKnee: leftLeg.knee, rightKnee: rightLeg.knee,
        leftShoulder: upperTorso, rightShoulder: upperTorso,
        leftElbow: leftArm.elbow, rightElbow: rightArm.elbow,
        leftHand: leftArm.hand, rightHand: rightArm.hand
      };
    }

    function applyImpulse(impulse) {
      body.applyLinearImpulse(impulse, body.getWorldCenter(), true);
      grounded = false;
    }

    function destroy() {
      if (body.getWorld()) world.destroyBody(body);
    }

    return {
      body, grounded: () => grounded, setMove, jump, update, snapToGround,
      pose, applyImpulse, destroy, get lastGroundY() { return lastGroundY; },
      get facing() { return facing; }, get mode() { return "active"; }
    };
  }

  return { create, BODY };
});