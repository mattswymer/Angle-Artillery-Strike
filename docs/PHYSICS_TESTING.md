# Physics harness

## Controller foundation

The earlier custom 12-body IK/stance harness is superseded. The current isolated prototype is a small four-joint biped based on the proven control pattern in Gymnasium's Box2D BipedalWalker:

- torso/hull plus two upper and two lower leg bodies
- revolute hip and knee joints with limits and torque-limited motors
- contact detection on the lower legs
- a three-phase gait state machine: support/swing, foot placement, push-off
- joint feedback combines angle error and angular velocity damping
- torso angle/angular velocity feedback is shared across both hips
- vertical velocity damping is shared across both knees
- deterministic seeded spawn offset

Reference implementation:
https://github.com/Farama-Foundation/Gymnasium/blob/main/gymnasium/envs/box2d/bipedal_walker.py

This is a direct architectural reference, not a claim that the current prototype is already stable. The reference walker is designed to move forward; its heuristic is not a stationary standing controller. The harness therefore measures continuous locomotion and ground contact, not a static pose.

## Running

Requires Node 24 and the pinned Planck.js dependency.

```sh
npm install
npm test
```

## Slope cases

The headless Planck suite runs a deterministic three-second locomotion case on 0°, 20°, 35°, and 50° slopes. The intended envelope is to remain upright with repeated ground contact through 35° and lose stance at 50°.

GitHub Actions is the authoritative execution environment when local dependency installation is unavailable. Do not integrate this controller into `src/main.js` until the tests pass and browser behavior is verified.

## Scope

The harness is deliberately isolated. The production game still uses its existing character implementation; `src/main.js` has not been modified by this experiment. The next step after the lower-body walker passes is to add the upper body/head/arms and hit-driven limp behavior without replacing the locomotion foundation.
