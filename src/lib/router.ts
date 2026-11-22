import type {
  CampusData,
  LiveProgress,
  MapPoint,
  ResolvedDestination,
  RouteOrigin,
  RouteResult,
  WalkableData,
} from '../types';
import { distanceMetersBetween, formatWalkTime } from './geo';
import { buildDirections, buildSummarySentence } from './directions';

export interface GridCell {
  r: number;
  c: number;
}

export interface DestinationField {
  destination: ResolvedDestination;
  goalCell: GridCell;
  dist: Float64Array;
  next: Int32Array; // parent pointer moving FROM any cell TOWARD goalCell
}

class MinHeap {
  private nodes: Int32Array;
  private prio: Float64Array;
  public size = 0;

  constructor(capacity: number) {
    this.nodes = new Int32Array(capacity);
    this.prio = new Float64Array(capacity);
  }

  push(node: number, p: number): void {
    if (this.size >= this.nodes.length) {
      const nextCap = this.nodes.length * 2;
      const n2 = new Int32Array(nextCap);
      const p2 = new Float64Array(nextCap);
      n2.set(this.nodes);
      p2.set(this.prio);
      this.nodes = n2;
      this.prio = p2;
    }
    let i = this.size++;
    this.nodes[i] = node;
    this.prio[i] = p;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent] <= p) break;
      this.nodes[i] = this.nodes[parent];
      this.prio[i] = this.prio[parent];
      i = parent;
    }
    this.nodes[i] = node;
    this.prio[i] = p;
  }

  pop(): number {
    const top = this.nodes[0];
    this.size--;
    if (this.size > 0) {
      const lastNode = this.nodes[this.size];
      const lastP = this.prio[this.size];
      let i = 0;
      const half = this.size >> 1;
      while (i < half) {
        let child = (i << 1) + 1;
        const right = child + 1;
        if (right < this.size && this.prio[right] < this.prio[child]) {
          child = right;
        }
        if (lastP <= this.prio[child]) break;
        this.nodes[i] = this.nodes[child];
        this.prio[i] = this.prio[child];
        i = child;
      }
      this.nodes[i] = lastNode;
      this.prio[i] = lastP;
    }
    return top;
  }
}

export class CampusRouter {
  readonly rows: number;
  readonly cols: number;
  readonly cellSize: number;
  readonly walkable: Uint8Array;
  readonly core: Uint8Array;
  readonly clearance: Uint8Array; // 0 = blocked, 1..3 = BFS distance from nearest obstacle
  readonly campus: CampusData;
  private readonly dirs: ReadonlyArray<[number, number, number]>;
  private readonly fieldCache = new Map<string, DestinationField>();

