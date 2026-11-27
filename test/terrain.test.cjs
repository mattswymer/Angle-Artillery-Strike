"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const Planck = require("planck");

const browser = { window: {} };
vm.runInNewContext(
  fs.readFileSync(require.resolve("../src/terrain.js"), "utf8"),
  browser
);
const TerrainSystem = browser.window.TerrainSystem;

test("generated terrain exposes its top surface to one-sided Planck collisions", () => {
  const world = new Planck.World({ gravity: Planck.Vec2(0, -10) });
  const terrain = new TerrainSystem(
    Planck, world, 10, 5, 0.1, -1, Array(11).fill(1)
  );
  terrain.rebuildPhysics();

  const body = world.createDynamicBody({
    position: Planck.Vec2(5, 3),
    linearDamping: 0
  });
  body.createFixture({
    shape: new Planck.Circle(0.25),
    density: 1,
    friction: 0.8
  });

  for (let i = 0; i < 180; i++) world.step(1 / 60, 8, 3);

  assert.ok(body.getPosition().y > 1.15,
    "dynamic body fell through generated terrain to y=" + body.getPosition().y);
  assert.ok(body.getPosition().y < 1.4,
    "dynamic body did not settle on the terrain top: y=" + body.getPosition().y);
});


test("terrain blocks fast bullet bodies without one-sided chain gaps", () => {
  const world = new Planck.World({ gravity: Planck.Vec2(0, -10) });
  const terrain = new TerrainSystem(
    Planck, world, 10, 5, 0.1, -1, Array(11).fill(1)
  );
  terrain.rebuildPhysics();

  const body = world.createDynamicBody({
    position: Planck.Vec2(5, 2.2),
    bullet: true,
    linearDamping: 0
  });
  body.createFixture({
    shape: new Planck.Circle(0.1),
    density: 1,
    friction: 0.8
  });
  body.setLinearVelocity(Planck.Vec2(0, -40));

  for (let i = 0; i < 120; i++) world.step(1 / 50, 12, 8);

  assert.ok(body.getPosition().y >= 1.09,
    "fast body tunneled through terrain: y=" + body.getPosition().y);
  assert.ok(terrain.physicsRectangleCount > 0);
});

test("terrain collision fixtures are two-sided solid rectangles", () => {
  const world = new Planck.World({ gravity: Planck.Vec2(0, 0) });
  const terrain = new TerrainSystem(
    Planck, world, 10, 5, 0.1, -1, Array(11).fill(1)
  );
  terrain.rebuildPhysics();

  let fixtureCount = 0;
  for (let fixture = terrain.body.getFixtureList(); fixture; fixture = fixture.getNext()) {
    fixtureCount++;
    assert.equal(fixture.isSensor(), false);
  }
  assert.ok(fixtureCount > 0);
  assert.ok(fixtureCount < terrain.rows,
    "identical solid row runs should merge vertically");
});
