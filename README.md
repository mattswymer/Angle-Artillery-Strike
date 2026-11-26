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

The prototype currently includes eight combatants, randomized starting positions and turn order, destructible terrain, direct head/chest/leg hit regions, health bars, floating damage numbers, and distance-falloff blast damage. Direct-hit damage is currently higher than splash damage; these are provisional prototype values, not final weapon balance. Full roster/drafting, camera zoom/pan, AI, scoring, and the complete match loop remain planned. Every character is an articulated twelve-body rig from spawn, with eleven driven joints, local-anchor revolute joints, joint limits, inherited momentum, and hit-location impulses. Direct hits release motor stiffness and let the same rig go limp; recovery requires ground contact and sustained settling. Walking uses alternating physical foot placement and a bounded tangent force. Jumping uses a crouch, motor-driven leg extension, a whole-rig launch impulse, tucked airtime, and a contact-aware two-foot landing. Mobile landscape uses a compact fixed game surface; pullback aiming hides precision sliders until requested, and New game remains available in the HUD.

## License

MIT. See [LICENSE](LICENSE).
