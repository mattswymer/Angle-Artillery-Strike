"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Planck = require("planck");
const CharacterRig = require("../src/character-rig.js").create(Planck);
const TerrainSystem = (() => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const browser = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/terrain.js"), "utf8"), browser);
  return browser.window.TerrainSystem;
})();

function createFlatArena() {
  const world = new Planck.World({ gravity: Planck.Vec2(0, -10) });
  const terrain = new TerrainSystem(
    Planck, world, 10, 5, 0.1, -1, Array(101).fill(1)
  );
  terrain.rebuildPhysics();
  return { world, terrain };
}

function createRagdoll(world) {
  return CharacterRig.createStanceRig(
    world, 5, () => 1, () => 0,
    0.12, 0.95, 0, 0, 0.6, "side", 0.4, 1, -17
  );
}

function lowestFixturePoint(piece) {
  const body = piece.body;
  const position = body.getPosition();
  if (piece.circle) return position.y - piece.halfWidth;
  const angle = body.getAngle();
  const verticalRadius =
    Math.abs(Math.sin(angle)) * piece.halfWidth +
    Math.abs(Math.cos(angle)) * piece.halfHeight;
  return position.y - verticalRadius;
}

function assertRagdollAboveFlatTerrain(rig, step) {
  for (const piece of rig.pieces) {
    const bottom = lowestFixturePoint(piece);
    assert.ok(
      bottom >= 0.94,
      `${piece.name} penetrated the y=1 terrain at step ${step}: bottom=${bottom.toFixed(4)}`
    );
  }
}

function stepAndCheck(world, rig, count, offset = 0) {
  for (let i = 0; i < count; i++) {
    world.step(1 / 50, 180, 60);
    assertRagdollAboveFlatTerrain(rig, offset + i);
  }
}

test("every solid ragdoll fixture stays above flat terrain during a hard downward impact", () => {
  const { world } = createFlatArena();
  const rig = createRagdoll(world);
  rig.hit(Planck.Vec2(0, -24), rig.hull);

  for (const body of rig.bodies) {
    for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
      assert.equal(fixture.isSensor(), false, "all limp ragdoll segments must be solid");
    }
  }

  stepAndCheck(world, rig, 360);
});

test("every solid ragdoll fixture stays above flat terrain after a lateral blast", () => {
  const { world } = createFlatArena();
  const rig = createRagdoll(world);
  rig.hit(Planck.Vec2(13, 5), rig.hull);

  stepAndCheck(world, rig, 300);
});

test("ragdoll terrain contacts remain valid after terrain physics is rebuilt mid-fall", () => {
  const { world, terrain } = createFlatArena();
  const rig = createRagdoll(world);
  rig.hit(Planck.Vec2(3, -16), rig.hull);

  stepAndCheck(world, rig, 35);
  terrain.rebuildPhysics();
  stepAndCheck(world, rig, 325, 35);
});
