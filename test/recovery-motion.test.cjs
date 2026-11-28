"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Planck = require("planck");
const CharacterRig = require("../src/character-rig.js").create(Planck);

test("ragdoll get-up eases from a low supported stance into full standing height", () => {
  const world = new Planck.World({ gravity: Planck.Vec2(0, -10) });
  const ground = world.createBody();
  ground.createFixture({
    shape: new Planck.Chain([Planck.Vec2(8, 0), Planck.Vec2(-8, 0)]),
    friction: 0.9
  });
  const rig = CharacterRig.createStanceRig(
    world, 0, () => 0, () => 0,
    0.12, 0.95, 0, 0, 0.6, "side", 0.4, 1, -17
  );
  rig.hit(Planck.Vec2(0, 0));
  rig.recovering = true;
  rig.recoveryElapsed = 0;
  rig.recoveryPelvisRatio = 0.72;

  const samples = [];
  for (let i = 0; i < 5; i++) {
    CharacterRig.updateRigRecovery(rig, 0.2, () => 0);
    samples.push({
      ratio: rig.recoveryPelvisRatio,
      stiffness: rig.stiffness,
      progress: rig.recoveryProgress
    });
  }

  for (let i = 1; i < samples.length; i++) {
    assert.ok(samples[i].ratio > samples[i - 1].ratio,
      "pelvis should rise progressively rather than snap to standing height");
    assert.ok(samples[i].stiffness > samples[i - 1].stiffness,
      "joint stiffness should ramp smoothly during the get-up");
    assert.ok(samples[i].progress > samples[i - 1].progress);
  }
  assert.ok(samples[0].ratio > 0.72 && samples[0].ratio < 0.95);
  assert.ok(samples.at(-1).ratio > 0.94);
  assert.equal(rig.recoveryProgress, 1);
});
