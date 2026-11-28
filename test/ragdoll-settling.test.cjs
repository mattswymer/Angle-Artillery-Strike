"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Planck = require("planck");
const CharacterRig = require("../src/character-rig.js").create(Planck);

test("an unobstructed ragdoll settles and sleeps as one articulated assembly", () => {
  const world = new Planck.World({ gravity: Planck.Vec2(0, -10) });
  world.setAllowSleeping(true);
  const ground = world.createBody();
  ground.createFixture({
    shape: new Planck.Chain([Planck.Vec2(12, 0), Planck.Vec2(-12, 0)]),
    friction: 0.95,
    restitution: 0
  });

  const rig = CharacterRig.createStanceRig(
    world, 0, () => 0, () => 0,
    0.12, 0.95, 0, 0, 0.6, "side", 0.4, 1, -17
  );
  rig.hit(Planck.Vec2(3, 0.8));

  let settledAt = -1;
  for (let step = 0; step < 1000; step++) {
    world.step(1 / 50, 180, 60);
    if (rig.bodies.every(body => !body.isAwake())) {
      settledAt = step;
      break;
    }
  }

  assert.notEqual(settledAt, -1,
    "all connected ragdoll bodies should enter sleep after coming to rest");
  assert.ok(rig.bodies.every(body =>
    body.getLinearVelocity().length() === 0 &&
    body.getAngularVelocity() === 0
  ), "sleeping bodies should have no residual movement");
});

test("recovery waits for every segment to settle on terrain, then wakes the whole rig", () => {
  const world = new Planck.World({ gravity: Planck.Vec2(0, -10) });
  world.setAllowSleeping(true);
  const ground = world.createBody();
  ground.createFixture({
    shape: new Planck.Chain([Planck.Vec2(12, 0), Planck.Vec2(-12, 0)]),
    friction: 0.95,
    restitution: 0
  });

  const rig = CharacterRig.createStanceRig(
    world, 0, () => 0, () => 0,
    0.12, 0.95, 0, 0, 0.6, "side", 0.4, 1, -18
  );
  rig.hit(Planck.Vec2(3, 0.8));

  let recoveryStarted = false;
  for (let step = 0; step < 1000; step++) {
    world.step(1 / 50, 180, 60);
    const result = CharacterRig.updateRigRecovery(rig, 1 / 50, () => 0);
    if (result.recovering) {
      recoveryStarted = true;
      break;
    }
  }

  assert.equal(recoveryStarted, true, "settled ragdoll should enter recovery");
  assert.ok(rig.bodies.every(body => body.isAwake()),
    "the entire articulated rig must wake before get-up forces are applied");
});
