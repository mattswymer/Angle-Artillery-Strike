# Physics harness

## Current architecture

The headless Planck.js harness now contains two separate physics experiments:

1. **Reference locomotion model** — a port of the lower-body control pattern from Gymnasium's Box2D BipedalWalker. It is retained as a known-good motor/gait reference and runs the existing seeded slope and uneven-terrain locomotion cases.
2. **Character-proportion stance rig** — a separate upright torso with two upper legs, two lower legs, and two articulated feet. Its dimensions and joint limits are based on the production ragdoll geometry in `src/main.js`. It uses the shared joint driver, two-bone IK, terrain-derived pelvis target height, planted foot targets, contact-aware support checks, and a lifted swing target when the center of mass leaves the support interval.

The stance rig has six revolute joints: hips, knees, and ankles. The ankle limits are ±0.6 radians and the feet use high friction. All motor commands pass through the same bounded, stiffness-scaled joint driver:

```js
function driveJoint(j, target, kp, wMax, tauMax, stiffness) {
  const err = wrapAngle(target - j.getJointAngle());
  j.setMotorSpeed(Math.max(-wMax, Math.min(wMax, kp * err)));
  j.setMaxMotorTorque(tauMax * stiffness);
}
```

The two-bone IK solver clamps unreachable targets and has geometry tests for both bend directions. A separate Planck test verifies the revolute-motor sign convention. A regression test also verifies that a swing foot retains its computed lift; a previous assignment accidentally flattened the target back to planted height.

## Upright stance results

**The character-proportion stance rig now uses a torso target upright relative to gravity.** The 20° and 35° slope cases do not tilt the torso to match the terrain.

The key corrections were:

- Use the same knee-bend direction for the common leg posture, with a slope-adaptive bend on the high-side leg at 20°. This keeps the initial ankle joint angles inside the existing ±0.6-radian limits.
- Base balance on the actual planted foot contact-patch bounds rather than treating each foot as a point.
- Predict center-of-mass motion when deciding when to take a corrective step, then place the swing foot ahead of the predicted COM.
- Blend the live hip anchor with the pelvis-height reference. The 35° case uses a 0.8 blend.
- Use 6 Nm hip and knee motor limits for this test rig; ankle torque remains 1.5 Nm. All six motors still use the shared bounded joint driver.

The headless Planck acceptance tests now cover eight fixed seeds on flat, 20°, and 35° terrain. Flat and 20° cases maintain support for the full three seconds with no airtime. The 20° high-side bend is adapted to keep both initial ankle angles within ±0.6 radians.

The 35° full-body case maintains an upright torso (under 10° maximum tilt) and at least 2.9 seconds of support in each three-second run. Its tested configuration uses 0.1× upper-body motor torque while the hips and knees retain 6 Nm limits; this avoids the head and arms overpowering the stance controller. Brief contact-transfer gaps total no more than 0.06 seconds in a run, below the 0.3-second no-contact threshold intended to trigger limp. This is a controlled dynamic stance, not a perfectly motionless two-foot pose.

## Fall detection and recovery

The headless rig now has an explicit `active` / `limp` mode and a stiffness value shared by every joint motor.

- A direct hit immediately sets stiffness to zero and applies the requested velocity change to the torso.
- An upward-facing foot support normal steeper than 50° from vertical begins a 100 ms stiffness fade.
- Predicted COM outside the support envelope for more than 250 ms begins the same fade. A committed corrective swing-foot landing patch is included during a step so normal single-support transfers are not mistaken for a fall.
- No foot contact for more than 300 ms triggers a fall only when the rig is not intentionally jumping.
- Torso tilt beyond 60° triggers the fall fade.
- Recovery waits until average body speed is below 1 m/s and some part of the rig has ground contact. It then ramps stiffness from 0 to 1 over 500 ms and returns to active only after the upright, low-motion, supported stability test remains satisfied for 300 ms.
- If recovery has not succeeded after three seconds, an upward assist is applied only while a foot is touching terrain and is capped at 1.3 times torso body weight.

