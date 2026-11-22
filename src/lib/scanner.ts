import type { ResolvedDestination } from '../types';
import { type CampusCatalog, normalizeRoomCode } from './catalog';
import { damerauLevenshtein } from './search';

export interface ScanCandidate {
  destination: ResolvedDestination;
  confidence: number; // 0..1
  rawText: string;
}

/**
 * Full uppercase A-Z & 0-9 pixel-font templates (5x7) for Dos Pueblos classroom plaques & building signs.
 * Runs 100% on-device with zero external dependencies.
 */
const GLYPH_PATTERNS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['01110', '10000', '11110', '10001', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
};

const T_W = 10;
const T_H = 14;

const TEMPLATES: Array<{ ch: string; vec: Float32Array; isDigit: boolean; isLetter: boolean }> =
  Object.entries(GLYPH_PATTERNS).map(([ch, rows]) => {
    const vec = new Float32Array(T_W * T_H);
    let sum = 0;
    for (let y = 0; y < T_H; y++) {
      const sr = rows[Math.min(6, Math.floor((y * 7) / T_H))];
      for (let x = 0; x < T_W; x++) {
        const v = sr[Math.min(4, Math.floor((x * 5) / T_W))] === '1' ? 1 : 0;
        vec[y * T_W + x] = v;
        sum += v;
      }
    }
    const mean = sum / vec.length;
    let norm = 0;
    for (let i = 0; i < vec.length; i++) {
      vec[i] -= mean;
      norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    return {
      ch,
      vec,
      isDigit: ch >= '0' && ch <= '9',
      isLetter: ch >= 'A' && ch <= 'Z',
    };
  });

const SIGN_ALIASES: Array<[string, string]> = [
  ['GYM', 'landmark:gym'],
  ['POOL', 'landmark:pool'],
  ['DPEA', 'landmark:dpea'],
  ['EPAC', 'landmark:theater'],
  ['THEATER', 'landmark:theater'],
  ['THEATRE', 'landmark:theater'],
  ['LIB', 'landmark:library'],
  ['LIBRARY', 'landmark:library'],
  ['ADMIN', 'landmark:admin'],
  ['OFFICE', 'landmark:admin'],
  ['CAFE', 'landmark:cafeteria'],
  ['CAFETERIA', 'landmark:cafeteria'],
  ['GREEK', 'landmark:greek'],
  ['STADIUM', 'landmark:stadium'],
  ['LOUNGE', 'spot:stafflounge'],
  ['STAFF', 'spot:stafflounge'],
  ['WOODSHOP', 'spot:woodshop'],
  ['WEIGHT', 'spot:weightroom'],
];

function otsuThreshold(gray: Uint8Array): number {
  const hist = new Int32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let bestLo = 128;
  let bestHi = 128;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar + 1e-6) {
      maxVar = between;
      bestLo = t;
      bestHi = t;
    } else if (Math.abs(between - maxVar) <= 1e-6) {
      bestHi = t;
    }
  }
  return Math.floor((bestLo + bestHi) / 2);
}

/**
 * O(W*H) integral-image adaptive local thresholding — handles real-world sunlight,
 * shadows, and glossy glare across classroom door plaques!
 */
function buildAdaptiveBinary(gray: Uint8Array, w: number, h: number, invert: boolean, margin = 10): Uint8Array {
  const integral = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    const dstRow = (y + 1) * (w + 1);
    const prevRow = y * (w + 1);
    const srcRow = y * w;
    for (let x = 0; x < w; x++) {
      rowSum += gray[srcRow + x];
      integral[dstRow + x + 1] = integral[prevRow + x + 1] + rowSum;
    }
  }

  const rad = Math.max(8, Math.floor(Math.min(w, h) * 0.18));
  const bin = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - rad);
    const y1 = Math.min(h - 1, y + rad);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - rad);
      const x1 = Math.min(w - 1, x + rad);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * (w + 1) + (x1 + 1)] -
        integral[y0 * (w + 1) + (x1 + 1)] -
        integral[(y1 + 1) * (w + 1) + x0] +
        integral[y0 * (w + 1) + x0];
      const localMean = sum / area;
      const v = gray[y * w + x];
      bin[y * w + x] = invert ? (v > localMean + margin ? 1 : 0) : v < localMean - margin ? 1 : 0;
    }
  }
  return bin;
}

