(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const statusEl = document.getElementById("status");
  const activeNameEl = document.getElementById("active-name");
  const seedLabel = document.getElementById("seed-label");
  const angleInput = document.getElementById("angle");
  const powerInput = document.getElementById("power");
  const angleValue = document.getElementById("angle-value");
  const powerValue = document.getElementById("power-value");
  const fireButton = document.getElementById("fire");
  const endTurnButton = document.getElementById("end-turn");
  const aimModeButton = document.getElementById("aim-mode");

  if (!window.planck) {
    statusEl.textContent = "Physics library failed to load";
    statusEl.style.color = "#ff9b8f";
    return;
  }

  const P = window.planck;
  const V = P.Vec2;
  const WORLD_WIDTH = 24;
  const WORLD_HEIGHT = 13.5;
  const TERRAIN_SAMPLES = 121;
  const FIXED_STEP = 1 / 60;
  const GRAVITY = 10;
  const POWER_100_SPEED = Math.sqrt(WORLD_WIDTH * GRAVITY);
  const COLORS = ["#287bd1", "#d64d4d"];
  let world;
  let terrainBody;
  let terrainSystem;
  let terrainHeights = [];
  let characters = [];
  let damagePopups = [];
  let activeIndex = 0;
  let aimMode = "pullback";
  let pullbackPointer = null;
  let pullbackOrigin = null;
  let pullbackDistance = 0;
  let projectile = null;
  let projectilePrevious = null;
  let impactPoint = null;
  let projectileHit = null;
  let pendingImpact = false;
  let seed = 1;
  let held = { left: false, right: false, jump: false };
  let tapMoveDirection = 0;
  let tapMoveRemaining = 0;
  let activeAction = null;
  let jumpQueued = false;
  let jumpBufferTime = 0;
  let coyoteTime = 0;
  let lastFrame = 0;
  let accumulator = 0;
  let cameraY = 0;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let pixelRatio = 1;

  function mulberry32(value) {
    return function () {
      let t = value += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function randomSeed() {
    return Math.floor(Math.random() * 0x7fffffff) || 1;
  }

  function heightAt(x) {
    const position = Math.max(0, Math.min(TERRAIN_SAMPLES - 1, x / WORLD_WIDTH * (TERRAIN_SAMPLES - 1)));
    const left = Math.floor(position);
    const right = Math.min(TERRAIN_SAMPLES - 1, left + 1);
    const blend = position - left;
    return terrainHeights[left] * (1 - blend) + terrainHeights[right] * blend;
  }

  function generateTerrain(random) {
    terrainHeights = [];
    let noise = 0;
    for (let i = 0; i < TERRAIN_SAMPLES; i++) {
      noise = noise * 0.72 + (random() - 0.5) * 0.62;
      const x = i / (TERRAIN_SAMPLES - 1);
      const broad = Math.sin(x * Math.PI * 2.1 + 0.4) * 0.78;
      const ridge = Math.sin(x * Math.PI * 4.7 + 1.7) * 0.28;
      terrainHeights.push(Math.max(2.2, Math.min(5.2, 3.55 + broad + ridge + noise)));
    }

    // Smooth the generated height profile without flattening its larger hills and valleys.
    const source = terrainHeights.slice();
    const weights = [1, 4, 6, 4, 1];
    for (let i = 0; i < TERRAIN_SAMPLES; i++) {
      let total = 0;
      let weightTotal = 0;
      for (let offset = -2; offset <= 2; offset++) {
        const sampleIndex = Math.max(0, Math.min(TERRAIN_SAMPLES - 1, i + offset));
        const weight = weights[offset + 2];
        total += source[sampleIndex] * weight;
        weightTotal += weight;
      }
      terrainHeights[i] = Math.max(2.2, Math.min(5.2, total / weightTotal));
    }
  }

  function rebuildTerrain() {
    terrainSystem.rebuildPhysics();
    terrainBody = terrainSystem.body;
  }

  function shuffle(values, random) {
    const result = values.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function randomTeamPositions(random, minX, maxX, count) {
    const positions = [];
    let attempts = 0;
    while (positions.length < count && attempts++ < 500) {
      const candidate = minX + random() * (maxX - minX);
      if (positions.every(x => Math.abs(x - candidate) >= 1.35)) positions.push(candidate);
    }
    if (positions.length < count) {
      positions.length = 0;
      const spacing = (maxX - minX) / count;
      for (let i = 0; i < count; i++) {
        positions.push(minX + spacing * (i + 0.5));
      }
    }
    return shuffle(positions, random);
  }

  function makeCharacter(team, number, x) {
    const y = heightAt(x) + 0.78;
    const body = world.createBody({
      type: "dynamic",
      position: V(x, y),
      fixedRotation: true,
      linearDamping: 0.7,
      allowSleep: false,
      userData: { kind: "character", team, number }
    });
    const hitboxes = [
      { location: "head", shape: new P.Circle(V(0, 0.49), 0.14), density: 0.75 },
      { location: "chest", shape: new P.Box(0.17, 0.29, V(0, 0.04)), density: 1.5 },
      { location: "legs", shape: new P.Box(0.13, 0.28, V(0, -0.53)), density: 1.1 }
    ];
    for (const hitbox of hitboxes) {
      const fixture = body.createFixture({
        shape: hitbox.shape,
        density: hitbox.density,
        friction: 0.82,
        restitution: 0.02
      });
      fixture.setUserData({ kind: "character", location: hitbox.location });
    }
    return {
      body, team, number, color: COLORS[team], grounded: false, eliminated: false,
      health: 100, maxHealth: 100, aimAngle: team === 0 ? 0 : 180, aimPower: 100,
      grounded: true, ragdoll: null
    };
  }

  function createWorld() {
    world = new P.World({ gravity: V(0, -GRAVITY) });
    world.setAllowSleeping(false);
    world.on("begin-contact", contact => {
      const bodyA = contact.getFixtureA().getBody();
      const bodyB = contact.getFixtureB().getBody();
      const a = bodyA.getUserData();
      const b = bodyB.getUserData();
      if (a?.kind === "projectile" || b?.kind === "projectile") pendingImpact = true;
    });
    const random = mulberry32(seed);
    generateTerrain(random);
    terrainSystem = new window.TerrainSystem(P, world, WORLD_WIDTH, WORLD_HEIGHT + 3, 0.05, -3, terrainHeights);
    rebuildTerrain();

    const bluePositions = randomTeamPositions(random, 0.9, 11.1, 4);
    const redPositions = randomTeamPositions(random, 12.9, 23.1, 4);
    const blueTeam = bluePositions.map((x, index) => makeCharacter(0, index + 1, x));
    const redTeam = redPositions.map((x, index) => makeCharacter(1, index + 1, x));
    const firstTeam = random() < 0.5 ? 0 : 1;
    const firstOrder = shuffle(firstTeam === 0 ? blueTeam : redTeam, random);
    const secondOrder = shuffle(firstTeam === 0 ? redTeam : blueTeam, random);
    characters = firstOrder.map((character, index) => [character, secondOrder[index]]).flat();
    damagePopups = [];
    activeIndex = 0;
    activeAction = null;
    projectile = null;
    projectilePrevious = null;
    impactPoint = null;
    projectileHit = null;
    pendingImpact = false;
    cameraY = 0;
    restoreActiveAim();
    updateHud();
    statusEl.textContent = "Physics running";
    statusEl.style.color = "#9fb0ba";
  }

  function activeCharacter() {
    return characters[activeIndex];
  }

  function updateHud() {
    const active = activeCharacter();
    activeNameEl.textContent = active ? (active.team === 0 ? "Blue" : "Red") + " " + active.number : "—";
    seedLabel.textContent = "Seed " + seed;
    fireButton.textContent = "Fire";
    fireButton.disabled = activeAction === "move" || activeAction === "attack" || Boolean(projectile);
  }

  function setAimLabels() {
    angleValue.value = angleInput.value + "°";
    powerValue.value = powerInput.value;
  }

  function isGrounded(character) {
    const p = character.body.getPosition();
    let found = false;
    world.rayCast(V(p.x, p.y - 0.77), V(p.x, p.y - 0.91), (fixture, point, normal, fraction) => {
      if (fixture.getBody() === character.body) return -1;
      if (fixture.getBody().getUserData()?.kind === "terrain") {
        found = true;
        return fraction;
      }
      return -1;
    });
    return found;
  }

  function stepHeightAhead(character, direction) {
    const position = character.body.getPosition();
    const footY = position.y - 0.81;
    const probeX = position.x + direction * 0.32;
    let surfaceY = null;

    world.rayCast(V(probeX, position.y + 0.55), V(probeX, position.y - 0.5),
      (fixture, point, normal, fraction) => {
        if (fixture.getBody().getUserData()?.kind !== "terrain") return -1;
        surfaceY = point.y;
        return fraction;
      });

    if (surfaceY === null) return 0;
    return surfaceY - footY;
  }

  function moveActive() {
    const character = activeCharacter();
    if (!character || character.eliminated || (character.ragdoll && !character.ragdoll.standing) || projectile || activeAction === "attack") return;
    const velocity = character.body.getLinearVelocity();
    const heldDirection = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    let direction = heldDirection || (tapMoveRemaining > 0 ? tapMoveDirection : 0);
    const requestedDirection = direction;
    if (tapMoveRemaining > 0) {
      tapMoveRemaining = Math.max(0, tapMoveRemaining - FIXED_STEP);
      if (tapMoveRemaining === 0) tapMoveDirection = 0;
    }

    // Other combatants are solid obstacles, but ordinary walking cannot shove them.
    let blockedByCharacter = false;
    if (direction) {
      const position = character.body.getPosition();
      blockedByCharacter = characters.some(other => {
        if (other === character || other.eliminated) return false;
        const otherPosition = other.body.getPosition();
        const dx = otherPosition.x - position.x;
        const dy = Math.abs(otherPosition.y - position.y);
        return dx * direction > 0 && Math.abs(dx) < 0.58 && dy < 1.25;
      });
      if (blockedByCharacter) direction = 0;
    }
    if ((requestedDirection || held.jump || jumpQueued) && activeAction !== "move") {
      activeAction = "move";
      statusEl.textContent = "Movement action — firing is locked until the next turn";
      updateHud();
    }

    let verticalVelocity = velocity.y;
    const grounded = isGrounded(character);
    character.grounded = grounded;
    if (grounded) coyoteTime = 0.12;
    else coyoteTime = Math.max(0, coyoteTime - FIXED_STEP);
    if (held.jump || jumpQueued) jumpBufferTime = 0.16;
    else jumpBufferTime = Math.max(0, jumpBufferTime - FIXED_STEP);
    if (direction && grounded) {
      const stepHeight = stepHeightAhead(character, direction);
      if (stepHeight > 0.07 && stepHeight <= 0.4) {
        verticalVelocity = Math.max(verticalVelocity, 2.8);
      }
    }

    if (direction) character.body.setLinearVelocity(V(direction * 3.4, verticalVelocity));
    else if (blockedByCharacter) character.body.setLinearVelocity(V(0, verticalVelocity));
    else character.body.setLinearVelocity(V(velocity.x * 0.78, verticalVelocity));

    if (jumpBufferTime > 0 && coyoteTime > 0) {
      character.body.setLinearVelocity(V(character.body.getLinearVelocity().x, 3.9));
      jumpBufferTime = 0;
      coyoteTime = 0;
      jumpQueued = false;
    }
  }

  function fire() {
    const character = activeCharacter();
    if (!character || character.eliminated || (character.ragdoll && !character.ragdoll.standing) || projectile || activeAction === "move" || activeAction === "attack") return;
    activeAction = "attack";
    updateHud();
    const angle = Number(angleInput.value) * Math.PI / 180;
    const power = Number(powerInput.value) / 100;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const p = character.body.getPosition();
    const start = V(p.x + dx * 0.42, p.y + dy * 0.72 + 0.05);
    const body = world.createBody({
      type: "dynamic",
      position: start,
      bullet: true,
      linearDamping: 0,
      userData: { kind: "projectile" }
    });
    const fixture = body.createFixture({ shape: new P.Circle(0.105), density: 0.18, restitution: 0.18, friction: 0.2 });
    fixture.setUserData({ kind: "projectile" });
    const speed = POWER_100_SPEED * power;
    body.setLinearVelocity(V(dx * speed, dy * speed));
    projectile = body;
    projectilePrevious = V(start.x, start.y);
    impactPoint = null;
    projectileHit = null;
    pendingImpact = false;
    statusEl.textContent = "Projectile in flight — wait for impact, then end turn";
    fireButton.disabled = true;
  }

  function createRagdoll(character, impact, hitLocation = "chest") {
    if (character.ragdoll) return;
    const oldBody = character.body;
    const origin = oldBody.getPosition();
    const inheritedVelocity = oldBody.getLinearVelocity();
    const inheritedSpin = oldBody.getAngularVelocity();
    const pieces = [];
    const byName = {};
    const addPart = (name, x, y, halfWidth, halfHeight, density, circle = false) => {
      const body = world.createBody({
        type: "dynamic",
        position: V(origin.x + x, origin.y + y),
        linearDamping: 0.02,
        angularDamping: 0.08,
        allowSleep: false,
        userData: { kind: "character", team: character.team, number: character.number, ragdoll: true, part: name }
      });
      // A negative group index prevents this character's overlapping ragdoll
      // segments from colliding with one another, while preserving terrain and
      // other-character collisions.
      const collisionGroup = -((character.team * 4) + character.number);
      const lowerArm = name.includes("lower-arm");
      const lowerLeg = name.includes("lower-leg");
      const fixture = body.createFixture({
        shape: circle ? new P.Circle(halfWidth) : new P.Box(halfWidth, halfHeight),
        density, friction: lowerLeg ? 0.88 : 0.18, restitution: 0.04,
        // Hands stay non-blocking while tumbling; feet remain physical supports.
        isSensor: lowerArm,
        filterGroupIndex: collisionGroup
      });
      fixture.setUserData({
        kind: "character",
        location: name === "head" ? "head" : name.includes("leg") ? "legs" : "chest",
        ragdollPart: name
      });
      const piece = { name, body, halfWidth, halfHeight, circle };
      pieces.push(piece);
      byName[name] = piece;
      // Preserve momentum at each segment's center, including the tangential part
      // of any angular velocity inherited from the original character body.
      body.setLinearVelocity(V(
        inheritedVelocity.x - inheritedSpin * y,
        inheritedVelocity.y + inheritedSpin * x
      ));
      body.setAngularVelocity(inheritedSpin);
      return body;
    };

    // Segment centers and local hinge anchors are aligned exactly at creation.
    // Keep the torso relatively light and give the limbs enough mass to
    // carry their own momentum instead of being dragged like weightless strings.
    const torso = addPart("torso", 0, 0, 0.17, 0.29, 1.5);
    const head = addPart("head", 0, 0.47, 0.135, 0.135, 1.05, true);
    const leftUpperArm = addPart("left-upper-arm", -0.17, 0.03, 0.065, 0.19, 0.8);
    const leftLowerArm = addPart("left-lower-arm", -0.17, -0.33, 0.055, 0.17, 0.8);
    const rightUpperArm = addPart("right-upper-arm", 0.17, 0.03, 0.065, 0.19, 0.8);
    const rightLowerArm = addPart("right-lower-arm", 0.17, -0.33, 0.055, 0.17, 0.8);
    const leftUpperLeg = addPart("left-upper-leg", -0.105, -0.455, 0.075, 0.205, 1.15);
    const leftLowerLeg = addPart("left-lower-leg", -0.105, -0.83, 0.06, 0.17, 1.1);
    const rightUpperLeg = addPart("right-upper-leg", 0.105, -0.455, 0.075, 0.205, 1.15);
    const rightLowerLeg = addPart("right-lower-leg", 0.105, -0.83, 0.06, 0.17, 1.1);

    const hinge = (bodyA, bodyB, anchorA, anchorB, lower, upper) => {
      const sharedWorldAnchor = bodyA.getWorldPoint(V(anchorA[0], anchorA[1]));
      const otherAnchor = bodyB.getWorldPoint(V(anchorB[0], anchorB[1]));
      const mismatch = Math.hypot(
        sharedWorldAnchor.x - otherAnchor.x,
        sharedWorldAnchor.y - otherAnchor.y
      );
      // Catch bad segment placement immediately instead of creating a joint
      // whose two ends begin at different coordinates.
      if (mismatch > 0.002) throw new Error("Ragdoll joint anchors do not line up: " + mismatch);
      return world.createJoint(new P.RevoluteJoint({
        enableLimit: true,
        lowerAngle: lower,
        upperAngle: upper,
        referenceAngle: 0,
        collideConnected: false
      }, bodyA, bodyB, sharedWorldAnchor));
    };

    const jointMap = {
      neck: hinge(torso, head, [0, 0.29], [0, -0.18], -0.8, 0.8),
      leftShoulder: hinge(torso, leftUpperArm, [-0.17, 0.22], [0, 0.19], -2.35, 1.5),
      leftElbow: hinge(leftUpperArm, leftLowerArm, [0, -0.19], [0, 0.17], -2.45, 2.45),
      rightShoulder: hinge(torso, rightUpperArm, [0.17, 0.22], [0, 0.19], -1.5, 2.35),
      rightElbow: hinge(rightUpperArm, rightLowerArm, [0, -0.19], [0, 0.17], -2.45, 2.45),
      leftHip: hinge(torso, leftUpperLeg, [-0.105, -0.25], [0, 0.205], -1.25, 1.25),
      leftKnee: hinge(leftUpperLeg, leftLowerLeg, [0, -0.205], [0, 0.17], -0.25, 2.2),
      rightHip: hinge(torso, rightUpperLeg, [0.105, -0.25], [0, 0.205], -1.25, 1.25),
      rightKnee: hinge(rightUpperLeg, rightLowerLeg, [0, -0.205], [0, 0.17], -2.2, 0.25)
    };
    const joints = Object.values(jointMap);
    for (const joint of joints) {
      joint.enableMotor(true);
      joint.setMotorSpeed(0);
      joint.setMaxMotorTorque(0);
    }

    character.body = torso;
    character.ragdoll = {
      pieces, byName, joints, jointMap, torso, elapsedTime: 0,
      settledTime: 0, hitLocation, gettingUp: false, getUpElapsed: 0,
      standing: false, facing: character.team === 0 ? 1 : -1
    };
    // The old upright hitbox was shorter than the articulated body. Clear any
    // overlap created when converting it into a full ragdoll before applying blast force.
    liftRagdollOutOfTerrain(character.ragdoll);
    world.destroyBody(oldBody);

  }

  // Apply a requested change in velocity, not a fixed impulse. Multiplying
  // by each part's mass makes every segment receive comparable acceleration.
  function blastRagdoll(ragdoll, origin, strength, radius, hitLocation = null) {
    const hitPartName = hitLocation === "head" ? "head" :
      hitLocation === "legs" ? "left-upper-leg" : "torso";
    const hitBody = hitLocation ? ragdoll.byName[hitPartName]?.body : null;
    for (const { body } of ragdoll.pieces) {
      const center = body.getWorldCenter();
      const dx = center.x - origin.x;
      const dy = center.y - origin.y;
      const distance = Math.max(0.1, Math.hypot(dx, dy));
      const falloff = Math.max(0, 1 - distance / radius);
      if (falloff <= 0) continue;
      const deltaV = strength * falloff;
      const mass = body.getMass();
      const impulse = V(
        (dx / distance * deltaV) * mass,
        (dy / distance * deltaV + 0.5 * falloff) * mass
      );
      // Apply the direct-hit impulse at the projectile contact point so the
      // hit can generate natural torque instead of an artificial spin impulse.
      body.applyLinearImpulse(impulse, body === hitBody ? origin : center, true);
    }
  }

  function ragdollIntersectsTerrain(ragdoll) {
    const supportParts = new Set([
      "torso", "head", "left-upper-arm", "right-upper-arm",
      "left-upper-leg", "right-upper-leg"
    ]);
    for (const piece of ragdoll.pieces) {
      if (!supportParts.has(piece.name)) continue;
      const points = piece.circle
        ? [[0, 0], [piece.halfWidth * 0.7, 0], [-piece.halfWidth * 0.7, 0],
          [0, piece.halfWidth * 0.7], [0, -piece.halfWidth * 0.7]]
        : [[0, 0],
          [piece.halfWidth * 0.8, piece.halfHeight * 0.8],
          [-piece.halfWidth * 0.8, piece.halfHeight * 0.8],
          [piece.halfWidth * 0.8, -piece.halfHeight * 0.8],
          [-piece.halfWidth * 0.8, -piece.halfHeight * 0.8]];
      for (const local of points) {
        const point = piece.body.getWorldPoint(V(local[0], local[1]));
        const cellX = Math.floor(point.x / terrainSystem.cellSize);
        const cellY = Math.floor((point.y - terrainSystem.originY) / terrainSystem.cellSize);
        if (terrainSystem.isSolid(cellX, cellY)) return true;
      }
    }
    return false;
  }

  function liftRagdollOutOfTerrain(ragdoll) {
    let lifted = 0;
    while (lifted < 2.0 && ragdollIntersectsTerrain(ragdoll)) {
      for (const piece of ragdoll.pieces) {
        const body = piece.body;
        const position = body.getPosition();
        body.setTransform(V(position.x, position.y + 0.04), body.getAngle());
        body.setAwake(true);
      }
      lifted += 0.04;
    }
    if (lifted > 0) {
      for (const piece of ragdoll.pieces) {
        const body = piece.body;
        const velocity = body.getLinearVelocity();
        body.setLinearVelocity(V(velocity.x, Math.max(0, velocity.y * 0.25)));
        body.setAngularVelocity(body.getAngularVelocity() * 0.35);
      }
    }
    return lifted;
  }

  function ragdollHasGroundContact(ragdoll) {
    return ragdoll.pieces.some(piece => {
      if (!piece.name.includes("upper-leg") && piece.name !== "torso") return false;
      const body = piece.body;
      const position = body.getPosition();
      const angle = body.getAngle();
      const verticalExtent = piece.circle ? piece.halfWidth :
        Math.abs(Math.cos(angle)) * piece.halfHeight + Math.abs(Math.sin(angle)) * piece.halfWidth;
      let grounded = false;
      world.rayCast(
        V(position.x, position.y - verticalExtent - 0.025),
        V(position.x, position.y - verticalExtent - 0.22),
        (fixture, point, normal, fraction) => {
          if (fixture.getBody().getUserData()?.kind === "terrain") {
            grounded = true;
            return fraction;
          }
          return -1;
        }
      );
      return grounded;
    });
  }

  function wrapAngle(angle) {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  }

  function setJointTarget(joint, target, maxTorque, gain = 8, damping = 1.4) {
    const error = wrapAngle(target - joint.getJointAngle());
    const speed = Math.max(-6, Math.min(6, error * gain - joint.getJointSpeed() * damping));
    joint.setMotorSpeed(speed);
    joint.setMaxMotorTorque(maxTorque);
  }

  function setBodyUpright(body, torqueScale = 16, damping = 3.2) {
    const angle = wrapAngle(body.getAngle());
    body.applyTorque(-angle * torqueScale - body.getAngularVelocity() * damping, true);
    return Math.abs(angle);
  }

  function terrainHeightBelow(x, y, distance = 2.2) {
    let surface = null;
    world.rayCast(V(x, y + 0.25), V(x, y - distance), (fixture, point, normal, fraction) => {
      if (fixture.getBody().getUserData()?.kind !== "terrain") return -1;
      surface = point.y;
      return fraction;
    });
    return surface;
  }

  function getRagdollGround(ragdoll, name, rayStartOffset = 0.2, rayLength = 1.4) {
    const body = ragdoll.byName[name].body;
    const foot = body.getWorldPoint(V(0, -0.17));
    let hit = null;
    world.rayCast(V(foot.x, foot.y + rayStartOffset), V(foot.x, foot.y - rayLength),
      (fixture, point, normal, fraction) => {
        if (fixture.getBody().getUserData()?.kind !== "terrain") return -1;
        hit = { x: point.x, y: point.y, normal: V(normal.x, normal.y), fraction };
        return fraction;
      });
    return hit;
  }

  function ragdollGroundProfile(ragdoll) {
    const left = getRagdollGround(ragdoll, "left-lower-leg", 0.28, 1.6);
    const right = getRagdollGround(ragdoll, "right-lower-leg", 0.28, 1.6);
    if (!left || !right) return null;
    const dx = right.x - left.x;
    const dy = right.y - left.y;
    const slope = Math.atan2(dy, Math.max(0.001, Math.abs(dx)));
    return { left, right, slope, averageY: (left.y + right.y) * 0.5 };
  }

  function ragdollHasGroundContact(ragdoll) {
    return ["left-lower-leg", "right-lower-leg", "left-lower-arm", "right-lower-arm",
      "left-upper-leg", "right-upper-leg", "torso"].some(name => {
      const body = ragdoll.byName[name].body;
      const center = body.getPosition();
      let found = false;
      world.rayCast(V(center.x, center.y + 0.12), V(center.x, center.y - 0.55),
        (fixture, point, normal, fraction) => {
          if (fixture.getBody().getUserData()?.kind !== "terrain") return -1;
          found = true;
          return fraction;
        });
      return found;
    });
  }

  function ragdollIsStable(ragdoll) {
    const profile = ragdollGroundProfile(ragdoll);
    if (!profile || Math.abs(profile.slope) > Math.PI / 4) return false;
    const torso = ragdoll.torso;
    const torsoAngle = Math.abs(wrapAngle(torso.getAngle()));
    const torsoPosition = torso.getPosition();
    const centerX = torsoPosition.x;
    const supportMin = Math.min(profile.left.x, profile.right.x) - 0.12;
    const supportMax = Math.max(profile.left.x, profile.right.x) + 0.12;
    const comInsideSupport = centerX >= supportMin && centerX <= supportMax;
    const lowMotion = ragdoll.pieces.every(piece =>
      piece.body.getLinearVelocity().length() < 0.55 &&
      Math.abs(piece.body.getAngularVelocity()) < 1.5);
    return torsoAngle < 0.22 && comInsideSupport && lowMotion;
  }

  function getUpPose(ragdoll, phase) {
    // The pose targets are relative joint angles. Each phase is held until
    // physical contact/orientation conditions are met, not a fixed animation time.
    if (phase === "roll") return {
      leftHip: -0.9, rightHip: -0.9, leftKnee: 1.4, rightKnee: -1.4,
      leftShoulder: 1.0, rightShoulder: -1.0,
      leftElbow: 0.8, rightElbow: -0.8, neck: 0
    };
    if (phase === "hands-knees") return {
      leftHip: -0.75, rightHip: -0.75, leftKnee: 1.35, rightKnee: -1.35,
      leftShoulder: -0.95, rightShoulder: 0.95,
      leftElbow: 1.15, rightElbow: -1.15, neck: 0
    };
    if (phase === "half-kneel") return {
      leftHip: -0.45, rightHip: -0.05, leftKnee: 1.15, rightKnee: -0.15,
      leftShoulder: -0.65, rightShoulder: 0.65,
      leftElbow: 0.45, rightElbow: -0.45, neck: 0
    };
    return {
      leftHip: 0, rightHip: 0, leftKnee: 0, rightKnee: 0,
      leftShoulder: 0, rightShoulder: 0,
      leftElbow: 0, rightElbow: 0, neck: 0
    };
  }

  function applyRecoveryPose(ragdoll, phase) {
    const targets = getUpPose(ragdoll, phase);
    for (const [name, joint] of Object.entries(ragdoll.jointMap)) {
      setJointTarget(joint, targets[name] ?? 0, name.includes("Hip") || name.includes("Knee") ? 2.8 : 1.8, 7, 1.5);
    }
  }

  function beginRecovery(ragdoll) {
    ragdoll.gettingUp = true;
    ragdoll.standing = false;
    ragdoll.recoveryPhase = "roll";
    ragdoll.phaseTime = 0;
    ragdoll.recoveryAttempts = (ragdoll.recoveryAttempts || 0) + 1;
    ragdoll.pieces.forEach(piece => {
      piece.body.setAwake(true);
      const velocity = piece.body.getLinearVelocity();
      piece.body.setLinearVelocity(V(velocity.x * 0.35, velocity.y * 0.25));
      piece.body.setAngularVelocity(piece.body.getAngularVelocity() * 0.25);
    });
  }

  function driveGetUp(ragdoll) {
    const phase = ragdoll.recoveryPhase;
    const torso = ragdoll.torso;
    const torsoAngle = Math.abs(wrapAngle(torso.getAngle()));
    const torsoPosition = torso.getPosition();
    const ground = ragdollGroundProfile(ragdoll);
    ragdoll.phaseTime += FIXED_STEP;

    if (phase === "roll") {
      // First turn the torso face-up into a side/prone recovery orientation.
      const direction = wrapAngle(torso.getAngle()) > 0 ? -1 : 1;
      torso.applyTorque(direction * torso.getInertia() * 7 - torso.getAngularVelocity() * torso.getInertia() * 2.4, true);
      applyRecoveryPose(ragdoll, "roll");
      if (torsoAngle < 0.48 && ragdollHasGroundContact(ragdoll) && ragdoll.phaseTime > 0.25) {
        ragdoll.recoveryPhase = "hands-knees";
        ragdoll.phaseTime = 0;
      } else if (ragdoll.phaseTime > 2.2) {
        // Try the opposite roll direction when wedged against terrain.
        ragdoll.recoveryPhase = "roll";
        ragdoll.phaseTime = 0;
        ragdoll.rollDirection = -(ragdoll.rollDirection || 1);
        torso.applyTorque(ragdoll.rollDirection * torso.getInertia() * 10, true);
      }
      return;
    }

    if (phase === "hands-knees") {
      setBodyUpright(torso, 10, 2.8);
      applyRecoveryPose(ragdoll, phase);
      const hands = ["left-lower-arm", "right-lower-arm"].filter(name => {
        const body = ragdoll.byName[name].body;
        const p = body.getPosition();
        return terrainHeightBelow(p.x, p.y, 0.65) !== null;
      }).length;
      const knees = ["left-lower-leg", "right-lower-leg"].filter(name => {
        const body = ragdoll.byName[name].body;
        const p = body.getPosition();
        return terrainHeightBelow(p.x, p.y, 0.65) !== null;
      }).length;
      if ((hands + knees >= 3 && torsoAngle < 0.75) || ragdoll.phaseTime > 2.5) {
        ragdoll.recoveryPhase = "half-kneel";
        ragdoll.phaseTime = 0;
      }
      return;
    }

    if (phase === "half-kneel") {
      setBodyUpright(torso, 14, 3.2);
      applyRecoveryPose(ragdoll, phase);
      if (ground && torsoAngle < 0.38 && ragdoll.phaseTime > 0.25) {
        ragdoll.recoveryPhase = "stand";
        ragdoll.phaseTime = 0;
      } else if (ragdoll.phaseTime > 2.5) {
        ragdoll.recoveryPhase = "hands-knees";
        ragdoll.phaseTime = 0;
      }
      return;
    }

    // Stand phase: upright torso, extended legs, and actual two-foot support.
    setBodyUpright(torso, 20, 4.0);
    applyRecoveryPose(ragdoll, "stand");
    if (ground) {
      const targetY = ground.averageY + 1.02;
      const error = targetY - torsoPosition.y;
      torso.applyForceToCenter(V(0, Math.max(-torso.getMass() * 5,
        Math.min(torso.getMass() * 12, error * torso.getMass() * 24))), true);
      const horizontalError = ((ground.left.x + ground.right.x) * 0.5) - torsoPosition.x;
      torso.applyForceToCenter(V(Math.max(-torso.getMass() * 4,
        Math.min(torso.getMass() * 4, horizontalError * torso.getMass() * 8)), 0), true);
    }

    if (ragdollIsStable(ragdoll)) ragdoll.stableTime = (ragdoll.stableTime || 0) + FIXED_STEP;
    else ragdoll.stableTime = 0;
    if (ragdoll.stableTime >= 0.35) {
      ragdoll.gettingUp = false;
      ragdoll.standing = true;
      ragdoll.recoveryPhase = null;
      ragdoll.elapsedTime = 0;
      ragdoll.stableTime = 0;
      ragdoll.joints.forEach(joint => joint.setMaxMotorTorque(1.4));
      return;
    }
    if (ragdoll.phaseTime > 3.0) {
      // Recovery is not declared successful. Reposition the physical support
      // limbs and retry instead of leaving a sprawled character marked standing.
      ragdoll.recoveryPhase = "hands-knees";
      ragdoll.phaseTime = 0;
      ragdoll.stableTime = 0;
    }
  }

  function driveStandingRagdoll(ragdoll) {
    const profile = ragdollGroundProfile(ragdoll);
    if (!profile || Math.abs(profile.slope) > Math.PI / 4) {
      ragdoll.terrainMode = "sliding";
      ragdoll.joints.forEach(joint => joint.setMaxMotorTorque(0.18));
      return;
    }
    ragdoll.terrainMode = "supported";
    const slope = profile.slope;
    setBodyUpright(ragdoll.torso, 18, 3.5);
    const targets = {
      leftHip: -slope * 0.35, rightHip: -slope * 0.35,
      leftKnee: slope * 0.2, rightKnee: -slope * 0.2,
      leftShoulder: 0, rightShoulder: 0, leftElbow: 0, rightElbow: 0, neck: 0
    };
    for (const [name, joint] of Object.entries(ragdoll.jointMap)) {
      setJointTarget(joint, targets[name] || 0, name.includes("Hip") || name.includes("Knee") ? 1.3 : 0.5, 6, 1.8);
    }
    const torsoPosition = ragdoll.torso.getPosition();
    const heightError = profile.averageY + 1.02 - torsoPosition.y;
    ragdoll.torso.applyForceToCenter(V(0, Math.max(-ragdoll.torso.getMass() * 3,
      Math.min(ragdoll.torso.getMass() * 7, heightError * ragdoll.torso.getMass() * 16))), true);
  }

  function recoverRagdolls() {
    for (const character of characters) {
      const ragdoll = character.ragdoll;
      if (!ragdoll) continue;
      if (character.eliminated) {
        ragdoll.elapsedTime += FIXED_STEP;
        if (ragdoll.elapsedTime >= 4.5) {
          ragdoll.pieces.forEach(piece => world.destroyBody(piece.body));
          character.ragdoll = null;
        }
        continue;
      }
      if (!ragdoll.gettingUp && !ragdoll.standing) {
        const averageSpeed = ragdoll.pieces.reduce((sum, piece) =>
          sum + piece.body.getLinearVelocity().length(), 0) / ragdoll.pieces.length;
        const averageSpin = ragdoll.pieces.reduce((sum, piece) =>
          sum + Math.abs(piece.body.getAngularVelocity()), 0) / ragdoll.pieces.length;
        ragdoll.elapsedTime += FIXED_STEP;
        const settled = ragdoll.elapsedTime > 0.25 && ragdollHasGroundContact(ragdoll) &&
          averageSpeed < 1.0 && averageSpin < 2.8;
        ragdoll.settledTime = settled ? ragdoll.settledTime + FIXED_STEP : 0;
        if (ragdoll.settledTime >= 0.18 || ragdoll.elapsedTime >= 1.8) {
          beginRecovery(ragdoll);
        }
        continue;
      }
      if (ragdoll.gettingUp) driveGetUp(ragdoll);
    }
  }

  function explode() {
    if (!projectile) return;
    const currentPosition = projectile.getPosition();
    const point = impactPoint || currentPosition;
    world.destroyBody(projectile);
    projectile = null;
    projectilePrevious = null;
    impactPoint = null;
    const directHit = projectileHit;
    projectileHit = null;
    const radius = 1.7;
    const blastRadius = 2.6;
    const removedCells = terrainSystem.carveCircle(point.x, point.y, radius);
    rebuildTerrain();
    // Destruction can leave existing articulated bodies intersecting a newly
    // exposed crater wall. Resolve that before contacts and get-up motors fight it.
    for (const character of characters) {
      if (character.ragdoll && !character.eliminated) liftRagdollOutOfTerrain(character.ragdoll);
    }
    const damageEvents = [];

    for (const character of characters) {
      if (character.eliminated) continue;
      const p = character.body.getPosition();
      const dx = p.x - point.x;
      const dy = p.y - point.y;
      const distance = Math.hypot(dx, dy);
      const isDirectTarget = directHit?.character === character;
      let damage = 0;
      if (isDirectTarget) {
        if (!character.ragdoll) createRagdoll(character, point, directHit.location);
        damage = { head: 40, chest: 30, legs: 20 }[directHit.location];
      } else if (distance < blastRadius) {
        damage = Math.round(18 * (1 - distance / blastRadius));
      }
      if (damage > 0) {
        character.health = Math.max(0, character.health - damage);
        damageEvents.push({ character, damage, direct: isDirectTarget, location: isDirectTarget ? directHit.location : "splash" });
        damagePopups.push({
          x: p.x, y: p.y + 0.9, damage, direct: isDirectTarget,
          expires: performance.now() + 1100
        });
        if (character.health <= 0) {
          character.eliminated = true;
          if (character.ragdoll) character.ragdoll.pieces.forEach(piece => piece.body.setActive(false));
          else character.body.setActive(false);
        }
      }

      // A direct hit always breaks the upright pose. A sufficiently strong
      // nearby blast does too; weaker splash uses mass-scaled knockback only.
      const knockback = 4.5 * Math.max(0, 1 - distance / 3.3);
      const ragdollDeltaV = 11 * Math.max(0, 1 - distance / blastRadius);
      if (isDirectTarget || ragdollDeltaV > 3.5) {
        if (!character.ragdoll) createRagdoll(character, point, isDirectTarget ? directHit.location : "chest");
        if (character.ragdoll.standing || character.ragdoll.gettingUp) {
          character.ragdoll.standing = false;
          character.ragdoll.gettingUp = false;
          character.ragdoll.elapsedTime = 0;
          character.ragdoll.settledTime = 0;
          character.ragdoll.joints.forEach(joint => joint.setMaxMotorTorque(0));
        }
        blastRagdoll(character.ragdoll, point, isDirectTarget ? 12 : 11, blastRadius,
          isDirectTarget ? directHit.location : null);
      } else if (character.ragdoll) {
        if (distance < blastRadius) {
          if (character.ragdoll.standing || character.ragdoll.gettingUp) {
            character.ragdoll.standing = false;
            character.ragdoll.gettingUp = false;
            character.ragdoll.elapsedTime = 0;
            character.ragdoll.settledTime = 0;
            character.ragdoll.joints.forEach(joint => joint.setMaxMotorTorque(0));
          }
          blastRagdoll(character.ragdoll, point, 11, blastRadius);
        }
      } else if (knockback > 0) {
        const length = Math.max(0.1, distance);
        const mass = character.body.getMass();
        character.body.applyLinearImpulse(
          V((dx / length * knockback) * mass, (dy / length * knockback + 0.55) * mass),
          character.body.getWorldCenter(),
          true
        );
      }
    }
    const damageSummary = damageEvents.map(event =>
      (event.character.team === 0 ? "Blue " : "Red ") + event.character.number +
      " -" + event.damage + (event.direct ? " direct " + event.location : " splash")
    ).join(" · ");
    const eliminated = damageEvents.filter(event => event.character.health <= 0)
      .map(event => (event.character.team === 0 ? "Blue " : "Red ") + event.character.number + " eliminated");
    statusEl.textContent = (damageSummary || "No combatants damaged") +
      (eliminated.length ? " · " + eliminated.join(", ") : "") +
      " · crater " + removedCells + " cells";
    updateHud();
  }

  function classifyHitLocation(character, fixture, point) {
    const fixtureLocation = fixture.getUserData()?.location;
    if (fixtureLocation) return fixtureLocation;
    const relativeHeight = point.y - character.body.getPosition().y;
    if (relativeHeight > 0.34) return "head";
    if (relativeHeight > -0.25) return "chest";
    return "legs";
  }

  function detectProjectileImpact() {
    if (!projectile || !projectilePrevious) return;
    const current = projectile.getPosition();
    let hit = false;

    world.rayCast(projectilePrevious, current, (fixture, point, normal, fraction) => {
      if (fixture.getUserData()?.kind === "projectile") return -1;
      const bodyKind = fixture.getBody().getUserData()?.kind;
      if (bodyKind === "terrain" || bodyKind === "character") {
        impactPoint = V(point.x, point.y);
        if (bodyKind === "character") {
          const target = characters.find(character => character.body === fixture.getBody() ||
            character.ragdoll?.pieces.some(piece => piece.body === fixture.getBody()));
          if (target) projectileHit = { character: target, location: classifyHitLocation(target, fixture, point) };
        }
        hit = true;
        return fraction;
      }
      return -1;
    });

    if (hit) {
      pendingImpact = true;
      return;
    }

    if (current.x < 0 || current.x > WORLD_WIDTH || current.y < -0.5) {
      impactPoint = V(
        Math.max(0, Math.min(WORLD_WIDTH, current.x)),
        Math.max(-0.5, current.y)
      );
      pendingImpact = true;
      return;
    }

    projectilePrevious = V(current.x, current.y);
  }

  function checkBoundaries() {
    for (const character of characters) {
      if (character.eliminated) continue;
      const p = character.body.getPosition();
      if (p.x < 0 || p.x > WORLD_WIDTH || p.y < 0) {
        character.eliminated = true;
        character.body.setActive(false);
        character.ragdoll?.pieces.forEach(piece => piece.body.setActive(false));
        statusEl.textContent = (character.team === 0 ? "Blue" : "Red") + " character crossed a lethal boundary";
      }
    }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvasWidth = Math.max(1, rect.width);
    canvasHeight = Math.max(1, rect.height);
    canvas.width = Math.round(canvasWidth * pixelRatio);
    canvas.height = Math.round(canvasHeight * pixelRatio);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  function worldToScreen(x, y, scale, offsetX) {
    return { x: offsetX + x * scale, y: canvasHeight - (y - cameraY) * scale };
  }

  function drawTerrain(scale, offsetX) {
    terrainSystem.draw(ctx, (x, y) => worldToScreen(x, y, scale, offsetX));
  }

  function drawCharacter(character, scale, offsetX) {
    if (character.eliminated && !character.ragdoll) return;
    const p = character.body.getPosition();
    const screen = worldToScreen(p.x, p.y, scale, offsetX);
    const unit = scale;
    if (character.ragdoll) {
      const ragdoll = character.ragdoll;
      const jointPoint = joint => {
        const a = joint.getAnchorA();
        const b = joint.getAnchorB();
        return V((a.x + b.x) * 0.5, (a.y + b.y) * 0.5);
      };
      const screenPoint = point => worldToScreen(point.x, point.y, scale, offsetX);
      const drawBone = (a, b) => {
        const start = screenPoint(a);
        const end = screenPoint(b);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      };
      const points = {};
      for (const [name, joint] of Object.entries(ragdoll.jointMap)) {
        points[name] = jointPoint(joint);
      }
      const leftHand = ragdoll.byName["left-lower-arm"].body.getWorldPoint(V(0, -0.17));
      const rightHand = ragdoll.byName["right-lower-arm"].body.getWorldPoint(V(0, -0.17));
      const leftFoot = ragdoll.byName["left-lower-leg"].body.getWorldPoint(V(0, -0.17));
      const rightFoot = ragdoll.byName["right-lower-leg"].body.getWorldPoint(V(0, -0.17));
      const head = ragdoll.byName.head.body.getPosition();
      const shoulderCenter = V((points.leftShoulder.x + points.rightShoulder.x) * 0.5,
        (points.leftShoulder.y + points.rightShoulder.y) * 0.5);
      const hipCenter = V((points.leftHip.x + points.rightHip.x) * 0.5,
        (points.leftHip.y + points.rightHip.y) * 0.5);

      ctx.save();
      // Match the original stickman: dark limbs and joints, team color
      // reserved for the head and health bar.
      ctx.strokeStyle = "#17232b";
      ctx.lineWidth = Math.max(2.6, unit * 0.072);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      // Render each bone between the live physics joint anchors. This keeps
      // the stick figure visually connected even within solver tolerance.
      drawBone(points.neck, head);
      drawBone(shoulderCenter, hipCenter);
      drawBone(points.leftShoulder, points.leftElbow);
      drawBone(points.leftElbow, leftHand);
      drawBone(points.rightShoulder, points.rightElbow);
      drawBone(points.rightElbow, rightHand);
      drawBone(points.leftHip, points.leftKnee);
      drawBone(points.leftKnee, leftFoot);
      drawBone(points.rightHip, points.rightKnee);
      drawBone(points.rightKnee, rightFoot);

      ctx.fillStyle = "#17232b";
      for (const point of Object.values(points)) {
        const screenPointValue = screenPoint(point);
        ctx.beginPath();
        ctx.arc(screenPointValue.x, screenPointValue.y, Math.max(2.2, unit * 0.045), 0, Math.PI * 2);
        ctx.fill();
      }
      const headScreen = screenPoint(head);
      ctx.beginPath();
      ctx.arc(headScreen.x, headScreen.y, Math.max(3.2, unit * 0.135), 0, Math.PI * 2);
      ctx.fillStyle = character.color;
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = "#17232b";
      ctx.stroke();
      ctx.restore();

      const barWidth = unit * 0.64;
      const barY = -unit * 0.96;
      ctx.fillStyle = "#17232b";
      ctx.fillRect(screen.x - barWidth / 2, screen.y + barY, barWidth, Math.max(3, unit * 0.055));
      ctx.fillStyle = character.team === 0 ? "#58a8ff" : "#ff7770";
      ctx.fillRect(screen.x - barWidth / 2, screen.y + barY, barWidth * (character.health / character.maxHealth), Math.max(3, unit * 0.055));
      return;
    }

    const velocity = character.body.getLinearVelocity();
    const moving = character.grounded && Math.abs(velocity.x) > 0.35;
    const jumping = !character.grounded;
    const phase = performance.now() * 0.012 * (velocity.x < 0 ? -1 : 1);
    const stride = moving ? Math.min(1, Math.abs(velocity.x) / 3.4) : 0;
    const legSwing = jumping ? 0.23 : Math.sin(phase) * 0.28 * stride;
    const armSwing = jumping ? -0.38 : -Math.sin(phase) * 0.22 * stride;
    const kneeBend = moving ? Math.max(0, Math.sin(phase + 0.9)) * 0.12 * stride : 0;
    const torsoLean = Math.max(-0.16, Math.min(0.16, velocity.x * 0.035));

    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(torsoLean);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#17232b";
    ctx.lineWidth = Math.max(2.6, unit * 0.072);
    ctx.fillStyle = character.color;
    ctx.beginPath();
    ctx.arc(0, -unit * 0.49, unit * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -unit * 0.34);
    ctx.lineTo(0, unit * 0.25);
    ctx.stroke();

    const shoulderY = -unit * 0.22;
    const leftElbowX = -unit * (0.24 + armSwing * 0.55);
    const rightElbowX = unit * (0.24 + armSwing * 0.55);
    const elbowY = jumping ? -unit * 0.48 : unit * 0.05;
    const leftHandX = -unit * (0.30 + armSwing);
    const rightHandX = unit * (0.30 + armSwing);
    const handY = jumping ? -unit * 0.68 : unit * (0.02 + armSwing * 0.6);
    ctx.beginPath();
    ctx.moveTo(0, shoulderY);
    ctx.lineTo(leftElbowX, elbowY);
    ctx.lineTo(leftHandX, handY);
    ctx.moveTo(0, shoulderY);
    ctx.lineTo(rightElbowX, elbowY);
    ctx.lineTo(rightHandX, handY);
    ctx.stroke();

    const hipY = unit * 0.25;
    const leftKneeX = -unit * (0.14 + legSwing * 0.62);
    const rightKneeX = unit * (0.14 - legSwing * 0.62);
    const leftFootX = -unit * (0.23 + legSwing);
    const rightFootX = unit * (0.23 - legSwing);
    const leftKneeY = jumping ? unit * 0.46 : unit * (0.50 + kneeBend);
    const rightKneeY = jumping ? unit * 0.43 : unit * (0.50 - kneeBend);
    const leftFootY = jumping ? unit * 0.69 : unit * (0.78 - Math.max(0, Math.sin(phase)) * 0.12 * stride);
    const rightFootY = jumping ? unit * 0.66 : unit * (0.78 + Math.max(0, Math.sin(phase)) * 0.12 * stride);
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(leftKneeX, leftKneeY);
    ctx.lineTo(leftFootX, leftFootY);
    ctx.moveTo(0, hipY);
    ctx.lineTo(rightKneeX, rightKneeY);
    ctx.lineTo(rightFootX, rightFootY);
    ctx.stroke();

    const barWidth = unit * 0.64;
    const barY = -unit * 0.96;
    ctx.fillStyle = "#17232b";
    ctx.fillRect(-barWidth / 2, barY, barWidth, Math.max(3, unit * 0.055));
    ctx.fillStyle = character.team === 0 ? "#58a8ff" : "#ff7770";
    ctx.fillRect(-barWidth / 2, barY, barWidth * (character.health / character.maxHealth), Math.max(3, unit * 0.055));
    ctx.restore();
  }

  function drawAim(scale, offsetX) {
    const character = activeCharacter();
    if (!character || character.eliminated || projectile || activeAction === "attack") return;

    const p = character.body.getPosition();
    const angle = Number(angleInput.value) * Math.PI / 180;
    const power = Number(powerInput.value) / 100;
    const start = worldToScreen(p.x, p.y + 0.04, scale, offsetX);
    const length = scale * (0.42 + power * 1.05);
    const endX = start.x + Math.cos(angle) * length;
    const endY = start.y - Math.sin(angle) * length;
    const headLength = Math.max(7, scale * 0.16);
    const headAngle = Math.atan2(endY - start.y, endX - start.x);

    ctx.save();
    ctx.strokeStyle = "#fff0bd";
    ctx.fillStyle = "#fff0bd";
    ctx.lineWidth = Math.max(2.5, scale * 0.055);
    ctx.lineCap = "round";
    ctx.shadowColor = "#17232b88";
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX - Math.cos(headAngle - 0.48) * headLength,
      endY - Math.sin(headAngle - 0.48) * headLength
    );
    ctx.lineTo(
      endX - Math.cos(headAngle + 0.48) * headLength,
      endY - Math.sin(headAngle + 0.48) * headLength
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawDamagePopups(scale, offsetX) {
    const now = performance.now();
    damagePopups = damagePopups.filter(popup => popup.expires > now);
    for (const popup of damagePopups) {
      const progress = 1 - (popup.expires - now) / 1100;
      const screen = worldToScreen(popup.x, popup.y + progress * 0.42, scale, offsetX);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - progress);
      ctx.textAlign = "center";
      ctx.font = "800 15px system-ui";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#17232b";
      ctx.fillStyle = popup.direct ? "#ffe08a" : "#ffffff";
      const label = "-" + popup.damage;
      ctx.strokeText(label, screen.x, screen.y);
      ctx.fillText(label, screen.x, screen.y);
      ctx.restore();
    }
  }

  function drawProjectile(scale, offsetX) {
    if (!projectile) return;
    const p = projectile.getPosition();
    const screen = worldToScreen(p.x, p.y, scale, offsetX);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, Math.max(3, scale * 0.105), 0, Math.PI * 2);
    ctx.fillStyle = "#202a31";
    ctx.fill();
    ctx.strokeStyle = "#fff2c8";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function render() {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    const scale = Math.min(canvasWidth / WORLD_WIDTH, canvasHeight / WORLD_HEIGHT);
    const offsetX = (canvasWidth - WORLD_WIDTH * scale) / 2;
    const livingHighest = characters.filter(c => !c.eliminated).reduce((max, c) => Math.max(max, c.body.getPosition().y), 0);
    const ragdollHighest = characters.filter(c => c.ragdoll).reduce((max, c) =>
      Math.max(max, ...c.ragdoll.pieces.map(piece => piece.body.getPosition().y)), 0);
    const highest = Math.max(0, livingHighest, ragdollHighest, projectile ? projectile.getPosition().y : 0);
    cameraY = Math.max(0, highest - 10.4);
    const sky = ctx.createLinearGradient(0, 0, 0, canvasHeight);
    sky.addColorStop(0, "#9fc7d6");
    sky.addColorStop(1, "#d8e5d9");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    ctx.fillStyle = "#ffffff55";
    ctx.beginPath();
    ctx.arc(canvasWidth * 0.78, canvasHeight * 0.18, Math.min(34, canvasWidth * 0.035), 0, Math.PI * 2);
    ctx.fill();

    drawTerrain(scale, offsetX);
    drawAim(scale, offsetX);
    characters.forEach(character => drawCharacter(character, scale, offsetX));
    drawProjectile(scale, offsetX);
    drawDamagePopups(scale, offsetX);

    if (characters.some(c => c.eliminated)) {
      ctx.fillStyle = "#101820b9";
      ctx.fillRect(0, canvasHeight - 34, canvasWidth, 34);
      ctx.fillStyle = "#fff";
      ctx.font = "12px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("Boundary elimination registered · reset to continue testing", canvasWidth / 2, canvasHeight - 13);
    }
  }

  function frame(timestamp) {
    if (!lastFrame) lastFrame = timestamp;
    const elapsed = Math.min((timestamp - lastFrame) / 1000, 0.05);
    lastFrame = timestamp;
    accumulator += elapsed;
    while (accumulator >= FIXED_STEP) {
      moveActive();
      // Two smaller substeps improve revolute-joint anchor stability.
      world.step(FIXED_STEP / 2, 10, 6);
      world.step(FIXED_STEP / 2, 10, 6);
      detectProjectileImpact();
      if (pendingImpact) {
        pendingImpact = false;
        explode();
      }
      checkBoundaries();
      for (const character of characters) {
        if (!character.eliminated && (!character.ragdoll || character.ragdoll.standing)) character.grounded = isGrounded(character);
      }
      recoverRagdolls();
      for (const character of characters) {
        if (!character.eliminated && character.ragdoll?.standing) driveStandingRagdoll(character.ragdoll);
      }
      accumulator -= FIXED_STEP;
    }
    render();
    requestAnimationFrame(frame);
  }

  function updateAimModeLabel() {
    aimModeButton.textContent = aimMode === "pullback" ? "Aim: Pullback" : "Aim: Precision";
    document.body.classList.toggle("aim-precision", aimMode === "precision");
  }

  function updatePullbackAim(event) {
    if (!pullbackPointer) return;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(canvasWidth / WORLD_WIDTH, canvasHeight / WORLD_HEIGHT);
    const offsetX = (canvasWidth - WORLD_WIDTH * scale) / 2;
    if (!pullbackOrigin) return;
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const dx = pullbackOrigin.x - pointerX;
    const dy = pointerY - pullbackOrigin.y;
    const pullDistance = Math.hypot(dx, dy);
    pullbackDistance = pullDistance;
    if (pullDistance < 18) return;
    let degrees = Math.atan2(dy, dx) * 180 / Math.PI;
    degrees = (degrees + 360) % 360;
    angleInput.value = String(Math.round(degrees));
    powerInput.value = String(Math.max(10, Math.min(100, Math.round(pullDistance / 1.65))));
    setAimLabels();
    saveActiveAim();
  }

  function saveActiveAim() {
    const character = activeCharacter();
    if (!character) return;
    character.aimAngle = Number(angleInput.value);
    character.aimPower = Number(powerInput.value);
  }

  function restoreActiveAim() {
    const character = activeCharacter();
    if (!character) return;
    angleInput.value = String(character.aimAngle);
    powerInput.value = String(character.aimPower);
    setAimLabels();
  }

  function changeTurn() {
    if (projectile) return;
    saveActiveAim();
    held = { left: false, right: false, jump: false };
    jumpBufferTime = 0;
    coyoteTime = 0;
    tapMoveDirection = 0;
    tapMoveRemaining = 0;
    jumpQueued = false;
    activeAction = null;
    for (let offset = 1; offset <= characters.length; offset++) {
      const nextIndex = (activeIndex + offset) % characters.length;
      if (!characters[nextIndex].eliminated) {
        activeIndex = nextIndex;
        break;
      }
    }
    restoreActiveAim();
    updateHud();
  }

  function bindHoldButton(id, key) {
    const button = document.getElementById(id);
    let pressedAt = 0;
    const start = event => {
      event.preventDefault();
      pressedAt = Date.now();
      held[key] = true;
      if (key === "jump") jumpQueued = true;
      button.setPointerCapture?.(event.pointerId);
    };
    const stop = event => {
      event.preventDefault();
      held[key] = false;
      if ((key === "left" || key === "right") && Date.now() - pressedAt < 180) {
        tapMoveDirection = key === "right" ? 1 : -1;
        tapMoveRemaining = 0.28;
      }
    };
    button.addEventListener("selectstart", event => event.preventDefault());
    button.addEventListener("contextmenu", event => event.preventDefault());
    button.addEventListener("dragstart", event => event.preventDefault());
    button.addEventListener("pointerdown", start);
    button.addEventListener("pointerup", stop);
    button.addEventListener("pointercancel", stop);
    button.addEventListener("lostpointercapture", stop);
  }

  document.getElementById("new-map").addEventListener("click", () => {
    seed = randomSeed();
    createWorld();
  });
  fireButton.addEventListener("click", fire);
  endTurnButton.addEventListener("click", changeTurn);
  aimModeButton.addEventListener("click", () => {
    aimMode = aimMode === "pullback" ? "precision" : "pullback";
    updateAimModeLabel();
    statusEl.textContent = aimMode === "pullback"
      ? "Pullback aiming — drag away from your combatant and release to fire"
      : "Precision aiming — adjust angle and power, then fire";
  });
  canvas.addEventListener("pointerdown", event => {
    if (aimMode !== "pullback" || projectile || activeAction === "move" || activeAction === "attack") return;
    const character = activeCharacter();
    if (!character || character.eliminated || (character.ragdoll && !character.ragdoll.standing)) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    pullbackOrigin = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    pullbackPointer = event.pointerId;
    pullbackDistance = 0;
    canvas.setPointerCapture(event.pointerId);
    updatePullbackAim(event);
  });
  canvas.addEventListener("pointermove", event => {
    if (pullbackPointer !== event.pointerId) return;
    event.preventDefault();
    updatePullbackAim(event);
  });
  const finishPullback = event => {
    if (pullbackPointer !== event.pointerId) return;
    event.preventDefault();
    updatePullbackAim(event);
    const shouldFire = pullbackDistance >= 18;
    pullbackPointer = null;
    pullbackOrigin = null;
    if (shouldFire) fire();
  };
  canvas.addEventListener("pointerup", finishPullback);
  canvas.addEventListener("pointercancel", event => {
    if (pullbackPointer === event.pointerId) {
      pullbackPointer = null;
      pullbackOrigin = null;
      pullbackDistance = 0;
    }
  });
  angleInput.addEventListener("input", () => {
    setAimLabels();
    saveActiveAim();
  });
  powerInput.addEventListener("input", () => {
    setAimLabels();
    saveActiveAim();
  });
  bindHoldButton("move-left", "left");
  bindHoldButton("move-right", "right");
  bindHoldButton("jump", "jump");

  window.addEventListener("keydown", event => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", " "].includes(event.key)) event.preventDefault();
    if (event.key.toLowerCase() === "a" || event.key === "ArrowLeft") held.left = true;
    if (event.key.toLowerCase() === "d" || event.key === "ArrowRight") held.right = true;
    if (event.key.toLowerCase() === "w" || event.key === "ArrowUp" || event.key === " ") jumpQueued = true;
    if (event.key === "Enter") fire();
  });
  window.addEventListener("keyup", event => {
    if (event.key.toLowerCase() === "a" || event.key === "ArrowLeft") held.left = false;
    if (event.key.toLowerCase() === "d" || event.key === "ArrowRight") held.right = false;
  });
  document.addEventListener("selectstart", event => {
    if (event.target.closest?.(".touch-control")) event.preventDefault();
  });
  document.addEventListener("contextmenu", event => {
    if (event.target.closest?.(".touch-control")) event.preventDefault();
  });
  window.addEventListener("resize", resize);

  resize();
  setAimLabels();
  updateAimModeLabel();
  seed = randomSeed();
  createWorld();
  requestAnimationFrame(frame);
})();
