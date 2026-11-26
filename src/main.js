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
    const maxSlope = 35 * Math.PI / 180;
    let attempts = 0;
    while (positions.length < count && attempts++ < 1600) {
      const candidate = minX + random() * (maxX - minX);
      const slope = Math.atan2(heightAt(candidate + 0.18) - heightAt(candidate - 0.18), 0.36);
      if (Math.abs(slope) > maxSlope) continue;
      if (positions.every(x => Math.abs(x - candidate) >= 1.35)) positions.push(candidate);
    }
    if (positions.length < count) {
      const candidates = [];
      for (let i = 0; i < 240; i++) {
        const x = minX + (i + 0.5) / 240 * (maxX - minX);
        const slope = Math.atan2(heightAt(x + 0.18) - heightAt(x - 0.18), 0.36);
        if (Math.abs(slope) <= maxSlope) candidates.push({ x, slope: Math.abs(slope) });
      }
      candidates.sort((a, b) => a.slope - b.slope);
      for (const candidate of shuffle(candidates, random)) {
        if (positions.length >= count) break;
        if (positions.every(x => Math.abs(x - candidate.x) >= 1.35)) positions.push(candidate.x);
      }
    }
    return shuffle(positions, random);
  }

  function makeCharacter(team, number, x) {
    const leftX = x - 0.18;
    const rightX = x + 0.18;
    const leftY = heightAt(leftX) + 0.06;
    const rightY = heightAt(rightX) + 0.06;
    const leftAngle = Math.atan2(heightAt(leftX + 0.025) - heightAt(leftX - 0.025), 0.05);
    const rightAngle = Math.atan2(heightAt(rightX + 0.025) - heightAt(rightX - 0.025), 0.05);
    const pelvisY = Math.min(leftY, rightY) + 0.95 * (0.41 + 0.34);
    const origin = { x, y: pelvisY + 0.25 };
    const footTargets = [
      { x: leftX, y: leftY, angle: leftAngle },
      { x: rightX, y: rightY, angle: rightAngle }
    ];
    const rig = window.CharacterRig.buildRig(P, world, team, number, origin, { footTargets });
    return {
      body: rig.torso, rig, team, number, color: COLORS[team],
      grounded: true, eliminated: false,
      health: 100, maxHealth: 100,
      aimAngle: team === 0 ? 0 : 180, aimPower: 100
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
    // Let the articulated rigs settle before the first visible frame.
    for (let i = 0; i < 75; i++) world.step(FIXED_STEP, 10, 6);
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

  function probeTerrain(x, startY, endY) {
    let hit = null;
    world.rayCast(V(x, startY), V(x, endY), (fixture, point, normal, fraction) => {
      if (fixture.getBody().getUserData()?.kind !== "terrain") return -1;
      hit = {
        point: { x: point.x, y: point.y },
        normal: { x: normal.x, y: normal.y },
        fraction
      };
      return fraction;
    });
    return hit;
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
    if (!character || character.eliminated || (character.rig.mode !== "active") || projectile || activeAction === "attack") return;
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
    const grounded = character.rig.getFootContacts().some(Boolean);
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
    if (!character || character.eliminated || (character.rig.mode !== "active") || projectile || activeAction === "move" || activeAction === "attack") return;
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

  function blastRig(rig, origin, strength, radius, hitLocation = null) {
    const hitPartName = hitLocation === "head" ? "head" :
      hitLocation === "legs" ? "left-upper-leg" : "torso";
    const hitBody = hitLocation ? rig.byName[hitPartName]?.body : null;
    for (const { body } of rig.pieces) {
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
      body.applyLinearImpulse(impulse, body === hitBody ? origin : center, true);
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
        damage = { head: 40, chest: 30, legs: 20 }[directHit.location];
      } else if (distance < blastRadius) {
        damage = Math.round(18 * (1 - distance / blastRadius));
      }

      if (damage > 0) {
        character.health = Math.max(0, character.health - damage);
        damageEvents.push({ character, damage, direct: isDirectTarget,
          location: isDirectTarget ? directHit.location : "splash" });
        damagePopups.push({
          x: p.x, y: p.y + 0.9, damage, direct: isDirectTarget,
          expires: performance.now() + 1100
        });
      }

      const knockback = 4.5 * Math.max(0, 1 - distance / 3.3);
      const length = Math.max(0.1, distance);
      if (isDirectTarget || knockback > 0.15) {
        const dv = V(dx / length * knockback, dy / length * knockback + 0.55);
        character.rig.hit(dv);
        if (isDirectTarget || distance < blastRadius) {
          blastRig(character.rig, point, isDirectTarget ? 12 : 11, blastRadius,
            isDirectTarget ? directHit.location : null);
        }
      }

      if (character.health <= 0) {
        character.eliminated = true;
        character.rig.pieces.forEach(piece => piece.body.setActive(false));
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
          const target = characters.find(character =>
            character.rig.pieces.some(piece => piece.body === fixture.getBody()));
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
        character.rig.pieces.forEach(piece => piece.body.setActive(false));
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
    const rig = character.rig;
    const torsoPosition = rig.torso.getPosition();
    const screen = worldToScreen(torsoPosition.x, torsoPosition.y, scale, offsetX);
    const screenPoint = point => worldToScreen(point.x, point.y, scale, offsetX);
    const jointPoint = joint => {
      const a = joint.getAnchorA();
      const b = joint.getAnchorB();
      return V((a.x + b.x) * 0.5, (a.y + b.y) * 0.5);
    };
    const points = {};
    for (const [name, joint] of Object.entries(rig.jointMap)) points[name] = jointPoint(joint);
    const leftHand = rig.byName["left-lower-arm"].body.getWorldPoint(V(0, -0.17));
    const rightHand = rig.byName["right-lower-arm"].body.getWorldPoint(V(0, -0.17));
    const leftAnkle = jointPoint(rig.jointMap.leftAnkle);
    const rightAnkle = jointPoint(rig.jointMap.rightAnkle);
    const leftToe = rig.byName["left-foot"].body.getWorldPoint(V(0.08, 0));
    const rightToe = rig.byName["right-foot"].body.getWorldPoint(V(0.08, 0));
    const head = rig.byName.head.body.getPosition();
    const shoulderCenter = V((points.leftShoulder.x + points.rightShoulder.x) * 0.5,
      (points.leftShoulder.y + points.rightShoulder.y) * 0.5);
    const hipCenter = V((points.leftHip.x + points.rightHip.x) * 0.5,
      (points.leftHip.y + points.rightHip.y) * 0.5);

    ctx.save();
    ctx.strokeStyle = "#17232b";
    ctx.lineWidth = Math.max(2.6, scale * 0.072);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const drawBone = (a, b) => {
      const start = screenPoint(a);
      const end = screenPoint(b);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    };
    drawBone(points.neck, head);
    drawBone(shoulderCenter, hipCenter);
    drawBone(points.leftShoulder, points.leftElbow);
    drawBone(points.leftElbow, leftHand);
    drawBone(points.rightShoulder, points.rightElbow);
    drawBone(points.rightElbow, rightHand);
    drawBone(points.leftHip, points.leftKnee);
    drawBone(points.leftKnee, leftAnkle);
    drawBone(leftAnkle, leftToe);
    drawBone(points.rightHip, points.rightKnee);
    drawBone(points.rightKnee, rightAnkle);
    drawBone(rightAnkle, rightToe);

    ctx.fillStyle = "#17232b";
    for (const point of Object.values(points)) {
      const p = screenPoint(point);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(2.2, scale * 0.045), 0, Math.PI * 2);
      ctx.fill();
    }
    const headScreen = screenPoint(head);
    ctx.beginPath();
    ctx.arc(headScreen.x, headScreen.y, Math.max(3.2, scale * 0.135), 0, Math.PI * 2);
    ctx.fillStyle = character.color;
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = "#17232b";
    ctx.stroke();

    const barWidth = scale * 0.64;
    const barY = -scale * 0.96;
    ctx.fillStyle = "#17232b";
    ctx.fillRect(screen.x - barWidth / 2, screen.y + barY, barWidth, Math.max(3, scale * 0.055));
    ctx.fillStyle = character.team === 0 ? "#58a8ff" : "#ff7770";
    ctx.fillRect(screen.x - barWidth / 2, screen.y + barY,
      barWidth * (character.health / character.maxHealth), Math.max(3, scale * 0.055));
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
    const rigHighest = characters.reduce((max, c) =>
      Math.max(max, ...c.rig.pieces.map(piece => piece.body.getPosition().y)), 0);
    const highest = Math.max(0, livingHighest, rigHighest, projectile ? projectile.getPosition().y : 0);
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
      for (const character of characters) {
        if (!character.eliminated) character.rig.driveStance(FIXED_STEP, probeTerrain);
      }
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
        if (!character.eliminated) {
          character.rig.updateFallState(FIXED_STEP);
          character.grounded = character.rig.getFootContacts().some(Boolean);
        }
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
    if (!character || character.eliminated || (character.rig.mode !== "active")) return;
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