interface GlyphBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  area: number;
}

function extractGlyphBoxes(bin: Uint8Array, w: number, h: number): GlyphBox[] {
  const visited = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const boxes: GlyphBox[] = [];

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (!bin[idx] || visited[idx]) continue;

      let sp = 0;
      stack[sp++] = idx;
      visited[idx] = 1;
      let minX = x, maxX = x, minY = y, maxY = y, area = 0;

      while (sp > 0) {
        const cur = stack[--sp];
        const cy = (cur / w) | 0;
        const cx = cur % w;
        area++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        for (let dy = -1; dy <= 1; dy++) {
          const ny = cy + dy;
          if (ny < 0 || ny >= h) continue;
          const rowBase = ny * w;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            if (nx < 0 || nx >= w) continue;
            const n = rowBase + nx;
            if (bin[n] && !visited[n]) {
              visited[n] = 1;
              stack[sp++] = n;
            }
          }
        }
      }

      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (
        bh >= Math.max(8, h * 0.13) &&
        bh <= h * 0.88 &&
        bw >= 2 &&
        bw <= w * 0.45 &&
        area >= 12 &&
        bw / bh <= 1.65
      ) {
        boxes.push({ x0: minX, y0: minY, x1: maxX, y1: maxY, area });
      }
    }
  }

  if (boxes.length === 0) return [];

  boxes.sort((a, b) => a.x0 - b.x0);
  let bestRow: GlyphBox[] = [];
  let bestRowScore = -1;

  for (const seed of boxes) {
    const seedH = seed.y1 - seed.y0 + 1;
    const seedCy = (seed.y0 + seed.y1) / 2;
    const row = boxes.filter((b) => {
      const bh = b.y1 - b.y0 + 1;
      const bCy = (b.y0 + b.y1) / 2;
      const isDash = bh < seedH * 0.35 && b.x1 - b.x0 + 1 > bh;
      if (isDash) return false;
      return Math.abs(bCy - seedCy) < seedH * 0.45 && bh > seedH * 0.55 && bh < seedH * 1.55;
    });
    const rowScore =
      row.reduce((s, b) => s + (b.y1 - b.y0 + 1), 0) * (row.length >= 2 && row.length <= 7 ? 1.5 : 0.7);
    if (rowScore > bestRowScore) {
      bestRowScore = rowScore;
      bestRow = row;
    }
  }

  return bestRow.slice(0, 8);
}

function scoreGlyph(bin: Uint8Array, w: number, box: GlyphBox): Array<{ ch: string; score: number }> {
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  const vec = new Float32Array(T_W * T_H);

  let sum = 0;
  for (let ty = 0; ty < T_H; ty++) {
    const sy = Math.min(box.y1, box.y0 + Math.floor((ty * bh) / T_H));
    for (let tx = 0; tx < T_W; tx++) {
      const sx = Math.min(box.x1, box.x0 + Math.floor((tx * bw) / T_W));
      const v = bin[sy * w + sx] ? 1 : 0;
      vec[ty * T_W + tx] = v;
      sum += v;
    }
  }
  const mean = sum / vec.length;
  let norm = 0;
  for (let i = 0; i < vec.length; i++) {
    vec[i] -= mean;
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;

  const aspect = bw / bh;
  const scores = TEMPLATES.map((tpl) => {
    let dot = 0;
    for (let i = 0; i < vec.length; i++) dot += vec[i] * tpl.vec[i];
    if (aspect < 0.36 && (tpl.ch === '1' || tpl.ch === 'I')) dot += 0.22;
    if (aspect > 0.48 && (tpl.ch === '1' || tpl.ch === 'I')) dot -= 0.14;
    return { ch: tpl.ch, score: dot };
  });

  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, 3);
}

