const test = require("node:test");
const assert = require("node:assert/strict");
const Planck = require("planck");

require("../src/character-rig.js");
const V = Planck.Vec2;
const GRAVITY = 10;
const STEP = 1 / 60;

function makeSlopeWorld(angleDegrees) {
  const world = new Planck.World({ gravity: V(0, -GRAVITY) });
  world.setAllowSleeping(false);
  const angle = angleDegrees * Math.PI / 180;
  const ground = world.createBody();
  ground.createFixture(new Planck.Edge(
    V(8, 8 * Math.tan(angle)),
    V(-8, -8 * Math.tan(angle))
  ), { friction: 0.9 });
  const groundY = x => Math.tan(angle) * x;
  const normal = { x: -Math.sin(angle), y: Math.cos(angle) };
  const terrainProbe = (x, startY, endY) => ({
    point: { x, y: groundY(x) },
    normal
  });
  return { world, groundY, terrainProbe, angle };
}

function spawnRig(slope) {
  const { world, groundY, terrainProbe, angle } = makeSlopeWorld(slope);
  const leftX = -0.18;
  const rightX = 0.18;
  const footTargets = [
    { x: leftX, y: groundY(leftX) + 0.06, angle },
    { x: rightX, y: groundY(rightX) + 0.06, angle }
  ];
  const pelvisY = Math.min(footTargets[0].y, footTargets[1].y) + 0.95 * (0.41 + 0.34);
  const rig = globalThis.CharacterRig.buildRig(Planck, world, 0, 1,
    { x: 0, y: pelvisY + 0.25 }, { footTargets });
  return { world, rig, terrainProbe };
}

for (const slope of [0, 20, 35]) {
  test(`rig remains actively supported for 3 seconds on a ${slope} degree slope`, () => {
    const { world, rig, terrainProbe } = spawnRig(slope);
    assert.equal(rig.mode, "active");
    assert.equal(rig.pieces.length, 12);
    assert.equal(rig.torso, rig.byName.torso.body);
    assert.equal(rig.pieces.some(piece => piece.body.isFixedRotation()), false);

    for (let i = 0; i < 180; i++) {
      rig.driveStance(STEP, terrainProbe);
      world.step(STEP, 10, 6);
      rig.updateFallState(STEP);
    }

    assert.equal(rig.mode, "active", "a supported slope must not release the rig: " +
      JSON.stringify({ reason: rig.limpReason, metrics: rig.lastFallMetrics }));
    assert.equal(rig.getFootContacts().filter(Boolean).length, 2, "both feet must contact terrain");
    assert.ok(rig.stableTime >= 2.8, `stable duration was ${rig.stableTime.toFixed(2)}s`);
  });
}

test("rig releases on a 50 degree slope", () => {
  const { world, rig, terrainProbe } = spawnRig(50);
  for (let i = 0; i < 90; i++) {
    rig.driveStance(STEP, terrainProbe);
    world.step(STEP, 10, 6);
    rig.updateFallState(STEP);
  }
  assert.equal(rig.mode, "limp");
  assert.equal(rig.stiffness, 0);
});

test("a newly spawned rig does not enter limp mode", () => {
  for (const slope of [0, 20, 35]) {
    const { world, rig, terrainProbe } = spawnRig(slope);
    assert.equal(rig.mode, "active");
    for (let i = 0; i < 90; i++) {
      rig.driveStance(STEP, terrainProbe);
      world.step(STEP, 10, 6);
      rig.updateFallState(STEP);
    }
    assert.equal(rig.mode, "active", `spawn on ${slope} degrees must remain active`);
  }
});

test("a hit changes the existing rig to limp without replacing its bodies", () => {
  const { rig } = spawnRig(0);
  const originalBodies = rig.pieces.map(piece => piece.body);
  rig.hit();

  assert.equal(rig.mode, "limp");
  assert.equal(rig.stiffness, 0);
  assert.deepEqual(rig.pieces.map(piece => piece.body), originalBodies);
});
