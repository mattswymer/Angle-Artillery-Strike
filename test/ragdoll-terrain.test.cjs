"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Planck = require("planck");
const CharacterRig = require("../src/character-rig.js").create(Planck);

test("ragdoll segments all collide with terrain while active lower arms stay non-blocking", () => {
  const world = new Planck.World({ gravity: Planck.Vec2(0, -10) });
  const rig = CharacterRig.createStanceRig(
    world, 5, () => 1, () => 0,
    0.12, 0.95, 0, 0, 0.6, "side", 0.4, 1, -17
  );

  assert.equal(rig.bodies.length, 12);
  const lowerArmFixtures = new Set(rig.ragdollTerrainFixtures);
  for (const body of rig.bodies) {
    for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
      assert.equal(fixture.isSensor(), lowerArmFixtures.has(fixture));
    }
  }

  rig.hit(Planck.Vec2(0, 0));
  for (const body of rig.bodies) {
    for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
      assert.equal(
        fixture.isSensor(),
        false,
        (body.getUserData()?.part || "ragdoll segment") + " must collide with terrain while limp"
      );
    }
  }
});