/**
 * Match a raw recognized text string against Dos Pueblos' closed vocabulary of
 * 106 classrooms and major building signs (zero hallucinated rooms!).
 */
export function matchScannedTextToCampus(rawText: string, catalog: CampusCatalog): ScanCandidate[] {
  const strippedRoomWord = rawText.replace(/\b(?:ROOM|RM|BLDG|BUILDING)\b/gi, ' ');
  const upper = strippedRoomWord.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (upper.length < 2) return [];

  const results = new Map<string, ScanCandidate>();
  const record = (dest: ResolvedDestination, confidence: number, text: string) => {
    const prev = results.get(dest.key);
    if (!prev || confidence > prev.confidence) {
      results.set(dest.key, { destination: dest, confidence, rawText: text });
    }
  };

  // 1. Direct / normalized room match (e.g. "H27", "B08", "E09", "T9B", "P126")
  const norm = normalizeRoomCode(upper);
  const directRoom = catalog.roomsByNorm.get(norm);
  if (directRoom) {
    const dest = catalog.byKey.get(`room:${directRoom.id}`);
    if (dest) record(dest, 0.96, rawText);
  }

  // Also check embedded room code substrings inside noisy sign reads (e.g. "DP H27" -> "H27")
  const embedded = rawText.toUpperCase().match(/\b([A-Z]{1,2})[\s\-]?(\d{1,3}[A-Z]?)\b/g);
  if (embedded) {
    for (const part of embedded) {
      const rm = catalog.roomsByNorm.get(normalizeRoomCode(part));
      if (rm) {
        const dest = catalog.byKey.get(`room:${rm.id}`);
        if (dest) record(dest, 0.94, part);
      }
    }
  }

  // 2. Building sign aliases ("GYM", "POOL", "DPEA", "EPAC", "LIBRARY", "THEATER")
  for (const [alias, key] of SIGN_ALIASES) {
    if (upper === alias || upper.includes(alias)) {
      const dest = catalog.byKey.get(key);
      if (dest) record(dest, 0.92, rawText);
    } else if (alias.length >= 3 && damerauLevenshtein(upper, alias, 1) === 1) {
      const dest = catalog.byKey.get(key);
      if (dest) record(dest, 0.72, rawText);
    }
  }

  // 3. OCR confusion forgiveness (0<->O, 1<->I/L, 5<->S, 8<->B, 2<->Z) against all 106 real room codes
  const ocrFixDigit = (s: string) =>
    s.replace(/O/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
  const ocrFixPrefix = (ch: string) =>
    ch === '8' ? 'B' : ch === '5' ? 'S' : ch === '0' ? 'Q' : ch === '1' ? 'L' : ch;

  const fixedCode =
    upper.length >= 2 ? normalizeRoomCode(ocrFixPrefix(upper[0]) + ocrFixDigit(upper.slice(1))) : norm;

  const fixedRoom = catalog.roomsByNorm.get(fixedCode);
  if (fixedRoom) {
    const dest = catalog.byKey.get(`room:${fixedRoom.id}`);
    if (dest) record(dest, 0.88, rawText);
  }

  // 4. Fuzzy distance-1 fallback against all 106 rooms
  for (const [rmCode, rm] of catalog.roomsByNorm.entries()) {
    const dist = Math.min(damerauLevenshtein(norm, rmCode, 1), damerauLevenshtein(fixedCode, rmCode, 1));
    if (dist <= 1) {
      const dest = catalog.byKey.get(`room:${rm.id}`);
      if (dest) record(dest, dist === 0 ? 0.94 : 0.68, rawText);
    }
  }

  return Array.from(results.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 4);
}

function runBinaryPass(
  bin: Uint8Array,
  width: number,
  height: number,
  catalog: CampusCatalog,
  allCandidates: Map<string, ScanCandidate>,
  weight: number
): void {
  const boxes = extractGlyphBoxes(bin, width, height);
  if (boxes.length < 2 || boxes.length > 8) return;

  const perGlyph = boxes.map((b) => scoreGlyph(bin, width, b));

  let beam: Array<{ text: string; score: number }> = [{ text: '', score: 0 }];
  for (const choices of perGlyph) {
    const next: Array<{ text: string; score: number }> = [];
    for (const b of beam) {
      for (const c of choices.slice(0, 2)) {
        next.push({ text: b.text + c.ch, score: b.score + c.score });
      }
    }
    next.sort((a, b) => b.score - a.score);
    beam = next.slice(0, 14);
  }

  for (const item of beam) {
    const avgSim = item.score / boxes.length;
    if (avgSim < 0.24) continue;
    const matches = matchScannedTextToCampus(item.text, catalog);
    for (const m of matches) {
      const conf = Math.min(0.98, m.confidence * weight * Math.max(0.45, Math.min(1, avgSim * 1.15)));
      const prev = allCandidates.get(m.destination.key);
      if (!prev || conf > prev.confidence) {
        allCandidates.set(m.destination.key, {
          destination: m.destination,
          confidence: conf,
          rawText: item.text,
        });
      }
    }
  }
}

/**
 * Pure pixel-buffer room sign detector using BOTH global Otsu AND adaptive local thresholding
 * across both polarities (works 100% offline on sunlit, shadowed, or dark-plaque signs).
 */
export function detectRoomSignFromRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  catalog: CampusCatalog
): ScanCandidate[] {
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
  }

  const thresh = otsuThreshold(gray);
  const allCandidates = new Map<string, ScanCandidate>();

  for (const invert of [false, true]) {
    // Pass 1: Global Otsu threshold
    const otsuBin = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i++) {
      otsuBin[i] = invert ? (gray[i] > thresh ? 1 : 0) : gray[i] < thresh ? 1 : 0;
    }
    runBinaryPass(otsuBin, width, height, catalog, allCandidates, 1.0);

    // Pass 2: Adaptive local mean threshold (handles uneven shadows & glare)
    const adaptBin = buildAdaptiveBinary(gray, width, height, invert, 10);
    runBinaryPass(adaptBin, width, height, catalog, allCandidates, 0.96);
  }

  return Array.from(allCandidates.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 4);
}

