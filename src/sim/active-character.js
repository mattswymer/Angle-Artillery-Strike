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
      linearDamping: 0,
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
          hit = { x: point.x, y: point.y, normal: Vec2(normal.x, normal.y), fraction };
        }
        return fraction;
      });
      return hit;
    }

    function snapToGround(direction = 0) {
      const position = body.getPosition();
      const centerHit = rayGround(position.x, position.y);
      if (!centerHit) {
        grounded = false;
        return false;
      }
      let target = centerHit;
      if (direction !== 0) {
        const ahead = rayGround(position.x + direction * 0.2, position.y);
        if (ahead && ahead.y - centerHit.y <= BODY.maxStepHeight) {
          if (ahead.y > centerHit.y) target = ahead;
        }
      }
      const bottom = position.y + BODY.footCenterY - BODY.radius;
      const gap = target.y - bottom;
      const velocity = body.getLinearVelocity();
      const canSnap = !jumpLock && velocity.y <= 0.65 &&
        gap <= BODY.snapDistance && gap >= -BODY.snapDownDistance;
      if (!canSnap) {
        grounded = false;
        return false;
      }
      const nextY = target.y - BODY.footCenterY + BODY.radius + BODY.skin;
      body.setTransform(Vec2(position.x, nextY), 0);
      body.setLinearVelocity(Vec2(velocity.x, 0));
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
      snapToGround(direction);
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
      if (jumpLock && velocity.y <= 0) jumpLock = false;
      if (direction === 0) body.setLinearVelocity(Vec2(0, velocity.y));
      snapToGround(direction);
    }

    function pose() {
      const p = body.getPosition();
      const moving = Math.abs(body.getLinearVelocity().x) > 0.15 && grounded;
      const swing = moving ? Math.sin(gaitPhase) * 0.22 : 0;
      return {
        x: p.x, y: p.y, facing, grounded,
        head: { x: p.x, y: p.y + 1.16 },
        torso: { x: p.x, y: p.y + 0.67 },
        leftFoot: { x: p.x - 0.12 + swing, y: p.y + BODY.skin },
        rightFoot: { x: p.x + 0.12 - swing, y: p.y + BODY.skin },
        leftKnee: { x: p.x - 0.12 + swing * 0.45, y: p.y + 0.31 + Math.abs(swing) * 0.35 },
        rightKnee: { x: p.x + 0.12 - swing * 0.45, y: p.y + 0.31 + Math.abs(swing) * 0.35 },
        leftShoulder: { x: p.x - 0.17, y: p.y + 0.82 },
        rightShoulder: { x: p.x + 0.17, y: p.y + 0.82 },
        leftHand: { x: p.x - 0.2 - swing * 0.45, y: p.y + 0.48 },
        rightHand: { x: p.x + 0.2 + swing * 0.45, y: p.y + 0.48 }
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