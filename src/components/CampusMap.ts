import type {
  CampusData,
  CampusGeometry,
  MapPoint,
  RouteOrigin,
  RouteResult,
} from '../types';
import { mapUpCompassBearing } from '../lib/geo';

export type MapStyleMode = 'iso3d' | 'top2d' | 'printed';

export interface CampusMapOptions {
  container: HTMLElement;
  campus: CampusData;
  geometry: CampusGeometry;
  onMapTap: (point: MapPoint) => void;
  onEntityTap: (key: string) => void;
  onUserDrag?: () => void;
}

interface Palette {
  backdrop: string;
  parcel: string;
  parcelStroke: string;
  grassDot1: string;
  grassDot2: string;
  courtyard: string;
  courtyardGrid: string;
  road: string;
  roadDash: string;
  roadInk: string;
  parking: string;
  parkingLine: string;
  turfA: string;
  turfB: string;
  track: string;
  baseball: string;
  infield: string;
  tennis: string;
  volleyball: string;
  poolWater: string;
  poolRipple: string;
  shadow: string;
  roofs: Record<number, string>;
  wallsLit: Record<number, string>;
  wallsShade: Record<number, string>;
  bldgStroke: string;
  roomStroke: string;
  highlightRoof: string;
  highlightWall: string;
  originRoof: string;
  originWall: string;
  labelInk: string;
  labelSoft: string;
  labelHalo: string;
  routeShadow: string;
  routeCasing: string;
  routeLine: string;
  routeFlow: string;
  turnFill: string;
  turnStroke: string;
  turnText: string;
  destPin: string;
  destPinStroke: string;
  destCore: string;
  originPin: string;
}

const LIGHT_PALETTE: Palette = {
  backdrop: '#F3ECE0',
  parcel: '#E1ECD7',
  parcelStroke: '#C9D8BE',
  grassDot1: 'rgba(92, 145, 76, 0.28)',
  grassDot2: 'rgba(255, 250, 232, 0.55)',
  courtyard: '#F6F0E3',
  courtyardGrid: 'rgba(139, 128, 108, 0.14)',
  road: '#D6D9DF',
  roadDash: 'rgba(255, 255, 255, 0.85)',
  roadInk: '#6C7584',
  parking: '#DCDFE4',
  parkingLine: 'rgba(30, 44, 68, 0.16)',
  turfA: '#82BD72',
  turfB: '#74B265',
  track: '#D47B5E',
  baseball: '#8CC47B',
  infield: '#DFBE92',
  tennis: '#5F9387',
  volleyball: '#ECD8A7',
  poolWater: '#4BC0E3',
  poolRipple: 'rgba(255, 255, 255, 0.45)',
  shadow: 'rgba(18, 30, 52, 0.19)',
  roofs: {
    0: '#E5E8EE',
    1: '#F7DF8D', // Zone 1 warm gold-cream (EPAC, S, M, Admin)
    2: '#F2B8AE', // Zone 2 coastal coral-rose (Gym, Pool, T, B, Q)
    3: '#F5C996', // Zone 3 warm terracotta-sand (Cafeteria, Greek, Library, A, P, DPEA)
    4: '#AED4EC', // Zone 4 coastal sky (H, C)
  },
  wallsLit: {
    0: '#C9CFD9',
    1: '#DEC062',
    2: '#D79186',
    3: '#D8A369',
    4: '#82B2D4',
  },
  wallsShade: {
    0: '#AEB6C4',
    1: '#C5A446',
    2: '#BD7368',
    3: '#BC844A',
    4: '#6495BA',
  },
  bldgStroke: 'rgba(24, 38, 62, 0.42)',
  roomStroke: 'rgba(24, 38, 62, 0.24)',
  highlightRoof: '#F3B62B',
  highlightWall: '#B97E12',
  originRoof: '#3E8BF5',
  originWall: '#1D57AD',
  labelInk: '#162540',
  labelSoft: '#526078',
  labelHalo: 'rgba(250, 246, 238, 0.94)',
  routeShadow: 'rgba(15, 28, 52, 0.24)',
  routeCasing: '#FFFFFF',
  routeLine: '#1D5FD4',
  routeFlow: '#FFE082',
  turnFill: '#FFFFFF',
  turnStroke: '#1D5FD4',
  turnText: '#14233F',
  destPin: '#142542',
  destPinStroke: '#FFFFFF',
  destCore: '#F2B830',
  originPin: '#1D7CF2',
};

const DARK_PALETTE: Palette = {
  backdrop: '#0B1320',
  parcel: '#142334',
  parcelStroke: '#22364F',
  grassDot1: 'rgba(72, 140, 92, 0.22)',
  grassDot2: 'rgba(170, 210, 180, 0.12)',
  courtyard: '#1B2A40',
  courtyardGrid: 'rgba(170, 198, 235, 0.08)',
  road: '#0E1726',
  roadDash: 'rgba(255, 255, 255, 0.22)',
  roadInk: '#778BA8',
  parking: '#162336',
  parkingLine: 'rgba(180, 210, 245, 0.14)',
  turfA: '#22593B',
  turfB: '#1D4D33',
  track: '#7F3E30',
  baseball: '#225238',
  infield: '#644E36',
  tennis: '#235166',
  volleyball: '#69593F',
  poolWater: '#19799B',
  poolRipple: 'rgba(195, 240, 255, 0.35)',
  shadow: 'rgba(0, 4, 12, 0.48)',
  roofs: {
    0: '#2A3D58',
    1: '#594D2D',
    2: '#5A333E',
    3: '#5A412F',
    4: '#294869',
  },
  wallsLit: {
    0: '#1F2F47',
    1: '#443A20',
    2: '#46252F',
    3: '#473222',
    4: '#1F3955',
  },
  wallsShade: {
    0: '#162235',
    1: '#312915',
    2: '#331A22',
    3: '#342317',
    4: '#162A40',
  },
  bldgStroke: 'rgba(165, 196, 235, 0.36)',
  roomStroke: 'rgba(175, 204, 240, 0.2)',
  highlightRoof: '#F0B63A',
  highlightWall: '#A67213',
  originRoof: '#4CA4FF',
  originWall: '#1D61B8',
  labelInk: '#EFF5FD',
  labelSoft: '#9AB1CE',
  labelHalo: 'rgba(11, 19, 32, 0.92)',
  routeShadow: 'rgba(0, 0, 0, 0.5)',
  routeCasing: '#091529',
  routeLine: '#4EB5FF',
  routeFlow: '#FFE28A',
  turnFill: '#122238',
  turnStroke: '#4EB5FF',
  turnText: '#F0F6FF',
  destPin: '#F0B63A',
  destPinStroke: '#0B1628',
  destCore: '#0B1628',
  originPin: '#4EB5FF',
};

interface CameraState {
  cx: number;
  cy: number;
  zoom: number;
  yawDeg: number; // clockwise rotation around vertical Z axis
  tiltDeg: number; // 0 = top-down 2D, 46 = isometric 3D
}

interface LabelCandidate {
  text: string;
  x: number;
  y: number;
  z: number;
  size: number;
  tone: 'major' | 'wing' | 'soft' | 'spot' | 'room';
  pri: number;
  dot?: boolean;
  wc?: boolean;
  key?: string;
}

