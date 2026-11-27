"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Planck = require("planck");
const CharacterRig = require("../src/character-rig.js").create(Planck);
const ActiveCharacter = require("../src/sim/active-character.js");
const Combatant = require("../src/sim/combatant.js");

const settingsForX = () => ({
  stanceHalfWidth: 0.12, pelvisRatio: 0.95,
  bendMode: "side", highSideBend: 0.4, lowSideBend: 1,
  stepReach: 0.12, stepLookahead: 0.25,
  swingHeight: 0.12, swingDuration: 0.2,
  hipHeightBlend: 1, upperBodyTorqueScale: 0.1
});

function seeded(seed) {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function makeActor(seed = 1) {
  const random = seeded(seed);
  const world = new Planck.World({ gravity: Planck.Vec2(0, -10) });
  const ground = world.createBody({ userData: { kind: "terrain" } });
  ground.createFixture({
    shape: new Planck.Chain([
      Planck.Vec2(8, 0), Planck.Vec2(-8, 0)
    ]),
    friction: 0.95
  });
  const actor = Combatant.create(Planck, world, CharacterRig, {
    ActiveCharacter, x: (random() - 0.5) * 4,
    heightAt: () => 0,
    terrainAngleAt: () => 0,
    settingsForX,
    collisionGroup: -1,
    team: 0, number: 1, worldWidth: 16,
    isOccupied: () => false
  });
  return { world, actor, random };
}

function countDynamicBodies(world) {
  let count = 0;
  for (let body = world.getBodyList(); body; body = body.getNext()) {
    if (body.isDynamic()) count++;
  }
  return count;
}

function countJoints(world) {
  let count = 0;
  for (let joint = world.getJointList(); joint; joint = joint.getNext()) count++;
  return count;
}

test("hit hands the active collider to the articulated ragdoll and preserves momentum", () => {
  const { world, actor } = makeActor(11);
  actor.body.setLinearVelocity(Planck.Vec2(1.2, 0));
  assert.equal(countDynamicBodies(world), 1);
  assert.equal(actor.enterRagdoll(Planck.Vec2(3, 5)), true);
  assert.equal(actor.mode, "ragdoll");
  assert.equal(actor.active, null);
  assert.equal(actor.rig.bodies.length, 12);
  assert.equal(countDynamicBodies(world), 12);
  assert.equal(countJoints(world), 11);
  assert.ok(actor.rig.hull.getLinearVelocity().x > 0);
  assert.ok(actor.rig.hull.getLinearVelocity().y > 0);
});

test("ragdoll body and physical limbs remain supported by the terrain", () => {
  const { world, actor } = makeActor(17);
  actor.enterRagdoll(Planck.Vec2(0, 0));
  const rig = actor.rig;
  assert.ok(rig, "hit did not create the articulated ragdoll");
  // Exercise raw rigid-body collision without allowing the recovery state
  // machine to replace the ragdoll while this contact test is running.
  for (let i = 0; i < 75; i++) world.step(1 / 50, 180, 60);
  assert.ok(rig.hull.getPosition().y > 0.15,
    "ragdoll torso passed through the terrain");
  for (const piece of rig.pieces) {
    for (let fixture = piece.body.getFixtureList(); fixture; fixture = fixture.getNext()) {
      assert.equal(
        fixture.isSensor(),
        false,
        piece.name + " must have solid terrain collision during ragdoll"
      );
    }
  }
  assert.equal(rig.hull.getFixtureList().isSensor(), false,
    "torso must retain physical terrain collision");
  assert.ok(CharacterRig.isGroundContact(rig.hull),
    "ragdoll torso has no physical terrain support contact");
});

test("ragdoll timeout relocates a stuck character and restores one active body", () => {
  const { world, actor } = makeActor(22);
  actor.enterRagdoll(Planck.Vec2(7, 9));
  for (let i = 0; i < 301 && actor.mode === "ragdoll"; i++) {
    actor.update(1 / 50, null);
    world.step(1 / 50, 180, 60);
  }
  assert.equal(actor.mode, "active");
  assert.equal(actor.recoveryReason, "timeout-relocation");
  assert.equal(countDynamicBodies(world), 1);
  assert.equal(countJoints(world), 0);
  actor.update(1 / 50, 0);
  world.step(1 / 50, 8, 3);
  actor.update(1 / 50, 0);
  assert.equal(actor.active.grounded(), true);
});

test("50 seeded explosion handoffs never leave a combatant stuck in ragdoll mode", () => {
  const failures = [];
  for (let seed = 1; seed <= 50; seed++) {
    const { world, actor, random } = makeActor(seed);
    for (let i = 0; i < 10; i++) {
      actor.update(1 / 50, 0);
      world.step(1 / 50, 8, 3);
    }
    actor.enterRagdoll(Planck.Vec2((random() - 0.5) * 18, random() * 14));
    for (let i = 0; i < 310 && actor.mode === "ragdoll"; i++) {
      actor.update(1 / 50, null);
      world.step(1 / 50, 180, 60);
    }
    if (actor.mode !== "active" || countDynamicBodies(world) !== 1 || countJoints(world) !== 0) {
      failures.push({ seed, mode: actor.mode, bodies: countDynamicBodies(world), joints: countJoints(world) });
    }
    actor.destroy();
  }
  assert.deepEqual(failures, []);
});
