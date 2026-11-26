const test = require("node:test");
const assert = require("node:assert/strict");
const Planck = require("planck");

globalThis.CharacterRig = undefined;
require("../src/character-rig.js");

const V = Planck.Vec2;
const GRAVITY = 10;

function makeSlopeWorld(angleDegrees) {
  const world = new Planck.World({ gravity: V(0, -GRAVITY) });
  world.setAllowSleeping(false);
  const angle = angleDegrees * Math.PI / 180;
  const ground = world.createBody();
  ground.createFixture(new Planck.Edge(
    V(-8, -8 * Math.tan(angle)),
    V(8, 8 * Math.tan(angle))
  ), { friction: 0.9 });
  return { world, groundY: x => Math.tan(angle) * x };
}

for (const slope of [0, 20, 35, 50]) {
  test(`builds one articulated rig on a ${slope} degree test slope`, () => {
    const { world, groundY } = makeSlopeWorld(slope);
    const x = 0;
    const origin = {
      x,
      y: Math.max(groundY(x - 0.105), groundY(x + 0.105)) + 1.02
    };
    const rig = globalThis.CharacterRig.buildRig(Planck, world, 0, 1, origin);

    assert.equal(rig.mode, "active");
    assert.equal(rig.stiffness, 1);
    assert.equal(rig.torso, rig.byName.torso.body);
    assert.equal(rig.pieces.length, 12);
    assert.equal(rig.pieces.some(piece => piece.body.isFixedRotation()), false);

    for (let i = 0; i < 90; i++) world.step(1 / 60, 10, 6);
    assert.equal(rig.mode, "active", "a newly spawned rig must not enter limp mode");
    assert.equal(rig.stiffness, 1);
  });
}

test("a hit changes the existing rig to limp without replacing its bodies", () => {
  const { world } = makeSlopeWorld(0);
  const rig = globalThis.CharacterRig.buildRig(Planck, world, 0, 1, { x: 0, y: 1.02 });
  const originalBodies = rig.pieces.map(piece => piece.body);
  rig.hit();

  assert.equal(rig.mode, "limp");
  assert.equal(rig.stiffness, 0);
  assert.deepEqual(rig.pieces.map(piece => piece.body), originalBodies);
});