interface TextDetectorLike {
  detect(source: HTMLCanvasElement): Promise<Array<{ rawValue: string }>>;
}

/**
 * Analyze a captured camera canvas — tries native browser TextDetector if available,
 * then runs our multi-pass 100% offline OCR engine against DP's 106 rooms & building signs.
 */
export async function detectRoomSignFromCanvas(
  canvas: HTMLCanvasElement,
  catalog: CampusCatalog
): Promise<ScanCandidate[]> {
  const combined = new Map<string, ScanCandidate>();
  const addAll = (list: ScanCandidate[]) => {
    for (const item of list) {
      const prev = combined.get(item.destination.key);
      if (!prev || item.confidence > prev.confidence) {
        combined.set(item.destination.key, item);
      }
    }
  };

  // Fast path: Chromium Shape Detection TextDetector API if present on device
  const TextDetCtor = (window as unknown as { TextDetector?: new () => TextDetectorLike }).TextDetector;
  if (typeof TextDetCtor === 'function') {
    try {
      const detector = new TextDetCtor();
      const blocks = await detector.detect(canvas);
      for (const b of blocks) {
        const tokens = b.rawValue.split(/[\s\n]+/);
        for (const tok of tokens) {
          addAll(matchScannedTextToCampus(tok, catalog));
        }
        addAll(matchScannedTextToCampus(b.rawValue, catalog));
      }
    } catch {
      // Fallback cleanly to our built-in pixel OCR
    }
  }

  // Built-in 100% offline multi-pass pixel plaque detector
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    addAll(detectRoomSignFromRgba(img.data, canvas.width, canvas.height, catalog));
  }

  return Array.from(combined.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 4);
}
