"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Planck = require("planck");
const ActiveCharacter = require("../src/sim/active-character.js");

function makeWorld(points, heightAt) {
  const world = new Planck.World({ gravity: Planck.Vec2(0, -10) });
  const terrain = world.createBody({ userData: { kind: "terrain" } });
  terrain.createFixture({
    shape: new Planck.Chain(points.slice().reverse().map(point => Planck.Vec2(point[0], point[1]))),
    friction: 0.9
  });
  return { world, heightAt };
}

function flatWorld() {
  return makeWorld([[-10, 0], [10, 0]], () => 0);
}

test("active character uses one fixed-rotation body with a box and rounded foot", () => {
  const { world, heightAt } = flatWorld();
  const character = ActiveCharacter.create(Planck, world, { x: 0, heightAt });
  let dynamicBodies = 0;
  for (let body = world.getBodyList(); body; body = body.getNext()) {
    if (body.isDynamic()) dynamicBodies++;
  }
  assert.equal(dynamicBodies, 1);
  assert.equal(character.body.getFixtureList().getNext() !== null, true);
  assert.equal(character.body.isFixedRotation(), true);
  assert.equal(character.body.getMass() > 0, true);
});

test("active character remains grounded and still for three seconds on flat terrain", () => {
  const { world, heightAt } = flatWorld();
  const character = ActiveCharacter.create(Planck, world, { x: 0, heightAt });
  for (let i = 0; i < 150; i++) {
    character.update(1 / 50, 0);
    world.step(1 / 50, 8, 3);
  }
  character.update(1 / 50, 0);
  assert.equal(character.grounded(), true);
  assert.ok(Math.abs(character.body.getPosition().y - 0.055) < 0.04);
  assert.equal(character.body.getAngle(), 0);
  assert.ok(Math.abs(character.body.getLinearVelocity().x) < 0.01);
  assert.ok(Math.abs(character.body.getLinearVelocity().y) < 0.01);
});

for (const degrees of [0, 20, 35, 45]) {
  test("active character ground snap supports " + degrees + " degree terrain", () => {
    const slope = Math.tan(degrees * Math.PI / 180);
    const heightAt = x => slope * (x - 5);
    const { world } = makeWorld([[0, heightAt(0)], [10, heightAt(10)]], heightAt);
    const character = ActiveCharacter.create(Planck, world, { x: 5, heightAt });
    for (let i = 0; i < 150; i++) {
      character.update(1 / 50, 0);
      world.step(1 / 50, 8, 3);
    }
    character.update(1 / 50, 0);
    assert.equal(character.grounded(), true);
    const position = character.body.getPosition();
    assert.ok(Math.abs(position.y - (heightAt(position.x) + 0.055)) < 0.05,
      "body y=" + position.y + " expected=" + (heightAt(position.x) + 0.055) +
      " x=" + position.x + " lastGroundY=" + character.lastGroundY);
    assert.ok(Math.abs(position.x - 5) < 0.12,
      "standing character slid along slope to x=" + position.x);
    assert.equal(character.body.getAngle(), 0);
  });
}

test("active character walks along a 45 degree slope without falling through it", () => {
  const slope = 1;
  const heightAt = x => slope * (x - 5);
  const { world } = makeWorld([[0, heightAt(0)], [10, heightAt(10)]], heightAt);
  const character = ActiveCharacter.create(Planck, world, { x: 4, heightAt });
  for (let i = 0; i < 15; i++) {
    character.update(1 / 50, 0);
    world.step(1 / 50, 8, 3);
  }
  const startX = character.body.getPosition().x;
  for (let i = 0; i < 100; i++) {
    character.setMove(1);
    world.step(1 / 50, 8, 3);
    character.update(1 / 50, 1);
  }
  assert.ok(character.body.getPosition().x > startX + 1.2);
  assert.ok(character.body.getPosition().y > heightAt(character.body.getPosition().x) - 0.05);
  assert.equal(character.body.getAngle(), 0);
});

test("active character jumps once from ground and remains airborne until descending", () => {
  const { world, heightAt } = flatWorld();
  const character = ActiveCharacter.create(Planck, world, { x: 0, heightAt });
  character.update(1 / 50, 0);
  assert.equal(character.grounded(), true);
  assert.equal(character.jump(), true);
  assert.equal(character.jump(), false);
  const startY = character.body.getPosition().y;
  let maxY = startY;
  for (let i = 0; i < 80; i++) {
    world.step(1 / 50, 8, 3);
    character.update(1 / 50, 0);
    maxY = Math.max(maxY, character.body.getPosition().y);
  }
  assert.ok(maxY > startY + 0.65);
  assert.equal(character.grounded(), true);
  assert.ok(Math.abs(character.body.getPosition().y - 0.055) < 0.05);
});

