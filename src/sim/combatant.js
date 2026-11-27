(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.Combatant = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function create(Planck, world, CharacterRig, options = {}) {
    const Vec2 = Planck.Vec2;
    const heightAt = options.heightAt || (() => 0);
    const terrainAngleAt = options.terrainAngleAt || (() => 0);
    const settingsForX = options.settingsForX || (() => ({}));
    const isOccupied = options.isOccupied || (() => false);
    const team = options.team ?? 0;
    const number = options.number ?? 1;
    const collisionGroup = options.collisionGroup ?? -1;
    const maxRecoverySeconds = options.maxRecoverySeconds ?? 6;

    const state = {
      team, number, collisionGroup,
      active: null, rig: null, body: null,
      mode: "active", grounded: false, stableTime: 0,
      ragdollElapsed: 0, recoveryReason: null
    };

    function tagRagdoll(rig) {
      for (const piece of rig.pieces) {
        const part = piece.name;
        piece.body.setUserData({ kind: "character", team, number, part });
        const location = part === "head" ? "head" :
          part.includes("leg") || part.includes("foot") ? "legs" : "chest";
        for (let fixture = piece.body.getFixtureList(); fixture; fixture = fixture.getNext()) {
          fixture.setUserData({ kind: "character", location, part });
        }
      }
      rig.settings = settingsForX(rig.hull.getPosition().x);
    }

    function createActive(x) {
      state.active = options.ActiveCharacter.create(Planck, world, {
        x, heightAt, collisionGroup, team, number
      });
      state.body = state.active.body;
      state.active.snapToGround(0);
      state.body.setUserData({ kind: "character", team, number, part: "active-body" });
      for (let fixture = state.body.getFixtureList(); fixture; fixture = fixture.getNext()) {
        const data = fixture.getUserData() || {};
        fixture.setUserData({
          kind: "character", location: data.location || "chest",
          part: data.part || "active-body"
        });
      }
      state.rig = null;
      state.mode = "active";
      state.grounded = false;
      state.stableTime = 0;
    }

    createActive(options.x ?? 0);

    function findStandableX(originX) {
      const center = Math.max(0.35, Math.min((options.worldWidth || 24) - 0.35, originX));
      const offsets = [0];
      for (let i = 1; i <= 20; i++) offsets.push(i * 0.15, -i * 0.15);
      for (const offset of offsets) {
        const x = center + offset;
        if (x < 0.35 || x > (options.worldWidth || 24) - 0.35) continue;
        if (Math.abs(terrainAngleAt(x)) > 50 * Math.PI / 180) continue;
        if (isOccupied(x, state)) continue;
        return x;
      }
      return center;
    }

    function recover(forceRelocate = false) {
      if (!state.rig) return false;
      const rig = state.rig;
      const currentX = rig.hull.getPosition().x;
      const stable = CharacterRig.rigIsStable(rig);
      const x = forceRelocate || !stable ? findStandableX(currentX) : currentX;
      for (const body of rig.bodies) world.destroyBody(body);
      createActive(x);
      state.ragdollElapsed = 0;
      state.recoveryReason = forceRelocate ? "timeout-relocation" : "natural";
      return true;
    }

    function enterRagdoll(impulse = Vec2(0, 0), hitPoint = null) {
      if (state.mode !== "active") {
        if (state.rig) state.rig.hit(impulse, state.rig.hull, hitPoint);
        return false;
      }
      const active = state.active;
      const sourcePosition = active.body.getPosition();
      const sourceVelocity = active.body.getLinearVelocity();
      const settings = settingsForX(sourcePosition.x);
      active.destroy();
      state.active = null;

      const rig = CharacterRig.createStanceRig(
        world, sourcePosition.x, heightAt, terrainAngleAt,
        settings.stanceHalfWidth, settings.pelvisRatio, 0, 0, 0.6,
        settings.bendMode, settings.highSideBend, settings.lowSideBend, collisionGroup
      );
      // The torso is the ragdoll's only physical terrain collider. All
      // articulated parts remain jointed and retain sensor contacts for
      // recovery/support queries, but cannot snag or fight the terrain solver.
      for (const piece of rig.pieces) {
        if (piece.name === "torso") continue;
        for (let fixture = piece.body.getFixtureList(); fixture; fixture = fixture.getNext()) {
          fixture.setSensor(true);
        }
      }
      const target = Vec2(sourcePosition.x, sourcePosition.y + 0.95);
      const original = rig.hull.getPosition();
      const offset = Vec2(target.x - original.x, target.y - original.y);
      for (const body of rig.bodies) {
        const p = body.getPosition();
        body.setTransform(Vec2(p.x + offset.x, p.y + offset.y), body.getAngle());
        body.setLinearVelocity(sourceVelocity);
        body.setAngularVelocity(0);
      }
      tagRagdoll(rig);
      state.rig = rig;
      state.body = rig.hull;
      state.mode = "ragdoll";
      state.ragdollElapsed = 0;
      state.stableTime = 0;
      state.grounded = false;
      state.recoveryReason = null;
      rig.hit(impulse, rig.hull, hitPoint);
      return true;
    }

    function update(dt = 1 / 50, direction = null) {
      if (state.mode === "active") {
        state.active.update(dt, direction);
        state.grounded = state.active.grounded();
        return;
      }
      state.ragdollElapsed += dt;
      const rig = state.rig;
      const recovery = CharacterRig.updateRigRecovery(rig, dt, heightAt);
      if (rig.recovering) {
        const settings = rig.settings;
        CharacterRig.stanceController(
          rig, heightAt, terrainAngleAt, recovery.stiffness,
          3.5, 0.06, 1.5, settings.stepReach, settings.stepLookahead,
          6, 6, settings.swingHeight, settings.swingDuration,
          1, settings.hipHeightBlend, settings.upperBodyTorqueScale
        );
      }
      if (rig.mode === "active" && CharacterRig.rigIsStable(rig)) {
        state.stableTime += dt;
        if (state.stableTime >= 0.3) recover(false);
      } else {
        state.stableTime = 0;
      }
      if (state.ragdollElapsed >= maxRecoverySeconds) recover(true);
    }

    function destroy() {
      if (state.active) state.active.destroy();
      if (state.rig) for (const body of state.rig.bodies) world.destroyBody(body);
      state.active = null;
      state.rig = null;
      state.body = null;
      state.mode = "eliminated";
    }

    return Object.assign(state, {
      enterRagdoll, recover, update, destroy,
      setMove(direction, dt) {
        if (state.active) return state.active.setMove(direction, dt);
        return false;
      },
      jump() {
        return state.active ? state.active.jump() : false;
      },
      applyImpulse(impulse) {
        if (state.active) state.active.applyImpulse(impulse);
        else if (state.rig) state.rig.hull.applyLinearImpulse(impulse, state.rig.hull.getWorldCenter(), true);
      },
      pose() {
        return state.active ? state.active.pose() : null;
      }
    });
  }

  return { create };
});