  constructor(walkData: WalkableData, campus: CampusData) {
    this.rows = walkData.rows;
    this.cols = walkData.cols;
    this.cellSize = walkData.mapUnitsPerCell;
    this.campus = campus;

    // Exact real-world step lengths in meters (using DP's georeference: ~0.483m/u in x, ~0.472m/u in y)
    const stepXM = distanceMetersBetween({ x: 0, y: 0 }, { x: this.cellSize, y: 0 }, campus.georeference, campus.school.lat);
    const stepYM = distanceMetersBetween({ x: 0, y: 0 }, { x: 0, y: this.cellSize }, campus.georeference, campus.school.lat);
    const stepDiagM = Math.hypot(stepXM, stepYM);

    this.dirs = [
      [0, 1, stepXM],
      [0, -1, stepXM],
      [1, 0, stepYM],
      [-1, 0, stepYM],
      [1, 1, stepDiagM],
      [1, -1, stepDiagM],
      [-1, 1, stepDiagM],
      [-1, -1, stepDiagM],
    ];

    const total = this.rows * this.cols;
    this.walkable = new Uint8Array(total);
    this.core = new Uint8Array(total);
    this.clearance = new Uint8Array(total);

    for (let r = 0; r < this.rows; r++) {
      const wRow = walkData.walkable[r];
      const cRow = walkData.core[r];
      const base = r * this.cols;
      for (let c = 0; c < this.cols; c++) {
        const isW = wRow.charCodeAt(c) === 49 ? 1 : 0;
        this.walkable[base + c] = isW;
        // Core preference strictly gated by walkable === 1
        this.core[base + c] = isW && cRow.charCodeAt(c) === 49 ? 1 : 0;
      }
    }

    // 3-ring multi-source BFS clearance from every blocked cell so paths glide naturally down walkway centerlines
    this.clearance.fill(255);
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < total; i++) {
      if (!this.walkable[i]) {
        this.clearance[i] = 0;
        queue[tail++] = i;
      }
    }
    while (head < tail) {
      const idx = queue[head++];
      const curD = this.clearance[idx];
      if (curD >= 3) continue;
      const cr = (idx / this.cols) | 0;
      const cc = idx % this.cols;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const nr = cr + dr;
        const nc = cc + dc;
        if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) continue;
        const nIdx = nr * this.cols + nc;
        if (this.clearance[nIdx] === 255) {
          this.clearance[nIdx] = curD + 1;
          queue[tail++] = nIdx;
        }
      }
    }
    for (let i = 0; i < total; i++) {
      if (this.clearance[i] === 255) this.clearance[i] = 3;
    }
  }

  isWalkableCell(r: number, c: number): boolean {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return false;
    return this.walkable[r * this.cols + c] === 1;
  }

  isCoreCell(r: number, c: number): boolean {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return false;
    return this.core[r * this.cols + c] === 1;
  }

  isWalkablePoint(p: MapPoint): boolean {
    const c = Math.floor(p.x / this.cellSize);
    const r = Math.floor(p.y / this.cellSize);
    return this.isWalkableCell(r, c);
  }

  cellCenter(r: number, c: number): MapPoint {
    return {
      x: c * this.cellSize + this.cellSize * 0.5,
      y: r * this.cellSize + this.cellSize * 0.5,
    };
  }

  snapToWalkable(p: MapPoint): GridCell {
    const clampedX = Math.max(0, Math.min(this.cols * this.cellSize - 0.01, p.x));
    const clampedY = Math.max(0, Math.min(this.rows * this.cellSize - 0.01, p.y));
    const c0 = Math.floor(clampedX / this.cellSize);
    const r0 = Math.floor(clampedY / this.cellSize);

    if (this.isWalkableCell(r0, c0)) {
      return { r: r0, c: c0 };
    }

    let bestScore = Infinity;
    let best: GridCell | null = null;
    const maxRad = Math.max(this.rows, this.cols);

    for (let rad = 1; rad < maxRad; rad++) {
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.abs(dr) !== rad && Math.abs(dc) !== rad) continue;
          const r = r0 + dr;
          const c = c0 + dc;
          if (!this.isWalkableCell(r, c)) continue;
          const ctr = this.cellCenter(r, c);
          const dist = Math.hypot(ctr.x - clampedX, ctr.y - clampedY);
          const score = dist - (this.isCoreCell(r, c) ? 0.35 : 0);
          if (score < bestScore) {
            bestScore = score;
            best = { r, c };
          }
        }
      }
      if (best && rad * this.cellSize > bestScore + this.cellSize * 1.5) {
        break;
      }
    }

    if (!best) throw new Error('No walkable cell found in grid');
    return best;
  }

  /**
   * Strictly verify every grid cell touched by segment a -> b (0.5 map-unit sampling +
   * diagonal corner-cut guard) is walkable.
   */
  isSegmentClear(a: MapPoint, b: MapPoint, requireCore = false, minClearance = 0): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len / 0.5));
    let prevR = -1;
    let prevC = -1;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + dx * t;
      const y = a.y + dy * t;
      const c = Math.floor(x / this.cellSize);
      const r = Math.floor(y / this.cellSize);

      if (!this.isWalkableCell(r, c)) return false;
      if (requireCore && !this.isCoreCell(r, c)) return false;
      if (minClearance > 0 && i > 2 && i < steps - 2 && this.clearance[r * this.cols + c] < minClearance) {
        return false;
      }

      if (prevR !== -1 && r !== prevR && c !== prevC) {
        if (!this.isWalkableCell(prevR, c) || !this.isWalkableCell(r, prevC)) {
          return false;
        }
        if (requireCore && (!this.isCoreCell(prevR, c) || !this.isCoreCell(r, prevC))) {
          return false;
        }
      }

      prevR = r;
      prevC = c;
    }

    return true;
  }

  /**
   * Build & cache a centerline-preferring Dijkstra distance field outward from a destination.
   * Allows O(path length) instant live re-routing as the user walks with GPS!
   */
  getDestinationField(destination: ResolvedDestination): DestinationField {
    const targetPt = destination.routeTarget ?? { x: destination.x, y: destination.y };
    const cacheKey = `${destination.key}@${Math.round(targetPt.x)},${Math.round(targetPt.y)}`;
    const cached = this.fieldCache.get(cacheKey);
    if (cached) return cached;

    const goalCell = this.snapToWalkable(targetPt);
    const total = this.rows * this.cols;
    const dist = new Float64Array(total);
    dist.fill(Infinity);
    const next = new Int32Array(total);
    next.fill(-1);

    const startIdx = goalCell.r * this.cols + goalCell.c;
    const heap = new MinHeap(2048);
    dist[startIdx] = 0;
    heap.push(startIdx, 0);

    while (heap.size > 0) {
      const cur = heap.pop();
      const curD = dist[cur];
      const cr = (cur / this.cols) | 0;
      const cc = cur % this.cols;

      for (let d = 0; d < this.dirs.length; d++) {
        const dr = this.dirs[d][0];
        const dc = this.dirs[d][1];
        const stepMeters = this.dirs[d][2];
        const nr = cr + dr;
        const nc = cc + dc;
        if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) continue;
        const nIdx = nr * this.cols + nc;
        if (!this.walkable[nIdx]) continue;

        // No diagonal corner cutting across walls/fences
        if (dr !== 0 && dc !== 0) {
          if (!this.walkable[cr * this.cols + nc] || !this.walkable[nr * this.cols + cc]) {
            continue;
          }
        }

        // Core walkways preferred (1.0) over parking lots (1.55) + 3-cell wall clearance centerline bonus
        const surfaceMult = this.core[nIdx] ? 1.0 : 1.55;
        const wallPenalty = 0.9 * Math.max(0, 3 - this.clearance[nIdx]);
        const tentative = curD + stepMeters * surfaceMult + wallPenalty;

        if (tentative < dist[nIdx]) {
          dist[nIdx] = tentative;
          next[nIdx] = cur;
          heap.push(nIdx, tentative);
        }
      }
    }

    const field: DestinationField = { destination, goalCell, dist, next };
    // Keep cache bounded so memory stays tiny
    if (this.fieldCache.size > 16) {
      const firstKey = this.fieldCache.keys().next().value;
      if (firstKey) this.fieldCache.delete(firstKey);
    }
    this.fieldCache.set(cacheKey, field);
    return field;
  }

  /**
   * Trace grid cells from `start` toward `field.goalCell` in O(path length).
   */
  traceGridPath(start: GridCell, field: DestinationField): GridCell[] {
    let cur = start.r * this.cols + start.c;
    const goalIdx = field.goalCell.r * this.cols + field.goalCell.c;
    if (!Number.isFinite(field.dist[cur])) {
      throw new Error(`No walkable path from (${start.r},${start.c}) to (${field.goalCell.r},${field.goalCell.c})`);
    }
    const path: GridCell[] = [];
    const maxSteps = this.rows * this.cols;
    let guard = 0;
    while (cur !== -1 && guard++ < maxSteps) {
      path.push({ r: (cur / this.cols) | 0, c: cur % this.cols });
      if (cur === goalIdx) break;
      cur = field.next[cur];
    }
    return path;
  }

  /**
   * Walkable-verified string-pulling smoothing that keeps paths strictly clear of walls
   * while preserving courtyard preference and centerline comfort.
   */
  smoothPath(gridCells: GridCell[]): MapPoint[] {
    if (gridCells.length <= 2) {
      return gridCells.map((cell) => this.cellCenter(cell.r, cell.c));
    }

    const pts = gridCells.map((cell) => this.cellCenter(cell.r, cell.c));
    const result: MapPoint[] = [pts[0]];
    let anchor = 0;

    while (anchor < pts.length - 1) {
      let farthest = anchor + 1;
      const anchorIdx = gridCells[anchor].r * this.cols + gridCells[anchor].c;
      const anchorCore = this.core[anchorIdx] === 1;
      const anchorClear = this.clearance[anchorIdx] >= 2;

      for (let j = pts.length - 1; j > anchor + 1; j--) {
        const jIdx = gridCells[j].r * this.cols + gridCells[j].c;
        const keepInCore = anchorCore && this.core[jIdx] === 1;
        const minClear = anchorClear && this.clearance[jIdx] >= 2 ? 2 : 0;
        if (this.isSegmentClear(pts[anchor], pts[j], keepInCore, minClear)) {
          farthest = j;
          break;
        }
      }

      // If strict clearance couldn't skip any intermediate point, still allow a strictly walkable shortcut
      if (farthest === anchor + 1 && anchor + 2 < pts.length) {
        for (let j = Math.min(pts.length - 1, anchor + 10); j > anchor + 1; j--) {
          const jIdx = gridCells[j].r * this.cols + gridCells[j].c;
          const keepInCore = anchorCore && this.core[jIdx] === 1;
          if (this.isSegmentClear(pts[anchor], pts[j], keepInCore, 0)) {
            farthest = j;
            break;
          }
        }
      }

      result.push(pts[farthest]);
      anchor = farthest;
    }

    return result;
  }

  /**
   * Solve a complete walking route using the cached destination distance field.
   */
  route(origin: RouteOrigin, destination: ResolvedDestination): RouteResult {
    const field = this.getDestinationField(destination);
    const startCell = this.snapToWalkable({ x: origin.x, y: origin.y });
    const gridCells = this.traceGridPath(startCell, field);
    const points = this.smoothPath(gridCells);

    let distanceMeters = 0;
    for (let i = 1; i < points.length; i++) {
      distanceMeters += distanceMetersBetween(
        points[i - 1],
        points[i],
        this.campus.georeference,
        this.campus.school.lat
      );
    }

    const { minutes: walkMinutes } = formatWalkTime(distanceMeters);
    const steps = buildDirections(points, origin, destination, this.campus);
    const summarySentence = buildSummarySentence(points, origin, destination, walkMinutes, this.campus);

    return {
      origin,
      destination,
      snappedStart: this.cellCenter(startCell.r, startCell.c),
      snappedEnd: this.cellCenter(field.goalCell.r, field.goalCell.c),
      gridCells,
      points,
      distanceMeters,
      walkMinutes,
      summarySentence,
      steps,
    };
  }

  /**
   * Compute live remaining distance and off-route drift for an active GPS walker.
   */
  computeLiveProgress(userPoint: MapPoint, route: RouteResult): LiveProgress {
    const pts = route.points;
    if (pts.length < 2) {
      return { offRouteMeters: 0, remainingMeters: 0, remainingMinutes: 1, isOffRoute: false };
    }
    const geo = this.campus.georeference;
    const refLat = this.campus.school.lat;

    const segLengths: number[] = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = distanceMetersBetween(pts[i - 1], pts[i], geo, refLat);
      segLengths.push(d);
      total += d;
    }

    let bestOff = Infinity;
    let remaining = total;
    let walkedBefore = 0;

    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const segDx = (b.x - a.x) * 0.4833;
      const segDy = (b.y - a.y) * 0.4722;
      const ux = (userPoint.x - a.x) * 0.4833;
      const uy = (userPoint.y - a.y) * 0.4722;
      const lenSq = segDx * segDx + segDy * segDy;
      const t = lenSq > 1e-6 ? Math.max(0, Math.min(1, (ux * segDx + uy * segDy) / lenSq)) : 0;
      const off = Math.hypot(ux - t * segDx, uy - t * segDy);
      if (off < bestOff) {
        bestOff = off;
        remaining = Math.max(0, total - (walkedBefore + t * segLengths[i - 1]));
      }
      walkedBefore += segLengths[i - 1];
    }

    return {
      offRouteMeters: Math.round(bestOff),
      remainingMeters: Math.round(remaining),
      remainingMinutes: Math.max(1, Math.round(remaining / 75)),
      isOffRoute: bestOff > 35,
    };
  }
}
