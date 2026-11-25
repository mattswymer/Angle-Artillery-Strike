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
  let terrainHeights = [];
  let characters = [];
  let activeIndex = 0;
  let projectile = null;
  let pendingImpact = false;
  let seed = 1;
  let held = { left: false, right: false, jump: false };
  let activeAction = null;
  let jumpQueued = false;
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
      const ridge = Math.sin(x * Math.PI * 5.3 + 1.7) * 0.34;
      terrainHeights.push(Math.max(2.2, Math.min(5.2, 3.55 + broad + ridge + noise)));
    }
  }

  function rebuildTerrain() {
    if (terrainBody) world.destroyBody(terrainBody);
    terrainBody = world.createBody({ type: "static", userData: { kind: "terrain" } });
    const vertices = terrainHeights.map((height, index) => V(index / (TERRAIN_SAMPLES - 1) * WORLD_WIDTH, height));
    terrainBody.createFixture({ shape: new P.Chain(vertices), friction: 0.95 });
    terrainBody.getFixtureList().setUserData({ kind: "terrain" });
  }

  function makeCharacter(team, number, x) {
    const y = heightAt(x) + 0.48;
    const body = world.createBody({
      type: "dynamic",
      position: V(x, y),
      fixedRotation: true,
      linearDamping: 0.7,
      allowSleep: false,
      userData: { kind: "character", team, number }
    });
    const fixture = body.createFixture({ shape: new P.Circle(0.36), density: 1.25, friction: 0.82, restitution: 0.02 });
    fixture.setUserData({ kind: "character" });
    return { body, team, number, color: COLORS[team], grounded: false, eliminated: false };
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
    rebuildTerrain();

    const blueX = 2.5 + random() * 6.5;
    const redX = 15 + random() * 6.5;
    characters = [makeCharacter(0, 1, blueX), makeCharacter(1, 1, redX)];
    activeIndex = 0;
    activeAction = null;
    projectile = null;
    pendingImpact = false;
    cameraY = 0;
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
    const direction = active?.team === 0 ? "right" : "left";
    fireButton.textContent = "Fire " + (direction === "right" ? "→" : "←");
    fireButton.disabled = activeAction === "move" || activeAction === "attack" || Boolean(projectile);
  }

  function setAimLabels() {
    angleValue.value = angleInput.value + "°";
    powerValue.value = powerInput.value;
  }

  function isGrounded(character) {
    const p = character.body.getPosition();
    let found = false;
    world.rayCast(V(p.x, p.y - 0.39), V(p.x, p.y - 0.57), (fixture, point, normal, fraction) => {
      if (fixture.getBody() === character.body) return -1;
      if (fixture.getBody().getUserData()?.kind === "terrain") {
        found = true;
        return fraction;
      }
      return -1;
    });
    return found;
  }

  function moveActive() {
    const character = activeCharacter();
    if (!character || character.eliminated || projectile || activeAction === "attack") return;
    const velocity = character.body.getLinearVelocity();
    const direction = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    if ((direction || held.jump || jumpQueued) && activeAction !== "move") {
      activeAction = "move";
      updateHud();
    }
    if (direction) character.body.setLinearVelocity(V(direction * 3.0, velocity.y));
    else character.body.setLinearVelocity(V(velocity.x * 0.78, velocity.y));
    if ((held.jump || jumpQueued) && isGrounded(character)) {
      character.body.applyLinearImpulse(V(0, 4.7), character.body.getWorldCenter(), true);
      jumpQueued = false;
      held.jump = false;
    }
  }

  function fire() {
    const character = activeCharacter();
    if (!character || character.eliminated || projectile || activeAction === "move" || activeAction === "attack") return;
    activeAction = "attack";
    updateHud();
    const angle = Number(angleInput.value) * Math.PI / 180;
    const power = Number(powerInput.value) / 100;
    const direction = character.team === 0 ? 1 : -1;
    const dx = Math.cos(angle) * direction;
    const dy = Math.sin(angle);
    const p = character.body.getPosition();
    const start = V(p.x + dx * 0.62, p.y + dy * 0.48 + 0.1);
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
    pendingImpact = false;
    fireButton.disabled = true;
  }

  function explode() {
    if (!projectile) return;
    const point = projectile.getPosition();
    world.destroyBody(projectile);
    projectile = null;
    const radius = 1.7;
    const radiusSquared = radius * radius;

    for (let i = 0; i < terrainHeights.length; i++) {
      const x = i / (TERRAIN_SAMPLES - 1) * WORLD_WIDTH;
      const dx = x - point.x;
      if (Math.abs(dx) > radius) continue;
      const depth = Math.sqrt(Math.max(0, radiusSquared - dx * dx));
      const craterFloor = point.y - depth * 1.28;
      terrainHeights[i] = Math.min(terrainHeights[i], craterFloor);
    }
    rebuildTerrain();

    for (const character of characters) {
      if (character.eliminated) continue;
      const p = character.body.getPosition();
      const dx = p.x - point.x;
      const dy = p.y - point.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 3.3) {
        const strength = 8.5 * (1 - distance / 3.3);
        const length = Math.max(0.01, distance);
        character.body.applyLinearImpulse(V(dx / length * strength, dy / length * strength + 1.2), character.body.getWorldCenter(), true);
      }
    }
    statusEl.textContent = "Explosion · crater radius " + radius.toFixed(2);
    updateHud();
  }

  function checkBoundaries() {
    for (const character of characters) {
      if (character.eliminated) continue;
      const p = character.body.getPosition();
      if (p.x < 0 || p.x > WORLD_WIDTH || p.y < 0) {
        character.eliminated = true;
        character.body.setActive(false);
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
    ctx.beginPath();
    const first = worldToScreen(0, terrainHeights[0], scale, offsetX);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < terrainHeights.length; i++) {
      const point = worldToScreen(i / (TERRAIN_SAMPLES - 1) * WORLD_WIDTH, terrainHeights[i], scale, offsetX);
      ctx.lineTo(point.x, point.y);
    }
    const bottomRight = worldToScreen(WORLD_WIDTH, 0, scale, offsetX);
    const bottomLeft = worldToScreen(0, 0, scale, offsetX);
    ctx.lineTo(bottomRight.x, bottomRight.y);
    ctx.lineTo(bottomLeft.x, bottomLeft.y);
    ctx.closePath();
    const gradient = ctx.createLinearGradient(0, canvasHeight * 0.42, 0, canvasHeight);
    gradient.addColorStop(0, "#6e986a");
    gradient.addColorStop(1, "#344e3d");
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = "#31533e";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  function drawCharacter(character, scale, offsetX) {
    if (character.eliminated) return;
    const p = character.body.getPosition();
    const screen = worldToScreen(p.x, p.y, scale, offsetX);
    const velocity = character.body.getLinearVelocity();
    const tilt = Math.max(-0.55, Math.min(0.55, velocity.x * 0.08));
    const unit = scale;
    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(tilt);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#17232b";
    ctx.lineWidth = Math.max(2.4, unit * 0.075);
    ctx.fillStyle = character.color;
    ctx.beginPath();
    ctx.arc(0, -unit * 0.22, unit * 0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -unit * 0.36);
    ctx.lineTo(0, unit * 0.12);
    ctx.moveTo(0, -unit * 0.22);
    ctx.lineTo(-unit * 0.2, -unit * 0.02);
    ctx.moveTo(0, -unit * 0.22);
    ctx.lineTo(unit * 0.2, -unit * 0.02);
    ctx.moveTo(0, unit * 0.12);
    ctx.lineTo(-unit * 0.17, unit * 0.36);
    ctx.moveTo(0, unit * 0.12);
    ctx.lineTo(unit * 0.17, unit * 0.36);
    ctx.stroke();
    ctx.restore();
  }

  function drawAim(scale, offsetX) {
    const character = activeCharacter();
    if (!character || character.eliminated || projectile || activeAction === "attack") return;

    const p = character.body.getPosition();
    const direction = character.team === 0 ? 1 : -1;
    const angle = Number(angleInput.value) * Math.PI / 180;
    const power = Number(powerInput.value) / 100;
    const start = worldToScreen(p.x, p.y + 0.04, scale, offsetX);
    const length = scale * (0.42 + power * 1.05);
    const endX = start.x + Math.cos(angle) * direction * length;
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
    const highest = Math.max(0, ...characters.filter(c => !c.eliminated).map(c => c.body.getPosition().y), projectile ? projectile.getPosition().y : 0);
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
      world.step(FIXED_STEP, 8, 3);
      if (pendingImpact) {
        pendingImpact = false;
        explode();
      }
      checkBoundaries();
      accumulator -= FIXED_STEP;
    }
    render();
    requestAnimationFrame(frame);
  }

  function changeTurn() {
    if (projectile) return;
    held = { left: false, right: false, jump: false };
    jumpQueued = false;
    activeAction = null;
    activeIndex = (activeIndex + 1) % characters.length;
    updateHud();
  }

  function bindHoldButton(id, key) {
    const button = document.getElementById(id);
    const start = event => {
      event.preventDefault();
      held[key] = true;
      if (key === "jump") jumpQueued = true;
      button.setPointerCapture?.(event.pointerId);
    };
    const stop = event => {
      event.preventDefault();
      held[key] = false;
    };
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
  angleInput.addEventListener("input", setAimLabels);
  powerInput.addEventListener("input", setAimLabels);
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
  window.addEventListener("resize", resize);

  resize();
  setAimLabels();
  seed = randomSeed();
  createWorld();
  requestAnimationFrame(frame);
})();
