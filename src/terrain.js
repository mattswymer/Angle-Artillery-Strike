(() => {
  "use strict";

  const key = (x, y) => x + "," + y;

  class TerrainSystem {
    constructor(Planck, world, width, height, cellSize, originY, surfaceHeights) {
      this.Planck = Planck;
      this.world = world;
      this.width = width;
      this.height = height;
      this.cellSize = cellSize;
      this.originY = originY;
      this.columns = Math.ceil(width / cellSize);
      this.rows = Math.ceil(height / cellSize);
      this.surfaceHeights = surfaceHeights.slice();
      this.mask = new Uint8Array(this.columns * this.rows);
      this.body = null;
      this.loops = [];
      this.createInitialTerrain();
    }

    surfaceAt(x) {
      const position = Math.max(0, Math.min(this.surfaceHeights.length - 1,
        x / this.width * (this.surfaceHeights.length - 1)));
      const left = Math.floor(position);
      const right = Math.min(this.surfaceHeights.length - 1, left + 1);
      const blend = position - left;
      return this.surfaceHeights[left] * (1 - blend) + this.surfaceHeights[right] * blend;
    }

    index(x, y) {
      return y * this.columns + x;
    }

    isSolid(x, y) {
      if (x < 0 || x >= this.columns || y < 0 || y >= this.rows) return false;
      return this.mask[this.index(x, y)] === 1;
    }

    createInitialTerrain() {
      for (let y = 0; y < this.rows; y++) {
        const worldY = this.originY + (y + 0.5) * this.cellSize;
        for (let x = 0; x < this.columns; x++) {
          const worldX = (x + 0.5) * this.cellSize;
          if (worldY <= this.surfaceAt(worldX)) this.mask[this.index(x, y)] = 1;
        }
      }
    }

    addEdge(outgoing, edges, sx, sy, ex, ey, direction) {
      const edge = { sx, sy, ex, ey, direction, used: false };
      edges.push(edge);
      const startKey = key(sx, sy);
      if (!outgoing.has(startKey)) outgoing.set(startKey, []);
      outgoing.get(startKey).push(edge);
    }

    nextEdge(candidates, direction) {
      const priority = [1, 0, 3, 2];
      let best = null;
      let bestRank = Infinity;
      for (const edge of candidates) {
        if (edge.used) continue;
        const turn = (edge.direction - direction + 4) % 4;
        const rank = priority.indexOf(turn);
        if (rank < bestRank) {
          best = edge;
          bestRank = rank;
        }
      }
      return best;
    }

    simplifyLoop(points) {
      if (points.length < 4) return points;
      const result = [];
      for (let i = 0; i < points.length; i++) {
        const previous = points[(i + points.length - 1) % points.length];
        const current = points[i];
        const next = points[(i + 1) % points.length];
        const incomingX = current[0] - previous[0];
        const incomingY = current[1] - previous[1];
        const outgoingX = next[0] - current[0];
        const outgoingY = next[1] - current[1];
        if (incomingX !== outgoingX || incomingY !== outgoingY) result.push(current);
      }
      return result;
    }

    buildContours() {
      const outgoing = new Map();
      const edges = [];

      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.columns; x++) {
          if (!this.isSolid(x, y)) continue;
          if (!this.isSolid(x, y - 1)) this.addEdge(outgoing, edges, x, y, x + 1, y, 0);
          if (!this.isSolid(x + 1, y)) this.addEdge(outgoing, edges, x + 1, y, x + 1, y + 1, 1);
          if (!this.isSolid(x, y + 1)) this.addEdge(outgoing, edges, x + 1, y + 1, x, y + 1, 2);
          if (!this.isSolid(x - 1, y)) this.addEdge(outgoing, edges, x, y + 1, x, y, 3);
        }
      }

      const loops = [];
      for (const first of edges) {
        if (first.used) continue;
        const points = [];
        let edge = first;
        let closed = false;
        let guard = 0;
        while (edge && !edge.used && guard++ <= edges.length + 1) {
          edge.used = true;
          points.push([edge.sx, edge.sy]);
          if (edge.ex === first.sx && edge.ey === first.sy) {
            closed = true;
            break;
          }
          edge = this.nextEdge(outgoing.get(key(edge.ex, edge.ey)) || [], edge.direction);
        }
        if (closed && points.length >= 3) {
          const simplified = this.simplifyLoop(points);
          if (simplified.length >= 3) loops.push(simplified);
        }
      }
      return loops;
    }

    isWorldExitEdge(a, b) {
      const onLeft = a[0] === 0 && b[0] === 0;
      const onRight = a[0] === this.columns && b[0] === this.columns;
      const onBottom = a[1] === 0 && b[1] === 0;
      return onLeft || onRight || onBottom;
    }

    toWorld(point) {
      const P = this.Planck;
      return P.Vec2(point[0] * this.cellSize, this.originY + point[1] * this.cellSize);
    }

    rebuildPhysics() {
      if (this.body) this.world.destroyBody(this.body);
      this.body = this.world.createBody({ type: "static", userData: { kind: "terrain" } });
      this.loops = this.buildContours();

      for (const loop of this.loops) {
        const hasOpenBoundary = loop.some((point, index) =>
          this.isWorldExitEdge(point, loop[(index + 1) % loop.length]));

        if (!hasOpenBoundary) {
          if (loop.length >= 3) {
            this.body.createFixture({
              shape: new this.Planck.Chain(loop.map(point => this.toWorld(point)), true),
              friction: 0.95
            });
          }
          continue;
        }

        let segment = [];
        const flush = () => {
          if (segment.length >= 2) {
            this.body.createFixture({
              shape: new this.Planck.Chain(segment.map(point => this.toWorld(point))),
              friction: 0.95
            });
          }
          segment = [];
        };

        for (let i = 0; i < loop.length; i++) {
          const start = loop[i];
          const end = loop[(i + 1) % loop.length];
          if (this.isWorldExitEdge(start, end)) {
            flush();
          } else {
            if (!segment.length) segment.push(start);
            segment.push(end);
          }
        }
        flush();
      }
    }

    carveCircle(centerX, centerY, radius) {
      const minX = Math.max(0, Math.floor((centerX - radius) / this.cellSize));
      const maxX = Math.min(this.columns - 1, Math.ceil((centerX + radius) / this.cellSize));
      const minY = Math.max(0, Math.floor((centerY - radius - this.originY) / this.cellSize));
      const maxY = Math.min(this.rows - 1, Math.ceil((centerY + radius - this.originY) / this.cellSize));
      const radiusSquared = radius * radius;
      let removed = 0;

      for (let y = minY; y <= maxY; y++) {
        const worldY = this.originY + (y + 0.5) * this.cellSize;
        for (let x = minX; x <= maxX; x++) {
          const index = this.index(x, y);
          if (!this.mask[index]) continue;
          const worldX = (x + 0.5) * this.cellSize;
          const dx = worldX - centerX;
          const dy = worldY - centerY;
          if (dx * dx + dy * dy <= radiusSquared) {
            this.mask[index] = 0;
            removed++;
          }
        }
      }
      return removed;
    }

    draw(context, worldToScreen) {
      if (!this.loops.length) return;
      context.beginPath();
      for (const loop of this.loops) {
        const first = worldToScreen(loop[0][0] * this.cellSize,
          this.originY + loop[0][1] * this.cellSize);
        context.moveTo(first.x, first.y);
        for (let i = 1; i < loop.length; i++) {
          const point = worldToScreen(loop[i][0] * this.cellSize,
            this.originY + loop[i][1] * this.cellSize);
          context.lineTo(point.x, point.y);
        }
        context.closePath();
      }
      const gradient = context.createLinearGradient(0, 0, 0, context.canvas.clientHeight || context.canvas.height);
      gradient.addColorStop(0, "#6e986a");
      gradient.addColorStop(1, "#344e3d");
      context.fillStyle = gradient;
      context.fill("evenodd");
      context.strokeStyle = "#31533e";
      context.lineWidth = 2;
      context.stroke();
    }
  }

  window.TerrainSystem = TerrainSystem;
})();
