# Game Design Brief

## Product direction

A mobile-first, landscape-only, browser-based 2D artillery tactics game inspired by Worms and Pocket Tanks. Desktop browsers are supported. The game begins as a local game: one human versus AI or two humans sharing a device. The architecture should not prevent future online multiplayer, but online play is out of scope for the initial release.

The game should prioritize satisfying physics, readable combat, tactical terrain destruction, and replayability over a large feature count.

## Match structure

- Two teams, four distinct combatants per team.
- Fifteen predefined characters are planned for the initial roster.
- A character can be selected only once in a match; no duplicate character on either team or across teams.
- Teams draft in snake order.
- During a human-controlled draft pick, the player can choose a character, ask the CPU to choose, choose randomly, or delegate all remaining picks to random selection.
- The CPU should consider team composition rather than blindly choosing the same character archetypes.
- Turn order is randomized at match start, alternates teams, and remains fixed for the match. Eliminated characters are skipped.
- On a character's turn, the active player chooses exactly one action: move or attack.
- The turn timer, if enabled, applies to the entire turn.
- No respawns. A team wins when all opposing characters are eliminated.

## Combat

- Every character has a standard attack and a unique special attack.
- Special attacks use character-specific cooldowns; no ammunition limits.
- Do not tune or finalize weapon damage until the physics/combat prototype can be tested.
- Team health is adjustable per match and applies equally to all characters. Individual character health adjustments are not planned.
- Friendly fire is enabled, including self-damage.
- Damage score tracks damage dealt to opponents, not friendly-fire damage.
- Direct damage, splash damage, hit location, knockback, and terrain destruction will be developed after the core physics prototype.
- The player can aim anywhere in the world. Terrain, obstacles, projectile physics, wind, and gravity determine whether a shot can connect.
- A 100-power shot at 45 degrees with no wind should be calibrated to reach from the lower-right region to the upper-left region of the playable battlefield. This is a range benchmark, not a final weapon balance decision.

## Battlefield and boundaries

- Every match uses a newly generated, fixed-dimension battlefield. No handcrafted map selection is planned for the initial direction.
- Terrain geometry and visual theme are randomized.
- Default starting positions are randomized within each team's side. An optional mode may place all characters anywhere.
- The generator must validate reasonable starting separation, accessible ground, and fair initial conditions.
- Random maps should use a reproducible seed for debugging and replay.
- Terrain and environmental objects are destructible. Detached terrain chunks do not automatically fall due to gravity.
- Any fall beyond the left, right, or bottom world boundary is fatal. The top is open and has no lethal boundary. A character launched above the camera remains alive; camera visibility is not a death condition.
- Destroying terrain beneath a character can cause a fatal fall through the bottom boundary.
- Environmental hazards are an optional match setting. When enabled, hazards appear on every generated map in randomized, validated positions.
- Initial hazard candidates: explosive barrels, land mines, and flammable objects. Start with the simplest reliable implementations.
- Hazard placement must not unfairly decide the match before the first turn.

## Movement

- Keep character control simple: walk along terrain and perform a modest jump.
- No climbing, parkour, or large jumps.
- Physics-driven knockback and ragdoll behavior are important to the feel of combat.
- The camera's visible area must remain separate from world boundaries.

## AI

- Three difficulty levels: Easy, Medium, Hard.
- Difficulty primarily changes strategic reasoning, not perfect aim or artificial knowledge.
- Easy understands basic weapon use, when to move, and immediate danger, but does not plan elaborate tactics.
- Medium evaluates positioning, target choice, multi-target opportunities, and terrain destruction.
- Hard evaluates multi-step plans, knockouts, chain reactions, and likely opponent responses.
- AI must obey the same information limits as a human. It should use last-known positions and imperfect estimates rather than knowing hidden enemy locations.
- AI personalities are independent of difficulty. Initial concepts: Aggressive, Demolitionist, Marksman, Defensive, Opportunist, Tactician.
- A human can request an AI to take the current character's turn. The AI decides whether to move or attack.

## Settings

Initial match settings should include:
- Team health (one shared value for all combatants).
- AI difficulty.
- Optional turn timer.
- Wind and wind strength.
- Gravity.
- Friendly fire.
- Environmental hazards on/off.
- Starting position mode: each team on its own side (default) or anywhere.
- Draft choices are part of the live draft flow, not a match setting.

## Presentation

- Landscape-only gameplay.
- Mobile-first touch controls and responsive desktop support.
- Smooth camera movement and zoom; never use camera bounds as world-death boundaries.
- Professional, uncluttered interface.
- Damage numbers, health bars, kill feed, elimination replay, and match statistics are later milestones, not prerequisites for the physics prototype.

## Explicitly deferred

- Online multiplayer.
- Final character roster and character art.
- Final weapon damage and balance.
- Complex environmental hazards.
- Advanced movement abilities.
- Polished menus, drafting UI, match statistics, and replay presentation.
