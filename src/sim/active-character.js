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
      const stride = moving ? Math.sin(phase) : 0;
      const oppositeStride = -stride;
      // Proportions are fractions of the complete foot-to-head height.
      const H = 1.28;
      const headDiameter = H / 8;
      const headRadius = headDiameter / 2;
      const neckLength = H / 16;
      const torsoLength = H * 5 / 16;
      const upperLimbLength = H * 3 / 16;
      const legSegmentLength = H / 4;
      const bob = moving ? 0.018 * (1 - Math.cos(phase * 2)) : 0;
      const hipSway = moving ? Math.sin(phase) * 0.018 : 0;
      const footY = p.y + BODY.skin;
      const hip = { x: p.x + hipSway, y: footY + legSegmentLength * 2 + bob };
      const knee = (side, swing) => ({
        x: hip.x + side * 0.035 + swing * 0.12,
        y: footY + legSegmentLength + Math.max(0, swing) * 0.035 + bob * 0.5
      });
      const leftKnee = knee(-1, stride);
      const rightKnee = knee(1, oppositeStride);
      const foot = (side, swing) => ({
        x: p.x + side * 0.11 + swing * 0.18,
        y: footY + (moving ? Math.max(0, swing) * 0.07 : 0)
      });
      const leftFoot = foot(-1, stride);
      const rightFoot = foot(1, oppositeStride);
      const torsoTop = { x: hip.x, y: hip.y + torsoLength };
      const neckTop = { x: torsoTop.x, y: torsoTop.y + neckLength };
      const head = { x: neckTop.x, y: neckTop.y + headRadius };
      const armSwing = moving ? -stride * 0.045 : 0;
      const shoulder = side => ({
        x: torsoTop.x + side * 0.012,
        y: torsoTop.y
      });
      const elbow = side => ({
        x: torsoTop.x + side * (upperLimbLength * 0.28) + armSwing,
        y: torsoTop.y - upperLimbLength * 0.72
      });
      const hand = side => ({
        x: torsoTop.x + side * (upperLimbLength * 0.34) + armSwing * 1.5,
        y: torsoTop.y - upperLimbLength * 1.5
      });
      return {
        x: p.x, y: p.y, facing, grounded, head,
        neckTop, torsoTop, hips: hip,
        leftFoot, rightFoot, leftKnee, rightKnee,
        leftShoulder: shoulder(-1), rightShoulder: shoulder(1),
        leftElbow: elbow(-1), rightElbow: elbow(1),
        leftHand: hand(-1), rightHand: hand(1)
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