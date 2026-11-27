# Angle Artillery Strike

A mobile-first, landscape 2D artillery tactics game built around physics-driven combat, destructible terrain, procedural battlefields, and tactical AI.

## Project status

**Playable physics prototype; full game systems remain in development.** The current branch has a shared articulated character rig, motor-driven movement and jumping, destructible terrain, projectile physics, hit regions, health/damage, and knockback. The roster/draft, AI, scoring, and complete match loop remain in development.

## Design and development notes

- [Game Design Brief](docs/GAME_DESIGN.md)
- [Technical Plan](docs/TECHNICAL_PLAN.md)

## Running the physics prototype

1. Open `index.html` in a modern browser.
2. Keep an internet connection available so the pinned Planck.js physics library can load from jsDelivr.
3. Use A/D or the arrow keys to move, W/Up/Space to jump, adjust angle and power, and fire. The prototype enforces one action per turn; use **End turn** to switch combatants.

The current prototype uses eight combatants, randomized starting positions and turn order, destructible terrain, direct head/chest/leg hit regions, health bars, floating damage numbers, and distance-falloff blast damage. Direct-hit damage is currently higher than splash damage; these are provisional prototype values, not final weapon balance.

Active combatants now use a single fixed-rotation physics body with a box torso and rounded lower collider. Walking and jumping are direct velocity controls; a ground ray handles support and bounded step-up snapping, while the renderer draws the arms and legs with inverse kinematics. A hit replaces that active collider with the existing twelve-body articulated ragdoll, transferring its position and momentum. Recovery returns to one active body, with a six-second timeout that relocates a stuck combatant to a standable location. The old articulated gait remains only as a ragdoll recovery controller, not as the normal movement system.

The headless test suite covers active-body stability, 0–45 degree slopes, jumping, step-up behavior, ragdoll handoff, and 50 seeded impact/recovery cycles. The roster/draft, AI, scoring, camera zoom/pan, weapon variety, and complete match loop remain in development. Mobile landscape uses a compact fixed game surface; pullback aiming hides precision sliders until requested, and New game remains available in the HUD.

## License

MIT. See [LICENSE](LICENSE).
