"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Planck = require("planck");
const CharacterRig = require("../src/character-rig.js").create(Planck);

test("every articulated ragdoll segment remains a solid terrain collider", () => {
  const world = new Planck.World({ gravity: Planck.Vec2(0, -10) });
  const rig = CharacterRig.createStanceRig(
    world, 5, () => 1, () => 0,
    0.12, 0.95, 0, 0, 0.6, "side", 0.4, 1, -17
  );

  assert.equal(rig.bodies.length, 12);
  for (const body of rig.bodies) {
    const fixture = body.getFixtureList();
    assert.ok(fixture, "every ragdoll body must have a fixture");
    for (let current = fixture; current; current = current.getNext()) {
      assert.equal(
        current.isSensor(),
        false,
        (body.getUserData()?.part || "ragdoll segment") + " must collide with terrain"
      );
      assert.equal(
        current.getFilterData().groupIndex,
        -17,
        "same-character collision filtering must remain consistent"
      );
    }
  }
});