function pointInPoly(pts: number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], yi = pts[i + 1];
    const xj = pts[j], yj = pts[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export class CampusMap {
  private container: HTMLElement;
  private campus: CampusData;
  private geometry: CampusGeometry;
  private onMapTap: (point: MapPoint) => void;
  private onEntityTap: (key: string) => void;
  private onUserDrag?: () => void;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width = 390;
  private height = 420;
  private dpr = 1;

  private styleMode: MapStyleMode = 'iso3d';
  private printedImg: HTMLImageElement | null = null;
  private printedLoaded = false;

  private cam: CameraState = {
    cx: 545,
    cy: 455,
    zoom: 0.55,
    yawDeg: -22,
    tiltDeg: 44,
  };
  private minZoom = 0.34;
  private maxZoom = 5.2;

  private activeRoute: RouteResult | null = null;
  private activeStepIndex = -1;
  private focusOrigin: RouteOrigin | null = null;
  private userLoc: { point: MapPoint; accuracyMeters: number; headingDeg: number | null } | null = null;
  private pickOriginMode = false;

  private compassNeedle: SVGGElement | null = null;

  // Animation state
  private animReq: number | null = null;
  private animStart = 0;
  private animDur = 0;
  private animFrom: CameraState | null = null;
  private animTo: CameraState | null = null;
  private flowPhase = 0;
  private routeRevealStart = 0;
  private continuousRaf: number | null = null;
  private reducedMotion = false;

  // Pointer gestures
  private pointers = new Map<number, { x: number; y: number }>();
  private downPos: { x: number; y: number; time: number } | null = null;
  private lastTapTime = 0;
  private pinchStartDist = 0;
  private pinchStartZoom = 1;
  private pinchAnchor: MapPoint | null = null;
  private dragging = false;

  // Precomputed landmark/building label anchors
  private staticLabels: {
    major: Array<{ key: string; text: string; x: number; y: number; z: number; big: boolean }>;
    wings: Array<{ key: string; text: string; x: number; y: number; z: number }>;
    spots: Array<{ key: string; text: string; x: number; y: number; z: number; wc: boolean }>;
  };

  constructor(opts: CampusMapOptions) {
    this.container = opts.container;
    this.campus = opts.campus;
    this.geometry = opts.geometry;
    this.onMapTap = opts.onMapTap;
    this.onEntityTap = opts.onEntityTap;
    this.onUserDrag = opts.onUserDrag;

    this.reducedMotion =
      typeof window !== 'undefined' &&
      Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'campus-canvas';
    this.canvas.setAttribute('role', 'application');
    this.canvas.setAttribute('aria-label', 'Interactive 3D Dos Pueblos High School campus map');
    this.container.appendChild(this.canvas);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Could not initialize 2D canvas context');
    this.ctx = ctx;

    this.staticLabels = this.buildStaticLabels();
    this.bindGestures();
    this.resize();
    this.fitCampusOverview(false);

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        this.resize();
        this.render();
      });
      ro.observe(this.container);
    }

    // Gentle animation loop when route flow or pulse is active
    this.startLoop();
  }

  private buildStaticLabels() {
    const heightAt = (x: number, y: number): number => {
      for (const f of this.geometry.features) {
        if (f.h > 0 && pointInPoly(f.pts, x, y)) return f.h;
      }
      return 0;
    };

    const majorOverrides: Record<string, { text: string; x?: number; y?: number; big?: boolean }> = {
      stadium: { text: 'Stadium', x: 740, y: 168, big: true },
      volleyball: { text: 'Beach Volleyball', x: 516, y: 170, big: false },
      baseball: { text: 'Baseball', x: 204, y: 318, big: true },
      pool: { text: 'Pool', x: 393, y: 280, big: true },
      gym: { text: 'Gym', x: 389, y: 416, big: true },
      tennis: { text: 'Tennis', x: 171, y: 464, big: true },
      greek: { text: 'The Greek', x: 754, y: 458, big: false },
      patio: { text: 'Charger Patio', x: 690, y: 424, big: false },
      cafeteria: { text: 'Cafeteria', x: 774, y: 398, big: true },
      library: { text: 'Library', x: 658, y: 522, big: true },
      theater: { text: 'EPAC Theater', x: 395, y: 588, big: true },
      admin: { text: 'Admin', x: 589, y: 612, big: false },
      dpea: { text: 'DPEA', x: 886, y: 454, big: true },
      busloop: { text: 'Bus Loop', x: 388, y: 746, big: false },
      parking: { text: 'Student Parking', x: 184, y: 716, big: false },
    };

    const major: Array<{ key: string; text: string; x: number; y: number; z: number; big: boolean }> = [];
    for (const lm of this.campus.landmarks) {
      const ov = majorOverrides[lm.id];
      if (!ov) continue;
      const lx = ov.x ?? lm.x;
      const ly = ov.y ?? lm.y;
      major.push({
        key: `landmark:${lm.id}`,
        text: ov.text,
        x: lx,
        y: ly,
        z: heightAt(lx, ly),
        big: Boolean(ov.big),
      });
    }

    const wings: Array<{ key: string; text: string; x: number; y: number; z: number }> = [
      { key: 'building:t', text: 'T wing', x: 584, y: 372, z: 9 },
      { key: 'building:b', text: 'B wing', x: 550, y: 450, z: 9 },
      { key: 'building:s', text: 'S wing', x: 514, y: 585, z: 9 },
      { key: 'building:m', text: 'M wing', x: 574, y: 538, z: 9 },
      { key: 'building:a', text: 'A wing', x: 752, y: 505, z: 9 },
      { key: 'building:p', text: 'P wing', x: 821, y: 476, z: 9 },
      { key: 'building:h', text: 'H wing', x: 734, y: 636, z: 9 },
      { key: 'building:c', text: 'C wing', x: 864, y: 622, z: 9 },
      { key: 'building:q', text: 'Q', x: 417, y: 209, z: 9 },
    ];

    const spotIds = new Set([
      'frontdesk',
      'stafflounge',
      'ccc',
      'athletics',
      'homebleachers',
      'visitorbleachers',
      'stadiumentrance',
      'snackshack',
      'flagpole',
    ]);
    const spots: Array<{ key: string; text: string; x: number; y: number; z: number; wc: boolean }> = [];
    for (const sp of this.campus.spots) {
      const isWc = sp.id.startsWith('rr-');
      if (!isWc && !spotIds.has(sp.id)) continue;
      spots.push({
        key: `spot:${sp.id}`,
        text: isWc ? 'WC' : sp.short || sp.label,
        x: sp.x,
        y: sp.y,
        z: heightAt(sp.x, sp.y),
        wc: isWc,
      });
    }

    return { major, wings, spots };
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(160, rect.width || 390);
    this.height = Math.max(160, rect.height || 420);
    this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.minZoom = Math.min(this.width / 1080, this.height / 940) * 0.8;
  }

  private getPalette(): Palette {
    return document.documentElement.dataset.theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
  }

  setCompassNeedle(node: SVGGElement | null): void {
    this.compassNeedle = node;
    this.updateCompassNeedle();
  }

  setPickOriginMode(active: boolean): void {
    this.pickOriginMode = active;
    this.canvas.classList.toggle('pick-origin-mode', active);
  }

  getStyleMode(): MapStyleMode {
    return this.styleMode;
  }

  setStyleMode(mode: MapStyleMode): void {
    this.styleMode = mode;
    if (mode === 'printed' && !this.printedImg) {
      const img = new Image();
      img.onload = () => {
        this.printedLoaded = true;
        this.render();
      };
      img.src = './campus-map.png';
      this.printedImg = img;
    }

    if (mode === 'iso3d') {
      this.animateCamera({ ...this.cam, tiltDeg: 44, yawDeg: -22 }, 360);
    } else {
      this.animateCamera({ ...this.cam, tiltDeg: 0, yawDeg: 0 }, 320);
    }
  }

  setRotation(deg: number): void {
    this.cam.yawDeg = deg;
    this.render();
    this.updateCompassNeedle();
  }

  getRotation(): number {
    return this.cam.yawDeg;
  }

  zoomBy(factor: number): void {
    const next = Math.max(this.minZoom, Math.min(this.maxZoom, this.cam.zoom * factor));
    this.animateCamera({ ...this.cam, zoom: next }, 200);
  }

  fitCampusOverview(animate = true): void {
    this.resize();
    const tilt = this.styleMode === 'iso3d' ? 44 : 0;
    const yaw = this.styleMode === 'iso3d' ? -20 : 0;
    const cosTilt = Math.cos((tilt * Math.PI) / 180);
    const fitW = this.width / 960;
    const fitH = this.height / (840 * Math.max(0.58, cosTilt));
    const targetZoom = Math.max(this.minZoom, Math.min(fitW, fitH) * 0.98);
    this.animateCamera(
      { cx: 535, cy: 455, zoom: targetZoom, yawDeg: yaw, tiltDeg: tilt },
      animate ? 360 : 0
    );
  }

  /**
   * Dramatic 3D isometric close-up onto a specific room/building/origin (e.g., right after
   * the user confirms "Where are you right now?" by voice or camera scan!).
   */
  focusOriginIsometric(origin: RouteOrigin): void {
    this.focusOrigin = origin;
    this.styleMode = 'iso3d';
    const targetZoom = Math.max(1.85, Math.min(2.6, this.width / 205));
    this.animateCamera(
      {
        cx: origin.x,
        cy: origin.y,
        zoom: targetZoom,
        yawDeg: -26,
        tiltDeg: 50,
      },
      520
    );
  }

  fitRoute(route: RouteResult, bottomInsetPx = 0, topInsetPx = 28, rightInsetPx = 48): void {
    this.resize();
    const tilt = this.styleMode === 'iso3d' ? 42 : 0;
    const yaw = this.styleMode === 'iso3d' ? -18 : this.cam.yawDeg;
    const cosTilt = Math.cos((tilt * Math.PI) / 180);

    const leftInset = 18;
    const availW = Math.max(120, this.width - leftInset - rightInsetPx);
    const availH = Math.max(120, this.height - topInsetPx - bottomInsetPx);

    const rad = (yaw * Math.PI) / 180;
    const cosY = Math.cos(rad);
    const sinY = Math.sin(rad);

    let minRx = Infinity, maxRx = -Infinity, minRy = Infinity, maxRy = -Infinity;
    const pts: MapPoint[] = [
      ...route.points,
      { x: route.origin.x, y: route.origin.y },
      { x: route.destination.x, y: route.destination.y },
    ];
    for (const p of pts) {
      const rx = p.x * cosY - p.y * sinY;
      const ry = p.x * sinY + p.y * cosY;
      if (rx < minRx) minRx = rx;
      if (rx > maxRx) maxRx = rx;
      if (ry < minRy) minRy = ry;
      if (ry > maxRy) maxRy = ry;
    }

    const spanX = Math.max(130, maxRx - minRx + 95);
    const spanY = Math.max(130, (maxRy - minRy + 95) * Math.max(0.55, cosTilt));
    const targetZoom = Math.max(
      this.minZoom,
      Math.min(this.maxZoom * 0.72, Math.min(availW / spanX, availH / spanY))
    );

    // Un-rotate bounding box midpoint back to map space
    const midRx = (minRx + maxRx) / 2;
    const midRy = (minRy + maxRy) / 2;
    const midX = midRx * cosY + midRy * sinY;
    const midY = -midRx * sinY + midRy * cosY;

    // Shift camera so route sits cleanly inside the unobstructed window
    const sxOff = (rightInsetPx - leftInset) / 2 / targetZoom;
    const syOff = (bottomInsetPx - topInsetPx) / 2 / (targetZoom * Math.max(0.45, cosTilt));
    const offMapX = sxOff * cosY + syOff * sinY;
    const offMapY = -sxOff * sinY + syOff * cosY;

    this.animateCamera(
      {
        cx: midX + offMapX,
        cy: midY + offMapY,
        zoom: targetZoom,
        yawDeg: yaw,
        tiltDeg: tilt,
      },
      440
    );
  }

  focusPoint(pt: MapPoint, targetZoom = 2.25, bottomInsetPx = 0): void {
    const tilt = this.styleMode === 'iso3d' ? 46 : 0;
    const cosTilt = Math.max(0.45, Math.cos((tilt * Math.PI) / 180));
    const rad = (this.cam.yawDeg * Math.PI) / 180;
    const syOff = (bottomInsetPx / 2) / (targetZoom * cosTilt);
    const offMapX = syOff * Math.sin(rad);
    const offMapY = syOff * Math.cos(rad);
    this.animateCamera(
      {
        cx: pt.x + offMapX,
        cy: pt.y + offMapY,
        zoom: Math.min(this.maxZoom, targetZoom),
        yawDeg: this.cam.yawDeg,
        tiltDeg: tilt,
      },
      360
    );
  }

  renderRoute(route: RouteResult | null, activeStepIndex = -1): void {
    const isNewRoute = route !== this.activeRoute;
    this.activeRoute = route;
    this.activeStepIndex = activeStepIndex;
    if (route) {
      this.focusOrigin = route.origin;
      if (isNewRoute) this.routeRevealStart = performance.now();
    }
    this.render();
  }

  setOriginMarker(origin: RouteOrigin | null): void {
    this.focusOrigin = origin;
    this.render();
  }

  renderUserLocation(point: MapPoint | null, accuracyMeters = 12, headingDeg: number | null = null): void {
    this.userLoc = point ? { point, accuracyMeters, headingDeg } : null;
    this.render();
  }

  private animateCamera(target: CameraState, durationMs: number): void {
    if (this.animReq !== null) {
      cancelAnimationFrame(this.animReq);
      this.animReq = null;
    }
    if (durationMs <= 0 || this.reducedMotion) {
      this.cam = { ...target };
      this.render();
      this.updateCompassNeedle();
      return;
    }

    this.animFrom = { ...this.cam };
    // Take shortest angular path for yaw
    let dyaw = ((target.yawDeg - this.cam.yawDeg) % 360 + 540) % 360 - 180;
    this.animTo = { ...target, yawDeg: this.cam.yawDeg + dyaw };
    this.animStart = performance.now();
    this.animDur = durationMs;

    const tick = (now: number) => {
      if (!this.animFrom || !this.animTo) return;
      const t = Math.min(1, (now - this.animStart) / this.animDur);
      const e = 1 - Math.pow(1 - t, 3);
      this.cam = {
        cx: this.animFrom.cx + (this.animTo.cx - this.animFrom.cx) * e,
        cy: this.animFrom.cy + (this.animTo.cy - this.animFrom.cy) * e,
        zoom: this.animFrom.zoom + (this.animTo.zoom - this.animFrom.zoom) * e,
        yawDeg: this.animFrom.yawDeg + (this.animTo.yawDeg - this.animFrom.yawDeg) * e,
        tiltDeg: this.animFrom.tiltDeg + (this.animTo.tiltDeg - this.animFrom.tiltDeg) * e,
      };
      this.render();
      this.updateCompassNeedle();
      if (t < 1) {
        this.animReq = requestAnimationFrame(tick);
      } else {
        this.animReq = null;
      }
    };
    this.animReq = requestAnimationFrame(tick);
  }

  private startLoop(): void {
    const step = () => {
      if (!this.reducedMotion && (this.activeRoute || this.focusOrigin || this.userLoc)) {
        this.flowPhase = (this.flowPhase + 0.45) % 1000;
        if (this.animReq === null) {
          this.render();
        }
      }
      this.continuousRaf = requestAnimationFrame(step);
    };
    this.continuousRaf = requestAnimationFrame(step);
  }

  destroy(): void {
    if (this.continuousRaf !== null) cancelAnimationFrame(this.continuousRaf);
    if (this.animReq !== null) cancelAnimationFrame(this.animReq);
  }

  /**
   * Project a 3D campus point (x, y, z) into canvas CSS pixel coordinates (sx, sy).
   */
  private project(x: number, y: number, z = 0): { sx: number; sy: number } {
    const radYaw = (this.cam.yawDeg * Math.PI) / 180;
    const radTilt = (this.cam.tiltDeg * Math.PI) / 180;
    const cosY = Math.cos(radYaw);
    const sinY = Math.sin(radYaw);
    const cosT = Math.cos(radTilt);
    const sinT = Math.sin(radTilt);

    const dx = x - this.cam.cx;
    const dy = y - this.cam.cy;

    const rx = dx * cosY - dy * sinY;
    const ry = dx * sinY + dy * cosY;

    const sx = this.width / 2 + rx * this.cam.zoom;
    const sy = this.height / 2 + (ry * cosT - z * sinT) * this.cam.zoom;
    return { sx, sy };
  }

  /**
   * Inverse-project a screen tap (clientX, clientY) back onto the ground plane z = 0.
   */
  private screenToMap(clientX: number, clientY: number): MapPoint {
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left - this.width / 2;
    const sy = clientY - rect.top - this.height / 2;
    const radYaw = (this.cam.yawDeg * Math.PI) / 180;
    const cosT = Math.max(0.25, Math.cos((this.cam.tiltDeg * Math.PI) / 180));

    const rx = sx / this.cam.zoom;
    const ry = sy / (this.cam.zoom * cosT);

    const cosY = Math.cos(-radYaw);
    const sinY = Math.sin(-radYaw);
    return {
      x: this.cam.cx + (rx * cosY - ry * sinY),
      y: this.cam.cy + (rx * sinY + ry * cosY),
    };
  }

  private updateCompassNeedle(): void {
    if (!this.compassNeedle) return;
    const upBearing = mapUpCompassBearing(this.campus.georeference, this.campus.school.lat);
    const northAngle = -upBearing + this.cam.yawDeg;
    this.compassNeedle.setAttribute('transform', `rotate(${northAngle.toFixed(1)} 18 18)`);
  }

  private tracePoly(pts: number[], z = 0): void {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      const p = this.project(pts[i], pts[i + 1], z);
      if (i === 0) ctx.moveTo(p.sx, p.sy);
      else ctx.lineTo(p.sx, p.sy);
    }
    ctx.closePath();
  }

  private traceRect(x: number, y: number, w: number, h: number, z = 0): void {
    this.tracePoly([x, y, x + w, y, x + w, y + h, x, y + h], z);
  }

  render(): void {
    const ctx = this.ctx;
    const pal = this.getPalette();

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Clear warm cream / dark night canvas
    ctx.fillStyle = pal.backdrop;
    ctx.fillRect(0, 0, this.width, this.height);

    // Clamp camera center gently so user never gets stranded off campus
    this.cam.cx = Math.max(-80, Math.min(1080, this.cam.cx));
    this.cam.cy = Math.max(-80, Math.min(955, this.cam.cy));

    if (this.styleMode === 'printed' && this.printedLoaded && this.printedImg) {
      this.renderPrintedMap();
    } else {
      this.renderArchitecturalCampus(pal);
    }

    // Active walking route + turn markers + origin/dest pins + live GPS dot
    this.renderRouteAndPins(pal);

    // Upright collision-free labels (hidden in Printed Map mode since the PNG has its own printed text)
    if (this.styleMode !== 'printed') {
      this.renderLabels(pal);
    }

    ctx.restore();
  }

  private renderPrintedMap(): void {
    const ctx = this.ctx;
    const radYaw = (this.cam.yawDeg * Math.PI) / 180;
    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.rotate(radYaw);
    ctx.scale(this.cam.zoom, this.cam.zoom);
    ctx.translate(-this.cam.cx, -this.cam.cy);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(-100, -100, 1200, 1075);
    ctx.drawImage(this.printedImg!, 0, 0, 1000, 875);
    ctx.restore();
  }

  private renderArchitecturalCampus(pal: Palette): void {
    const ctx = this.ctx;
    const tiltFrac = Math.sin((this.cam.tiltDeg * Math.PI) / 180);

    // 1. Campus parcel base (soft sage ground)
    this.traceRect(20, 18, 960, 838);
    ctx.fillStyle = pal.parcel;
    ctx.fill();
    ctx.strokeStyle = pal.parcelStroke;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Subtle organic grass/wildflower stippling on parcel when zoomed in enough
    if (this.cam.zoom > 0.45) {
      ctx.fillStyle = pal.grassDot1;
      for (let gx = 45; gx < 960; gx += 46) {
        for (let gy = 40; gy < 830; gy += 44) {
          const p = this.project(gx + ((gy * 7) % 15), gy + ((gx * 3) % 13), 0);
          if (p.sx < -10 || p.sx > this.width + 10 || p.sy < -10 || p.sy > this.height + 10) continue;
          ctx.fillRect(p.sx, p.sy, 1.5, 1.5);
        }
      }
    }

    // 2. Perimeter roads (Cathedral Oaks Rd, Alameda Ave, Cafeteria Rd)
    ctx.fillStyle = pal.road;
    this.traceRect(-16, 10, 44, 860);
    ctx.fill();
    this.traceRect(-16, 832, 1030, 44);
    ctx.fill();
    this.traceRect(928, 268, 32, 594);
    ctx.fill();

    // Dashed road centerlines
    ctx.strokeStyle = pal.roadDash;
    ctx.lineWidth = Math.max(1, 1.3 * this.cam.zoom);
    ctx.setLineDash([7 * this.cam.zoom, 6 * this.cam.zoom]);
    for (const [x1, y1, x2, y2] of [
      [6, 26, 6, 834],
      [26, 854, 966, 854],
      [944, 280, 944, 834],
    ] as const) {
      const a = this.project(x1, y1, 0);
      const b = this.project(x2, y2, 0);
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // 3. Parking lots & Bus Loop
    ctx.fillStyle = pal.parking;
    ctx.strokeStyle = pal.parkingLine;
    ctx.lineWidth = 1;
    const lots: Array<[number, number, number, number]> = [
      [64, 540, 242, 286], // Student Parking
      [348, 702, 80, 130], // Bus Loop
      [452, 684, 158, 144], // Staff Parking (Alameda)
      [552, 298, 112, 34], // Staff Parking (Stadium)
      [816, 650, 104, 58], // Staff Parking (Cafeteria Rd)
    ];
    for (const [lx, ly, lw, lh] of lots) {
      this.traceRect(lx, ly, lw, lh);
      ctx.fill();
      ctx.stroke();
    }

    // Parking stall aisle stripes
    ctx.strokeStyle = pal.parkingLine;
    ctx.lineWidth = Math.max(0.8, 1.1 * this.cam.zoom);
    for (const px of [126, 168, 210, 252, 290]) {
      const a = this.project(px, 648, 0);
      const b = this.project(px, 786, 0);
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
    }
    // Bus Loop center island
    this.tracePoly([374, 718, 402, 718, 406, 745, 402, 774, 374, 774, 370, 745]);
    ctx.fillStyle = pal.parcel;
    ctx.fill();

    // 4. Warm cream concrete paved campus courtyards & walkways (from walkable.json core)
    ctx.save();
    ctx.beginPath();
    for (const poly of this.geometry.courtyardPolys) {
      for (let i = 0; i < poly.length; i += 2) {
        const p = this.project(poly[i], poly[i + 1], 0);
        if (i === 0) ctx.moveTo(p.sx, p.sy);
        else ctx.lineTo(p.sx, p.sy);
      }
      ctx.closePath();
    }
    ctx.fillStyle = pal.courtyard;
    ctx.fill('evenodd');
    ctx.strokeStyle = pal.courtyardGrid;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();

    // 5. Flat athletic fields & courts (Stadium, Baseball, Tennis, Beach Volleyball)
    for (const f of this.geometry.features) {
      if (f.h > 0) continue;
      this.tracePoly(f.pts, 0);
      if (f.kind === 'stadium') {
        ctx.fillStyle = pal.track;
        ctx.fill();
        ctx.strokeStyle = pal.bldgStroke;
        ctx.lineWidth = 1.1;
        ctx.stroke();
      } else if (f.kind === 'baseball') {
        ctx.fillStyle = pal.baseball;
        ctx.fill();
        ctx.strokeStyle = pal.bldgStroke;
        ctx.lineWidth = 1.1;
        ctx.stroke();
      } else if (f.kind === 'tennis') {
        ctx.fillStyle = pal.courtyard;
        ctx.fill();
        ctx.strokeStyle = pal.bldgStroke;
        ctx.lineWidth = 1;
        ctx.stroke();
      } else if (f.kind === 'volleyball') {
        ctx.fillStyle = pal.volleyball;
        ctx.fill();
        ctx.strokeStyle = pal.bldgStroke;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Stadium mowed striped turf field + yard lines
    for (const sf of this.geometry.subFeatures) {
      if (sf.kind === 'stadium_field') {
        ctx.save();
        this.tracePoly(sf.pts, 0);
        ctx.fillStyle = pal.turfA;
        ctx.fill();
        ctx.clip();
        // Alternating mowed turf stripes
        ctx.fillStyle = pal.turfB;
        for (let sx = 576; sx < 905; sx += 36) {
          this.traceRect(sx, 98, 18, 140);
          ctx.fill();
        }
        // Crisp white yard lines
        ctx.strokeStyle = 'rgba(255,255,255,0.42)';
        ctx.lineWidth = Math.max(0.8, 1 * this.cam.zoom);
        for (const yx of [632, 668, 704, 740, 776, 812, 848]) {
          const a = this.project(yx, 112, 0);
          const b = this.project(yx, 224, 0);
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.stroke();
        }
        ctx.restore();
        this.tracePoly(sf.pts, 0);
        ctx.strokeStyle = 'rgba(255,255,255,0.65)';
        ctx.lineWidth = 1.1;
        ctx.stroke();
      } else if (sf.kind === 'tennis_court') {
        this.tracePoly(sf.pts, 0);
        ctx.fillStyle = pal.tennis;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.72)';
        ctx.lineWidth = 0.9;
        ctx.stroke();
      } else if (sf.kind === 'volleyball_court') {
        this.tracePoly(sf.pts, 0);
        ctx.fillStyle = pal.volleyball;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 0.9;
        ctx.stroke();
      }
    }

    // Baseball clay infield arc & crisp diamond
    this.tracePoly([188, 382, 192, 344, 214, 316, 246, 304, 280, 304, 280, 382]);
    ctx.fillStyle = pal.infield;
    ctx.fill();
    this.tracePoly([248, 376, 220, 350, 246, 326, 272, 350]);
    ctx.fillStyle = pal.baseball;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.78)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 6. TRUE 3D EXTRUDED ARCHITECTURAL BUILDINGS (Painter's Algorithm back-to-front!)
    const radYaw = (this.cam.yawDeg * Math.PI) / 180;
    const sinY = Math.sin(radYaw);
    const cosY = Math.cos(radYaw);

    const activeDestRoomId = this.activeRoute?.destination.roomId ?? null;
    const activeOriginRoomId = this.focusOrigin?.roomId ?? null;
    const activeDestLandmark = this.activeRoute?.destination.landmarkId ?? null;

    const extruded = this.geometry.features
      .filter((f) => f.h > 0)
      .map((f) => ({
        f,
        depth: f.cx * sinY + f.cy * cosY,
      }))
      .sort((a, b) => a.depth - b.depth);

    // 6a. Cast soft ground shadows first (offset along afternoon sun vector)
    const shadowScale = 0.55 + tiltFrac * 0.65;
    ctx.fillStyle = pal.shadow;
    for (const { f } of extruded) {
      const shDx = f.h * 0.55 * shadowScale;
      const shDy = f.h * 0.45 * shadowScale;
      ctx.beginPath();
      for (let i = 0; i < f.pts.length; i += 2) {
        const p = this.project(f.pts[i] + shDx, f.pts[i + 1] + shDy, 0);
        if (i === 0) ctx.moveTo(p.sx, p.sy);
        else ctx.lineTo(p.sx, p.sy);
      }
      ctx.closePath();
      ctx.fill();
    }

    // 6b. Draw each 3D building: shaded side wall quads -> roof cap -> interior room dividers -> highlighted room roof!
    for (const { f } of extruded) {
      const hasDestRoom = Boolean(activeDestRoomId && f.roomIds.includes(activeDestRoomId));
      const hasOriginRoom = Boolean(activeOriginRoomId && f.roomIds.includes(activeOriginRoomId));
      const isLandmarkMatch =
        (activeDestLandmark === 'gym' && f.kind === 'gym') ||
        (activeDestLandmark === 'theater' && f.kind === 'epac') ||
        (activeDestLandmark === 'pool' && f.kind === 'pool_complex') ||
        (activeDestLandmark === 'greek' && f.kind === 'greek');

      // Subtle architectural pop on focused building
      const h = f.h + (hasDestRoom || hasOriginRoom || isLandmarkMatch ? 3.5 : 0);
      const zZone = f.zone || 0;

      // Render 3D vertical wall quads when tilted
      if (this.cam.tiltDeg > 2) {
        const n = f.pts.length / 2;
        const walls: Array<{
          ax: number; ay: number; bx: number; by: number;
          depth: number; lit: boolean;
        }> = [];
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const ax = f.pts[i * 2];
          const ay = f.pts[i * 2 + 1];
          const bx = f.pts[j * 2];
          const by = f.pts[j * 2 + 1];
          const mx = (ax + bx) / 2;
          const my = (ay + by) / 2;
          // Edge normal in map space
          const ex = bx - ax;
          const ey = by - ay;
          const elen = Math.hypot(ex, ey) || 1;
          const nx = ey / elen;
          const ny = -ex / elen;
          // Warm sun from (-0.6, -0.8)
          const sunDot = nx * -0.6 + ny * -0.8;
          walls.push({
            ax, ay, bx, by,
            depth: mx * sinY + my * cosY,
            lit: sunDot > 0,
          });
        }
        walls.sort((a, b) => a.depth - b.depth);

        for (const w of walls) {
          const p0 = this.project(w.ax, w.ay, 0);
          const p1 = this.project(w.bx, w.by, 0);
          const p2 = this.project(w.bx, w.by, h);
          const p3 = this.project(w.ax, w.ay, h);
          ctx.beginPath();
          ctx.moveTo(p0.sx, p0.sy);
          ctx.lineTo(p1.sx, p1.sy);
          ctx.lineTo(p2.sx, p2.sy);
          ctx.lineTo(p3.sx, p3.sy);
          ctx.closePath();
          ctx.fillStyle = w.lit ? pal.wallsLit[zZone] : pal.wallsShade[zZone];
          ctx.fill();
          ctx.strokeStyle = pal.bldgStroke;
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }

      // Roof cap
      this.tracePoly(f.pts, h);
      ctx.fillStyle = pal.roofs[zZone];
      ctx.fill();
      ctx.strokeStyle = isLandmarkMatch ? pal.highlightRoof : pal.bldgStroke;
      ctx.lineWidth = isLandmarkMatch ? 2.2 : 1.05;
      ctx.stroke();

      // Pool water drawn cleanly on top of pool complex deck
      if (f.kind === 'pool_complex') {
        for (const sf of this.geometry.subFeatures) {
          if (sf.kind !== 'pool_water') continue;
          this.tracePoly(sf.pts, h + 0.3);
          ctx.fillStyle = pal.poolWater;
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.65)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        // Swim lanes
        ctx.strokeStyle = pal.poolRipple;
        ctx.lineWidth = 0.9;
        ctx.setLineDash([4, 3]);
        for (let py = 256; py <= 300; py += 11) {
          const a = this.project(342, py, h + 0.4);
          const b = this.project(444, py, h + 0.4);
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      // Greek theater curved amphitheater tiers
      if (f.kind === 'greek') {
        ctx.strokeStyle = pal.bldgStroke;
        ctx.lineWidth = 0.9;
        for (const sf of this.geometry.subFeatures) {
          if (sf.kind !== 'greek_tier') continue;
          this.tracePoly(sf.pts, h + 0.2);
          ctx.stroke();
        }
      }

      // Individual classroom roof outlines inside this building
      if (f.roomIds.length > 0) {
        for (const rmId of f.roomIds) {
          const rm = this.geometry.rooms.find((r) => r.id === rmId);
          if (!rm) continue;
          const isDest = rm.id === activeDestRoomId;
          const isOrig = rm.id === activeOriginRoomId;

          if (isDest || isOrig) {
            // Extrude the selected classroom block slightly ABOVE the building roof in bright Gold or Blue!
            const popH = h + 4.5;
            if (this.cam.tiltDeg > 2) {
              const rn = rm.pts.length / 2;
              for (let i = 0; i < rn; i++) {
                const j = (i + 1) % rn;
                const p0 = this.project(rm.pts[i * 2], rm.pts[i * 2 + 1], h);
                const p1 = this.project(rm.pts[j * 2], rm.pts[j * 2 + 1], h);
                const p2 = this.project(rm.pts[j * 2], rm.pts[j * 2 + 1], popH);
                const p3 = this.project(rm.pts[i * 2], rm.pts[i * 2 + 1], popH);
                ctx.beginPath();
                ctx.moveTo(p0.sx, p0.sy);
                ctx.lineTo(p1.sx, p1.sy);
                ctx.lineTo(p2.sx, p2.sy);
                ctx.lineTo(p3.sx, p3.sy);
                ctx.closePath();
                ctx.fillStyle = isDest ? pal.highlightWall : pal.originWall;
                ctx.fill();
              }
            }
            this.tracePoly(rm.pts, popH);
            ctx.fillStyle = isDest ? pal.highlightRoof : pal.originRoof;
            ctx.fill();
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 1.8;
            ctx.stroke();
          } else if (this.cam.zoom > 0.65) {
            this.tracePoly(rm.pts, h + 0.1);
            ctx.strokeStyle = pal.roomStroke;
            ctx.lineWidth = 0.75;
            ctx.stroke();
          }
        }
      }
    }
  }

  private renderRouteAndPins(pal: Palette): void {
    const ctx = this.ctx;
    const zRoute = this.styleMode === 'printed' ? 0 : 2.2;

    if (this.activeRoute && this.activeRoute.points.length >= 2) {
      const pts = this.activeRoute.points;
      const elapsed = performance.now() - this.routeRevealStart;
      const revealFrac = this.reducedMotion ? 1 : Math.min(1, elapsed / 680);

      // Compute cumulative lengths for smooth draw-on reveal
      const projPts = pts.map((p) => this.project(p.x, p.y, zRoute));
      const shadowPts = pts.map((p) => this.project(p.x, p.y, 0));

      const drawPolyline = (list: Array<{ sx: number; sy: number }>) => {
        if (list.length < 2) return;
        let total = 0;
        const lens: number[] = [];
        for (let i = 1; i < list.length; i++) {
          const d = Math.hypot(list[i].sx - list[i - 1].sx, list[i].sy - list[i - 1].sy);
          lens.push(d);
          total += d;
        }
        const limit = total * revealFrac;
        ctx.beginPath();
        ctx.moveTo(list[0].sx, list[0].sy);
        let acc = 0;
        for (let i = 1; i < list.length; i++) {
          const seg = lens[i - 1];
          if (acc + seg <= limit) {
            ctx.lineTo(list[i].sx, list[i].sy);
            acc += seg;
          } else {
            const rem = Math.max(0, limit - acc);
            const f = seg > 0 ? rem / seg : 0;
            ctx.lineTo(
              list[i - 1].sx + (list[i].sx - list[i - 1].sx) * f,
              list[i - 1].sy + (list[i].sy - list[i - 1].sy) * f
            );
            break;
          }
        }
        ctx.stroke();
      };

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Soft ground shadow beneath elevated 3D route ribbon
      if (this.styleMode !== 'printed') {
        ctx.strokeStyle = pal.routeShadow;
        ctx.lineWidth = 10;
        drawPolyline(shadowPts);
      }

      // Outer casing
      ctx.strokeStyle = pal.routeCasing;
      ctx.lineWidth = 8.5;
      drawPolyline(projPts);

      // Primary glowing route line
      ctx.strokeStyle = pal.routeLine;
      ctx.lineWidth = 5;
      drawPolyline(projPts);

      // Animated directional flow dashes
      ctx.strokeStyle = pal.routeFlow;
      ctx.lineWidth = 2.4;
      ctx.setLineDash([5, 13]);
      ctx.lineDashOffset = -this.flowPhase * 0.9;
      drawPolyline(projPts);
      ctx.setLineDash([]);

      // Numbered turn step badges directly on the map
      this.activeRoute.steps.forEach((step, idx) => {
        if (step.turn === 'start' || step.turn === 'arrive') return;
        const p = this.project(step.point.x, step.point.y, zRoute + 1);
        const isCurrent = idx === this.activeStepIndex;
        const r = isCurrent ? 11 : 8.5;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
        ctx.fillStyle = isCurrent ? pal.routeLine : pal.turnFill;
        ctx.fill();
        ctx.strokeStyle = isCurrent ? '#FFFFFF' : pal.turnStroke;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = isCurrent ? '#FFFFFF' : pal.turnText;
        ctx.font = `800 ${isCurrent ? 11 : 9.5}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(step.stepNumber), p.sx, p.sy + 0.5);
      });
    }

    // Origin / "You are here" marker (when not using live GPS dot)
    const originToDraw = this.activeRoute?.origin ?? this.focusOrigin;
    if (originToDraw && originToDraw.kind !== 'gps') {
      const originPt = this.activeRoute ? this.activeRoute.snappedStart : originToDraw;
      const p = this.project(originPt.x, originPt.y, zRoute + 1);
      const pulse = 9 + Math.sin(this.flowPhase * 0.14) * 3.5;

      ctx.beginPath();
      ctx.arc(p.sx, p.sy, pulse, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(29, 124, 242, 0.24)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p.sx, p.sy, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = pal.originPin;
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Floating "You are here" pill when zoomed in on origin before destination is picked
      if (!this.activeRoute) {
        const tag = `You · ${originToDraw.label}`;
        ctx.font = '700 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        const tw = ctx.measureText(tag).width + 18;
        const bx = p.sx - tw / 2;
        const by = p.sy - 34;
        ctx.fillStyle = '#12233B';
        ctx.beginPath();
        ctx.roundRect(bx, by, tw, 24, 12);
        ctx.fill();
        ctx.strokeStyle = '#E5B44E';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tag, p.sx, by + 12.5);
      }
    }

    // Destination bouncing 3D pin + crisp label pill
    if (this.activeRoute) {
      const dest = this.activeRoute.destination;
      const destZ = this.styleMode === 'printed' ? 0 : 12;
      const p = this.project(dest.x, dest.y, destZ);
      const pulseR = 8 + ((this.flowPhase * 0.4) % 14);
      const pulseAlpha = Math.max(0, 0.45 - ((this.flowPhase * 0.4) % 14) / 32);

      // Ground pulse ring
      ctx.beginPath();
      ctx.ellipse(p.sx, p.sy, pulseR, pulseR * 0.55, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(242, 184, 48, ${pulseAlpha.toFixed(2)})`;
      ctx.fill();

      // Teardrop pin
      ctx.save();
      ctx.translate(p.sx, p.sy);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(-6, -9, -13, -15, -13, -23);
      ctx.arc(0, -23, 13, Math.PI, 0, false);
      ctx.bezierCurveTo(13, -15, 6, -9, 0, 0);
      ctx.closePath();
      ctx.fillStyle = pal.destPin;
      ctx.fill();
      ctx.strokeStyle = pal.destPinStroke;
      ctx.lineWidth = 2.2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, -23, 4.8, 0, Math.PI * 2);
      ctx.fillStyle = pal.destCore;
      ctx.fill();
      ctx.restore();

      // Floating destination pill above pin
      const destTag = dest.kind === 'teacher' ? `${dest.badge} · ${dest.title}` : dest.title;
      ctx.font = '800 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      const tw = ctx.measureText(destTag).width + 16;
      const bx = p.sx - tw / 2;
      const by = p.sy - 58;
      ctx.fillStyle = pal.destPin;
      ctx.beginPath();
      ctx.roundRect(bx, by, tw, 22, 11);
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = this.getPalette() === DARK_PALETTE ? '#0C1728' : '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(destTag, p.sx, by + 11.5);
    }

    // Live GPS dot + accuracy ring + compass heading cone
    if (this.userLoc) {
      const p = this.project(this.userLoc.point.x, this.userLoc.point.y, zRoute + 1);
      const accPx = Math.max(12, Math.min(72, (this.userLoc.accuracyMeters / 0.48) * this.cam.zoom));
      const cosT = Math.max(0.45, Math.cos((this.cam.tiltDeg * Math.PI) / 180));

      ctx.beginPath();
      ctx.ellipse(p.sx, p.sy, accPx, accPx * cosT, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(29, 124, 242, 0.14)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(29, 124, 242, 0.42)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      if (this.userLoc.headingDeg !== null) {
        const upBearing = mapUpCompassBearing(this.campus.georeference, this.campus.school.lat);
        const coneAngle = ((this.userLoc.headingDeg - upBearing + this.cam.yawDeg - 90) * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(p.sx, p.sy);
        ctx.arc(p.sx, p.sy, 32, coneAngle - 0.42, coneAngle + 0.42);
        ctx.closePath();
        ctx.fillStyle = 'rgba(29, 124, 242, 0.32)';
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(p.sx, p.sy, 7.5, 0, Math.PI * 2);
      ctx.fillStyle = '#1D7CF2';
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.6;
      ctx.stroke();
    }
  }

  private renderLabels(pal: Palette): void {
    const ctx = this.ctx;
    const z = this.cam.zoom;

    const candidates: LabelCandidate[] = [];

    for (const m of this.staticLabels.major) {
      if (!m.big && z < 0.55) continue;
      candidates.push({
        text: m.text,
        x: m.x,
        y: m.y,
        z: m.z,
        size: m.big ? 12 : 10.5,
        tone: m.key === 'landmark:parking' || m.key === 'landmark:busloop' ? 'soft' : 'major',
        pri: m.big ? 1 : 2,
        key: m.key,
      });
    }

    if (z >= 0.45 && z < 1.6) {
      for (const w of this.staticLabels.wings) {
        candidates.push({
          text: w.text,
          x: w.x,
          y: w.y,
          z: w.z,
          size: 10.5,
          tone: 'wing',
          pri: 3,
          key: w.key,
        });
      }
    }

    if (z >= 1.15) {
      for (const sp of this.staticLabels.spots) {
        if (sp.wc && z < 1.3) continue;
        candidates.push({
          text: sp.text,
          x: sp.x,
          y: sp.y,
          z: sp.z,
          size: sp.wc ? 9 : 10,
          tone: 'spot',
          pri: sp.wc ? 5 : 4,
          dot: !sp.wc,
          wc: sp.wc,
          key: sp.key,
        });
      }
    }

    if (z >= 1.4) {
      for (const rm of this.geometry.rooms) {
        const isSpecial =
          rm.id === this.activeRoute?.destination.roomId || rm.id === this.focusOrigin?.roomId;
        candidates.push({
          text: rm.label,
          x: rm.cx,
          y: rm.cy,
          z: rm.h + (isSpecial ? 5 : 0.5),
          size: isSpecial ? 11.5 : 9.5,
          tone: 'room',
          pri: isSpecial ? 0 : 6,
          key: `room:${rm.id}`,
        });
      }
    }

    candidates.sort((a, b) => a.pri - b.pri);

    // Avoid colliding with route pin, origin pin, or previously placed labels
    const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
    if (this.activeRoute) {
      const dp = this.project(this.activeRoute.destination.x, this.activeRoute.destination.y, 12);
      placed.push({ x: dp.sx, y: dp.sy - 26, w: 96, h: 64 });
      for (const s of this.activeRoute.steps) {
        if (s.turn === 'start' || s.turn === 'arrive') continue;
        const sp = this.project(s.point.x, s.point.y, 3);
        placed.push({ x: sp.sx, y: sp.sy, w: 26, h: 26 });
      }
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    for (const c of candidates) {
      const p = this.project(c.x, c.y, c.z);
      if (p.sx < -40 || p.sx > this.width + 40 || p.sy < -20 || p.sy > this.height + 20) continue;

      const weight = c.tone === 'major' || c.tone === 'wing' ? 800 : 700;
      ctx.font = `${weight} ${c.size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      const tw = c.wc ? 20 : ctx.measureText(c.text).width + 8;
      const th = c.wc ? 20 : c.size + 6;

      // Bounding box collision test
      const collides = placed.some(
        (b) => Math.abs(b.x - p.sx) * 2 < b.w + tw && Math.abs(b.y - p.sy) * 2 < b.h + th
      );
      if (collides) continue;
      placed.push({ x: p.sx, y: p.sy, w: tw, h: th });

      if (c.wc) {
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 8.5, 0, Math.PI * 2);
        ctx.fillStyle = pal.routeLine;
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '800 7.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillText('WC', p.sx, p.sy + 0.4);
        continue;
      }

      if (c.dot) {
        ctx.beginPath();
        ctx.arc(p.sx, p.sy + c.size * 0.78, 3, 0, Math.PI * 2);
        ctx.fillStyle = pal.routeLine;
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      ctx.strokeStyle = pal.labelHalo;
      ctx.lineWidth = 3.6;
      ctx.strokeText(c.text, p.sx, p.sy);
      ctx.fillStyle = c.tone === 'soft' ? pal.labelSoft : c.tone === 'spot' ? pal.routeLine : pal.labelInk;
      ctx.fillText(c.text, p.sx, p.sy);
    }
  }

  private hitTestEntity(pt: MapPoint): string | null {
    // 1. Check exact room polygon first when zoomed in
    for (const rm of this.geometry.rooms) {
      if (pointInPoly(rm.pts, pt.x, pt.y)) {
        return `room:${rm.id}`;
      }
    }
    // 2. Check nearest landmark / spot within crisp touch radius
    const touchRadius = Math.max(14, 24 / this.cam.zoom);
    let bestKey: string | null = null;
    let bestD = touchRadius;
    for (const lm of this.campus.landmarks) {
      const d = Math.hypot(lm.x - pt.x, lm.y - pt.y);
      if (d < bestD) {
        bestD = d;
        bestKey = `landmark:${lm.id}`;
      }
    }
    for (const sp of this.campus.spots) {
      const d = Math.hypot(sp.x - pt.x, sp.y - pt.y);
      if (d < bestD) {
        bestD = d;
        bestKey = `spot:${sp.id}`;
      }
    }
    if (bestKey) return bestKey;

    // 3. Check building outer polygon
    for (const f of this.geometry.features) {
      if (pointInPoly(f.pts, pt.x, pt.y)) {
        if (f.kind === 'gym') return 'landmark:gym';
        if (f.kind === 'epac') return 'landmark:theater';
        if (f.kind === 'pool_complex') return 'landmark:pool';
        if (f.kind === 'stadium') return 'landmark:stadium';
        if (f.kind === 'baseball') return 'landmark:baseball';
        if (f.kind === 'tennis') return 'landmark:tennis';
        if (f.kind === 'volleyball') return 'landmark:volleyball';
        if (f.kind === 'greek') return 'landmark:greek';
        if (f.roomIds.length > 0) {
          // Pick closest room inside this building
          let nearRm = f.roomIds[0];
          let minD = Infinity;
          for (const id of f.roomIds) {
            const rm = this.geometry.rooms.find((r) => r.id === id);
            if (!rm) continue;
            const d = Math.hypot(rm.cx - pt.x, rm.cy - pt.y);
            if (d < minD) {
              minD = d;
              nearRm = id;
            }
          }
          return `room:${nearRm}`;
        }
      }
    }
    return null;
  }

  private bindGestures(): void {
    const cvs = this.canvas;

    cvs.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 && ev.pointerType === 'mouse') return;
      cvs.setPointerCapture(ev.pointerId);
      this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

      if (this.animReq !== null) {
        cancelAnimationFrame(this.animReq);
        this.animReq = null;
      }

      if (this.pointers.size === 1) {
        this.downPos = { x: ev.clientX, y: ev.clientY, time: performance.now() };
        this.dragging = false;
      } else if (this.pointers.size === 2) {
        const pts = Array.from(this.pointers.values());
        this.pinchStartDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        this.pinchStartZoom = this.cam.zoom;
        this.pinchAnchor = this.screenToMap((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
        this.downPos = null;
        this.dragging = true;
      }
    });

    cvs.addEventListener('pointermove', (ev) => {
      const prev = this.pointers.get(ev.pointerId);
      if (!prev) return;
      const dx = ev.clientX - prev.x;
      const dy = ev.clientY - prev.y;
      this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

      if (this.pointers.size === 1) {
        if (this.downPos && Math.hypot(ev.clientX - this.downPos.x, ev.clientY - this.downPos.y) > 7) {
          this.dragging = true;
          this.onUserDrag?.();
        }
        if (this.dragging) {
          const rad = (-this.cam.yawDeg * Math.PI) / 180;
          const cosT = Math.max(0.35, Math.cos((this.cam.tiltDeg * Math.PI) / 180));
          const ux = dx / this.cam.zoom;
          const uy = dy / (this.cam.zoom * cosT);
          this.cam.cx -= ux * Math.cos(rad) - uy * Math.sin(rad);
          this.cam.cy -= ux * Math.sin(rad) + uy * Math.cos(rad);
          this.render();
        }
      } else if (this.pointers.size === 2 && this.pinchStartDist > 5 && this.pinchAnchor) {
        this.onUserDrag?.();
        const pts = Array.from(this.pointers.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        this.cam.zoom = Math.max(
          this.minZoom,
          Math.min(this.maxZoom, this.pinchStartZoom * (dist / this.pinchStartDist))
        );
        const after = this.screenToMap(midX, midY);
        this.cam.cx += this.pinchAnchor.x - after.x;
        this.cam.cy += this.pinchAnchor.y - after.y;
        this.render();
      }
    });

    const endPointer = (ev: PointerEvent) => {
      if (!this.pointers.has(ev.pointerId)) return;
      this.pointers.delete(ev.pointerId);

      if (this.pointers.size === 0 && this.downPos && !this.dragging) {
        const now = performance.now();
        if (now - this.downPos.time < 380) {
          const mapPt = this.screenToMap(ev.clientX, ev.clientY);
          if (!this.pickOriginMode && now - this.lastTapTime < 280) {
            this.lastTapTime = 0;
            this.animateCamera(
              { ...this.cam, cx: mapPt.x, cy: mapPt.y, zoom: Math.min(this.maxZoom, this.cam.zoom * 1.7) },
              220
            );
          } else {
            this.lastTapTime = now;
            if (this.pickOriginMode) {
              this.onMapTap(mapPt);
            } else {
              const hit = this.hitTestEntity(mapPt);
              if (hit) this.onEntityTap(hit);
              else this.onMapTap(mapPt);
            }
          }
        }
      }
      if (this.pointers.size < 2) this.pinchAnchor = null;
      if (this.pointers.size === 0) {
        this.downPos = null;
        this.dragging = false;
      }
    };

    cvs.addEventListener('pointerup', endPointer);
    cvs.addEventListener('pointercancel', endPointer);

    cvs.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        const anchor = this.screenToMap(ev.clientX, ev.clientY);
        const factor = ev.deltaY < 0 ? 1.18 : 1 / 1.18;
        this.cam.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.cam.zoom * factor));
        const after = this.screenToMap(ev.clientX, ev.clientY);
        this.cam.cx += anchor.x - after.x;
        this.cam.cy += anchor.y - after.y;
        this.render();
      },
      { passive: false }
    );
  }
}