test("active character can jump while moving and never snaps back to the jump origin", () => {
  const { world, heightAt } = flatWorld();
  const character = ActiveCharacter.create(Planck, world, { x: 0, heightAt });
  for (let i = 0; i < 12; i++) {
    character.update(1 / 50, 0);
    world.step(1 / 50, 8, 3);
  }
  character.setMove(1);
  assert.equal(character.jump(), true);
  const jumpOriginX = character.body.getPosition().x;
  let maxY = character.body.getPosition().y;
  for (let i = 0; i < 18; i++) {
    character.update(1 / 50, 1);
    world.step(1 / 50, 8, 3);
    maxY = Math.max(maxY, character.body.getPosition().y);
  }
  const airborneX = character.body.getPosition().x;
  assert.ok(airborneX > jumpOriginX + 0.45, "movement stopped during jump");
  assert.ok(maxY > 0.7, "jump did not gain height");
  for (let i = 0; i < 8; i++) {
    character.update(1 / 50, 0);
    world.step(1 / 50, 8, 3);
  }
  assert.ok(character.body.getPosition().x >= airborneX - 0.08,
    "releasing movement snapped back toward the jump origin");
  for (let i = 0; i < 70; i++) {
    character.update(1 / 50, 0);
    world.step(1 / 50, 8, 3);
  }
  assert.equal(character.grounded(), true);
  assert.ok(character.body.getPosition().x > jumpOriginX + 0.45);
});

test("active character can step onto a 0.4 unit ledge using the forward ground ray", () => {
  const { world, heightAt } = makeWorld(
    [[-5, 0], [0, 0], [0.01, 0.4], [5, 0.4]],
    x => x < 0 ? 0 : 0.4
  );
  const character = ActiveCharacter.create(Planck, world, { x: -0.35, heightAt });
  for (let i = 0; i < 20; i++) {
    character.update(1 / 50, 0);
    world.step(1 / 50, 8, 3);
  }
  for (let i = 0; i < 100; i++) {
    character.setMove(1);
    world.step(1 / 50, 8, 3);
    character.update(1 / 50, 1);
  }
  assert.ok(character.body.getPosition().x > 0.1,
    "step x=" + character.body.getPosition().x + " y=" + character.body.getPosition().y);
  assert.ok(character.body.getPosition().y > 0.4);
});

test("active pose supplies renderer-only articulated limbs without physics joints", () => {
  const { world, heightAt } = flatWorld();
  const character = ActiveCharacter.create(Planck, world, { x: 0, heightAt });
  const pose = character.pose();
  assert.ok(pose.head.y > pose.torso.y);
  assert.ok(pose.leftKnee.y > pose.leftFoot.y);
  assert.ok(pose.leftShoulder.y > pose.leftHand.y);
  let joints = 0;
  for (let joint = world.getJointList(); joint; joint = joint.getNext()) joints++;
  assert.equal(joints, 0);
});


test("active stickman walk cycle moves the hips and alternates full leg and arm swings", () => {
  const { world, heightAt } = flatWorld();
  const character = ActiveCharacter.create(Planck, world, { x: 0, heightAt });
  character.update(1 / 50, 0);
  const standing = character.pose();
  const samples = [];
  for (let i = 0; i < 40; i++) {
    character.setMove(1, 1 / 50);
    world.step(1 / 50, 8, 3);
    character.update(1 / 50, 1);
    samples.push(character.pose());
  }
  const hipHeights = samples.map(p => p.hips.y);
  const leftFootXs = samples.map(p => p.leftFoot.x - p.x);
  const rightFootXs = samples.map(p => p.rightFoot.x - p.x);
  const leftHandXs = samples.map(p => p.leftHand.x - p.x);
  assert.ok(Math.max(...hipHeights) - Math.min(...hipHeights) > 0.015,
    "hips should rise and fall through the walk cycle");
  assert.ok(Math.max(...leftFootXs) - Math.min(...leftFootXs) > 0.2,
    "left leg should swing from the hip");
  assert.ok(Math.max(...rightFootXs) - Math.min(...rightFootXs) > 0.2,
    "right leg should swing from the hip");
  assert.ok(Math.max(...leftHandXs) - Math.min(...leftHandXs) > 0.04,
    "arms should counter-swing with the legs");
  assert.notEqual(standing.hips.y, samples[10].hips.y);
});


test("active stickman arms hang beside the torso instead of forming a T pose", () => {
  const { world, heightAt } = flatWorld();
  const character = ActiveCharacter.create(Planck, world, { x: 0, heightAt });
  const pose = character.pose();
  for (const side of ["left", "right"]) {
    const shoulder = pose[side + "Shoulder"];
    const elbow = pose[side + "Elbow"];
    const hand = pose[side + "Hand"];
    assert.ok(shoulder.y > elbow.y, side + " elbow should hang below shoulder");
    assert.ok(elbow.y > hand.y, side + " hand should hang below elbow");
    assert.ok(Math.abs(hand.x - shoulder.x) < 0.1,
      side + " arm should stay close to torso, not extend sideways");
  }
});