The tests exercise each trigger, intentional-jump suppression, direct-hit behavior, recovery gating, the stiffness ramp, stable return, and the capped assist. The same recovery controller is shared with the browser game through `src/character-rig.js`; the VM browser-entry smoke test confirms the production module initializes, while interactive recovery still needs browser testing.

The 50° case remains outside the stance controller's stable envelope. The reference gait controller and the character-proportion stance rig are separate experiments; passing one does not imply the other is stable.

A bilateral diagnostic confirms that the rig's initial geometry and a free-flight physics step are mirror-symmetric. The harness simplifies collinear terrain samples before creating connected Planck chains, matching the production terrain contour simplification. A 60-step settling diagnostic remains available for spawn initialization.

## Reference locomotion cases

Reference implementation:
https://github.com/Farama-Foundation/Gymnasium/blob/main/gymnasium/envs/box2d/bipedal_walker.py

The reference model uses a hull, upper/lower leg segments, revolute hip/knee motors, a three-phase gait heuristic, normalized joint feedback, a 50 Hz fixed timestep, and a high solver iteration budget (180 velocity / 60 position iterations). It is designed for forward locomotion, not static standing.

The existing locomotion suite runs three-second cases on 0°, 20°, 35°, and 50° downhill slopes. Eight fixed seeds vary the spawn offset and initial upper-leg angle, for 32 physical runs total. The 0°, 20°, and 35° cases are also repeated on gently uneven deterministic terrain for 24 additional runs. A repeatability test runs the same seed twice and compares physical metrics.

- 0°, 20°, and 35° locomotion cases must remain physically upright and accumulate at least 1.5 seconds of ground-supported time, measured relative to the terrain normal.
- 50° must exceed the controlled locomotion envelope through excessive downhill speed or prolonged airtime.
- Uneven 0°, 20°, and 35° cases must remain upright and accumulate at least 1.5 seconds of ground-supported time.

The 50° test measures loss of controlled gait, not a completed knockdown animation. The uneven profile is a smooth analytic surface represented by short Planck edge segments; it does not yet test abrupt cliffs, craters, or terrain destruction.

## Running

Requires Node 24 and the pinned Planck.js dependency.

```sh
npm install
npm test
```

GitHub Actions is the authoritative execution environment when local dependency installation is unavailable. The suite currently contains 43 tests. It covers reference locomotion, rig structure and motor coverage, IK geometry, motor-sign verification, swing-clearance regression, bilateral symmetry, spawn settling, repeatable flat/20°/35° upright stance acceptance across eight fixed seeds, flat-ground articulated walking, the complete jump/landing cycle, fall-trigger thresholds, and limp recovery. The 35° acceptance allows up to 0.06 seconds of cumulative no-foot-contact time in a three-second run.

## Scope and next steps

The shared `src/character-rig.js` module now drives both the headless harness and the browser game. Real Planck tests validate alternating physical walking steps and the complete crouch/extend/air/land jump cycle, including a two-foot planted landing with the torso returned upright.

Production characters spawn with twelve articulated bodies and eleven driven joints. The capsule-to-ragdoll swap and fake posed renderer are gone. Blast impulses act on the existing rig, and the browser loop uses the shared fall/recovery controller. Movement uses alternating physical foot placement and a bounded tangent force; jumping uses a crouch, motor-driven extension, a coherent whole-rig launch impulse, tucked airtime, and a contact-aware landing phase. Production turn gating requires 300 ms of active stability, auto-advances after three seconds if a combatant cannot act, and waits for all rigs to settle before the next turn (four-second cap). Spawn positions reject terrain grades over 35° and settle for 90 physics steps before the first frame.

The production integration is syntax-checked and exercised in a VM-based browser-entry smoke test with the real Planck engine and TerrainSystem. The test confirms eight combatants are created as 96 articulated bodies and 88 joints before the first animation frame. The shared rig is also headlessly tested with eight simultaneous spawns. Flat-ground walking is validated; uphill walking on a 20° slope is not yet validated, even though static upright stance on that slope passes. This does not replace visual or interactive browser testing. A real desktop and Android browser playtest is still required before merge.
