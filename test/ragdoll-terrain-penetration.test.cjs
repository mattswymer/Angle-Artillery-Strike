"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Planck = require("planck");
const CharacterRig = require("../src/character-rig.js").create(Planck);
const ActiveCharacter = require("../src/sim/active-character.js");
const Combatant = require("../src/sim/combatant.js");
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


test("active-to-ragdoll handoff cannot place any physical segment inside terrain", () => {
  const { world } = createFlatArena();
  const actor = Combatant.create(Planck, world, CharacterRig, {
    ActiveCharacter,
    x: 5,
    heightAt: () => 1,
    terrainAngleAt: () => 0,
    settingsForX: () => ({
      stanceHalfWidth: 0.12,
      pelvisRatio: 0.95,
      bendMode: "side",
      highSideBend: 0.4,
      lowSideBend: 1,
      stepReach: 0.12,
      stepLookahead: 0.25,
      swingHeight: 0.12,
      swingDuration: 0.2,
      hipHeightBlend: 1,
      upperBodyTorqueScale: 0.1
    }),
    collisionGroup: -17,
    worldWidth: 10,
    isOccupied: () => false
  });

  assert.equal(actor.mode, "active");
  assert.equal(actor.enterRagdoll(Planck.Vec2(0, -24)), true);
  assert.equal(actor.mode, "ragdoll");
  stepAndCheck(world, actor.rig, 360);
  actor.destroy();
});


test("ragdoll segments remain outside sloped terrain during a downward impact", () => {
  const slope = 0.12;
  const heightAt = x => 0.4 + slope * x;
  const surfaceHeights = Array.from({ length: 101 }, (_, index) =>
    heightAt(index / 10)
  );
  const world = new Planck.World({ gravity: Planck.Vec2(0, -10) });
  const terrain = new TerrainSystem(
    Planck, world, 10, 5, 0.1, -1, surfaceHeights
  );
  terrain.rebuildPhysics();
  const rig = CharacterRig.createStanceRig(
    world, 5, heightAt, () => Math.atan(slope),
    0.12, 0.95, 0, 0, 0.6, "side", 0.4, 1, -17
  );
  rig.hit(Planck.Vec2(0, -20), rig.hull);

  for (let step = 0; step < 320; step++) {
    world.step(1 / 50, 180, 60);
    for (const piece of rig.pieces) {
      const body = piece.body;
      if (piece.circle) {
        const center = body.getPosition();
        const lowest = center.y - piece.halfWidth * Math.sqrt(1 + slope * slope);
        assert.ok(
          lowest >= heightAt(center.x) - 0.14,
          `${piece.name} penetrated sloped terrain at step ${step}: ${lowest.toFixed(4)}`
        );
        continue;
      }
      for (const x of [-1, 1]) {
        for (const y of [-1, 1]) {
          const corner = body.getWorldPoint(Planck.Vec2(
            x * piece.halfWidth, y * piece.halfHeight
          ));
          assert.ok(
            corner.y >= heightAt(corner.x) - 0.14,
            `${piece.name} penetrated sloped terrain at step ${step}`
          );
        }
      }
    }
  }
});
