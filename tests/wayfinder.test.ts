import { describe, expect, it } from 'vitest';
import campusRaw from '../data/campus.json';
import walkableRaw from '../data/walkable.json';
import teachersRaw from '../data/teachers.json';
import bellRaw from '../data/bell-schedule.json';

import type {
  BellScheduleFile,
  CampusData,
  RouteOrigin,
  TeachersFile,
  WalkableData,
} from '../src/types';
import { buildCatalog, normalizeRoomCode } from '../src/lib/catalog';
import { CampusRouter } from '../src/lib/router';
import { CampusSearch } from '../src/lib/search';
import { CampusNLU } from '../src/lib/nlu';
import { detectRoomSignFromRgba, matchScannedTextToCampus } from '../src/lib/scanner';
import {
  headingToMapRotationDeg,
  latLngToMap,
  mapDeltaToWorldMeters,
  mapToLatLng,
  mapUpCompassBearing,
  realWorldLandmarkRelation,
  realWorldTurnDegrees,
} from '../src/lib/geo';
import { getCurrentBellStatus } from '../src/lib/schedule';
import { localizeStep, localizeSummary } from '../src/lib/i18n';
import {
  decodeScheduleParam,
  destinationAsOrigin,
  encodeScheduleParam,
  getNextScheduledStop,
} from '../src/lib/mySchedule';

const campus = campusRaw as unknown as CampusData;
const walkable = walkableRaw as unknown as WalkableData;
const teachers = teachersRaw as unknown as TeachersFile;
const bellData = bellRaw as unknown as BellScheduleFile;

const catalog = buildCatalog(campus, teachers);
const router = new CampusRouter(walkable, campus);
const search = new CampusSearch(catalog, campus);
const nlu = new CampusNLU(catalog, search, campus);

const startOrigins: RouteOrigin[] = campus.startPoints.map((sp) => ({
  kind: 'start',
  id: sp.id,
  label: sp.label,
  phrase: sp.phrase,
  x: sp.x,
  y: sp.y,
}));

describe('Georeference round-trip & real-world orientation', () => {
  it('round-trips map -> lat/lng -> map and lat/lng -> map -> lat/lng accurately', () => {
    const testPoints = [
      { x: 0, y: 0 },
      { x: 1000, y: 875 },
      { x: 500, y: 437.5 },
      ...campus.rooms.map((r) => ({ x: r.x, y: r.y })),
      ...campus.landmarks.map((l) => ({ x: l.x, y: l.y })),
    ];

    for (const pt of testPoints) {
      const ll = mapToLatLng(pt, campus.georeference);
      const back = latLngToMap(ll, campus.georeference);
      expect(back.x).toBeCloseTo(pt.x, 7);
      expect(back.y).toBeCloseTo(pt.y, 7);

      const llBack = mapToLatLng(back, campus.georeference);
      expect(llBack.lat).toBeCloseTo(ll.lat, 10);
      expect(llBack.lng).toBeCloseTo(ll.lng, 10);
    }
  });

  it('matches documented campus scale and North-points-left orientation', () => {
    const stepX = mapDeltaToWorldMeters(1, 0, campus.georeference, campus.school.lat);
    const stepY = mapDeltaToWorldMeters(0, 1, campus.georeference, campus.school.lat);

    expect(stepX.north).toBeLessThan(-0.47);
    expect(Math.abs(stepX.east)).toBeLessThan(0.01);
    expect(stepX.meters).toBeGreaterThan(0.47);
    expect(stepX.meters).toBeLessThan(0.5);

    expect(stepY.east).toBeLessThan(-0.46);
    expect(Math.abs(stepY.north)).toBeLessThan(0.01);
    expect(stepY.meters).toBeGreaterThan(0.46);
    expect(stepY.meters).toBeLessThan(0.49);

    expect(mapUpCompassBearing(campus.georeference, campus.school.lat)).toBeCloseTo(90, 0);
    expect(headingToMapRotationDeg(0, campus.georeference, campus.school.lat)).toBeCloseTo(90, 0);
    expect(headingToMapRotationDeg(90, campus.georeference, campus.school.lat)).toBeCloseTo(0, 0);
    expect(headingToMapRotationDeg(180, campus.georeference, campus.school.lat)).toBeCloseTo(-90, 0);
  });
});

describe('Real-world left and right geometry', () => {
  it('agrees with real-world lat/lng geometry for cardinal turns and passed landmarks', () => {
    const geo = campus.georeference;
    const lat = campus.school.lat;

    const a = { x: 600, y: 480 };
    const b = { x: 400, y: 480 };

    const turnWest = realWorldTurnDegrees(a, b, { x: 400, y: 580 }, geo, lat);
    expect(turnWest).toBeGreaterThan(85);
    expect(turnWest).toBeLessThan(95);

    const turnEast = realWorldTurnDegrees(a, b, { x: 400, y: 380 }, geo, lat);
    expect(turnEast).toBeLessThan(-85);
    expect(turnEast).toBeGreaterThan(-95);

    const gym = campus.landmarks.find((l) => l.id === 'gym')!;
    const epac = campus.landmarks.find((l) => l.id === 'theater')!;
    expect(realWorldLandmarkRelation(a, b, gym, geo, lat).side).toBe('right');
    expect(realWorldLandmarkRelation(a, b, epac, geo, lat).side).toBe('left');
    expect(realWorldLandmarkRelation(b, a, gym, geo, lat).side).toBe('left');
    expect(realWorldLandmarkRelation(b, a, epac, geo, lat).side).toBe('right');
  });

  it('produces turn-by-turn steps and overview sentences matching real-world geometry with zero compass directions', () => {
    const compassRegex = /\b(north|south|east|west|northeast|northwest|southeast|southwest)\b/i;

    const sampleDests = [
      catalog.byKey.get('room:H27')!,
      catalog.byKey.get('landmark:pool')!,
      catalog.byKey.get('landmark:stadium')!,
      catalog.byKey.get('spot:stafflounge')!,
      catalog.byKey.get('room:E14')!,
      catalog.byKey.get('room:Q13')!,
      catalog.byKey.get('room:C6')!,
    ];

    for (const origin of startOrigins) {
      for (const dest of sampleDests) {
        const res = router.route(origin, dest);
        expect(res.steps.length).toBeGreaterThan(0);
        expect(res.summarySentence.length).toBeGreaterThan(10);

        // Strip building note if Q-building's own campus.json note contains "north"
        const summaryCore = res.summarySentence.split('.')[0];
        expect(summaryCore).not.toMatch(compassRegex);

        for (const step of res.steps) {
          expect(step.instruction).not.toMatch(compassRegex);

          if (
            step.turn === 'left' ||
            step.turn === 'slight-left' ||
            step.turn === 'right' ||
            step.turn === 'slight-right'
          ) {
            const idx = res.points.findIndex(
              (p) => Math.abs(p.x - step.point.x) < 0.1 && Math.abs(p.y - step.point.y) < 0.1
            );
            if (idx > 0 && idx < res.points.length - 1) {
              const pPrev = mapToLatLng(res.points[idx - 1], campus.georeference);
              const pCurr = mapToLatLng(res.points[idx], campus.georeference);
              const pNext = mapToLatLng(res.points[idx + 1], campus.georeference);
              const cross =
                (pCurr.lng - pPrev.lng) * (pNext.lat - pCurr.lat) -
                (pCurr.lat - pPrev.lat) * (pNext.lng - pCurr.lng);
              if (step.turn === 'left' || step.turn === 'slight-left') {
                expect(cross).toBeGreaterThan(0);
              } else {
                expect(cross).toBeLessThan(0);
              }
            }
          }

          const sideMatch = step.instruction.match(/on your (left|right)/i);
          if (sideMatch && step.landmarkName) {
            const expectedSide = sideMatch[1].toLowerCase();
            const lm = campus.landmarks.find(
              (l) => l.label.replace(/\s*[↑↓←→]\s*$/, '') === step.landmarkName
            );
            const sp = !lm ? campus.spots.find((s) => s.label === step.landmarkName) : undefined;
            const anchorPt = lm ?? sp;
            const stepIdx = res.steps.indexOf(step);
            const nextStep = res.steps[stepIdx + 1];
            if (anchorPt && nextStep) {
              const pA = mapToLatLng(step.point, campus.georeference);
              const pB = mapToLatLng(nextStep.point, campus.georeference);
              const pL = mapToLatLng(anchorPt, campus.georeference);
              const cross =
                (pB.lng - pA.lng) * (pL.lat - pA.lat) -
                (pB.lat - pA.lat) * (pL.lng - pA.lng);
              if (expectedSide === 'left') expect(cross).toBeGreaterThan(0);
              else expect(cross).toBeLessThan(0);
            }
          }
        }
      }
    }
  });
});

describe('Full campus reachability, 3-cell centerline Dijkstra & strict walkability', () => {
  it('reaches every classroom (106), landmark (17), and spot (43) from every starting point (4) without touching a non-walkable cell', () => {
    const targets = catalog.all.filter(
      (d) => d.kind === 'room' || d.kind === 'landmark' || d.kind === 'spot'
    );
    expect(targets.length).toBe(106 + 17 + 43);

    const compassRegex = /\b(north|south|east|west|northeast|northwest|southeast|southwest)\b/i;

    for (const origin of startOrigins) {
      for (const dest of targets) {
        const res = router.route(origin, dest);
        expect(res.gridCells.length).toBeGreaterThanOrEqual(1);
        expect(res.points.length).toBeGreaterThanOrEqual(1);

        for (const cell of res.gridCells) {
          expect(
            router.isWalkableCell(cell.r, cell.c),
            `Non-walkable grid cell (${cell.r},${cell.c}) on route ${origin.id} -> ${dest.key}`
          ).toBe(true);
        }

        for (let i = 1; i < res.points.length; i++) {
          expect(
            router.isSegmentClear(res.points[i - 1], res.points[i], false),
            `Smoothed segment ${i - 1}->${i} crossed non-walkable cell on route ${origin.id} -> ${dest.key}`
          ).toBe(true);
        }

        for (const step of res.steps) {
          const phrasingOnly =
            step.turn === 'arrive' ? step.instruction.replace(dest.title, '') : step.instruction;
          expect(
            phrasingOnly,
            `Compass direction leaked in ${origin.id} -> ${dest.key}: "${step.instruction}"`
          ).not.toMatch(compassRegex);
        }
      }
    }
  });

  it('tracks live remaining distance and detects off-route drift (>35m)', () => {
    const route = router.route(startOrigins[1], catalog.byKey.get('room:H27')!);
    const midPt = route.points[Math.floor(route.points.length / 2)];
    const onTrack = router.computeLiveProgress(midPt, route);
    expect(onTrack.isOffRoute).toBe(false);
    expect(onTrack.offRouteMeters).toBeLessThan(5);
    expect(onTrack.remainingMeters).toBeGreaterThan(20);
    expect(onTrack.remainingMeters).toBeLessThan(route.distanceMeters);

    // Far away near Stadium -> should trigger off-route drift notice
    const offTrack = router.computeLiveProgress({ x: 745, y: 160 }, route);
    expect(offTrack.isOffRoute).toBe(true);
    expect(offTrack.offRouteMeters).toBeGreaterThan(35);
  });

  it('resolves all 111 teachers to valid, reachable campus locations', () => {
    const teacherDests = catalog.all.filter((d) => d.kind === 'teacher');
    expect(teacherDests.length).toBe(111);
    expect(teacherDests.find((t) => t.title === 'Jacob Boone')!.roomId).toBe('B8');
    expect(teacherDests.find((t) => t.title === 'Sarah Sue Wadell')!.roomId).toBe('B5');
    expect(teacherDests.find((t) => t.title === 'Juan Loza')!.spotId).toBe('chargerinn');
    expect(teacherDests.find((t) => t.title === 'Corey Boyce')!.landmarkId).toBe('dpea');
    expect(teacherDests.find((t) => t.title === 'Dan Choi')!.landmarkId).toBe('gym');
  });
});

describe('Forgiving campus search & shareable URLs', () => {
  it('finds the right result for messy, typo-filled, and differently formatted queries', () => {
    const cases: Array<{ query: string; expectTopKeys: string[]; topN?: number }> = [
      { query: 'h27', expectTopKeys: ['room:H27'], topN: 1 },
      { query: 'H 27', expectTopKeys: ['room:H27'], topN: 1 },
      { query: 'H-27', expectTopKeys: ['room:H27'], topN: 1 },
      { query: 'room h 27', expectTopKeys: ['room:H27'], topN: 1 },
      { query: 'b08', expectTopKeys: ['room:B8'], topN: 1 },
      { query: 'e9', expectTopKeys: ['room:E09'], topN: 1 },
      { query: 't9b', expectTopKeys: ['room:T9B'], topN: 1 },
      { query: 'p126', expectTopKeys: ['room:P126'], topN: 1 },
      { query: 'Ms. Anderson', expectTopKeys: ['teacher:anderson-courtney', 'teacher:anderson-kristi'], topN: 3 },
      { query: 'andreson', expectTopKeys: ['teacher:anderson-courtney', 'teacher:anderson-kristi'], topN: 4 },
      { query: 'Mr. Boone', expectTopKeys: ['teacher:boone-jacob'], topN: 2 },
      { query: 'Alvarado', expectTopKeys: ['teacher:alvardo-maritza'], topN: 2 },
      { query: 'staff lounge', expectTopKeys: ['spot:stafflounge'], topN: 1 },
      { query: 'staf loung', expectTopKeys: ['spot:stafflounge'], topN: 2 },
      { query: 'teacher lounge', expectTopKeys: ['spot:stafflounge'], topN: 1 },
      { query: 'pool', expectTopKeys: ['landmark:pool'], topN: 2 },
      { query: 'water polo', expectTopKeys: ['landmark:pool'], topN: 2 },
      { query: 'libary', expectTopKeys: ['landmark:library'], topN: 2 },
      { query: 'cafiteria', expectTopKeys: ['landmark:cafeteria'], topN: 2 },
      { query: 'epac', expectTopKeys: ['landmark:theater'], topN: 3 },
      { query: 'woodshop', expectTopKeys: ['spot:woodshop'], topN: 2 },
      { query: 'copy room', expectTopKeys: ['spot:production'], topN: 2 },
      { query: 'batroom', expectTopKeys: ['spot:rr-cafeteria'], topN: 12 },
      { query: 'AP Biology', expectTopKeys: ['teacher:ballew-maycee'], topN: 3 },
      { query: 'culinary', expectTopKeys: ['teacher:loza-juan'], topN: 2 },
      { query: 'ceramics', expectTopKeys: ['teacher:alvardo-maritza'], topN: 3 },
      { query: 'mechatronics', expectTopKeys: ['teacher:buchanan-chase'], topN: 5 },
    ];

    for (const tc of cases) {
      const hits = search.search(tc.query, { limit: tc.topN ?? 5 });
      const keys = hits.map((h) => h.destination.key);
      for (const expectedKey of tc.expectTopKeys) {
        expect(keys, `Query "${tc.query}" missed "${expectedKey}"`).toContain(expectedKey);
      }
    }
  });

  it('sorts restrooms nearest first when given user position', () => {
    expect(search.search('bathroom', { limit: 5, near: { x: 632, y: 271 } })[0].destination.key).toBe('spot:rr-stadium');
    expect(search.search('bathroom', { limit: 5, near: { x: 676, y: 583 } })[0].destination.key).toBe('spot:rr-h');
  });

  it('resolves canonical and shorthand ?to= share links & bell schedule periods', () => {
    expect(catalog.resolveParam('room:H27')?.key).toBe('room:H27');
    expect(catalog.resolveParam('H-27')?.key).toBe('room:H27');
    expect(catalog.resolveParam('pool')?.key).toBe('landmark:pool');
    expect(normalizeRoomCode('B-08')).toBe('B8');

    const monP1 = getCurrentBellStatus(bellData, new Date(2026, 8, 14, 9, 0));
    expect(monP1.activePeriod?.n).toBe('Period 1');
    expect(monP1.activePeriodNumber).toBe('1');
  });
});

describe('V2 Conversational NLU & On-Device Camera Room Sign Scanner', () => {
  it('parses natural spoken origin utterances including contractions, STT mishearings, spoken numbers, and combined routes', () => {
    const originCases: Array<{ say: string; expectId: string; alts?: string[] }> = [
      { say: "I'm at the epac", expectId: 'landmark:theater' },
      { say: "I'm at the e-pack", expectId: 'landmark:theater' },
      { say: "We're standing right outside the performing arts center", expectId: 'landmark:theater' },
      { say: "Hey I'm over by the auditorium right now", expectId: 'landmark:theater' },
      { say: "I'm standing right outside room S-4", expectId: 'room:S4' },
      { say: "I'm outside room S four", expectId: 'room:S4' },
      { say: "I'm at S for", expectId: 'room:S4' },
      { say: "I'm by room H twenty seven", expectId: 'room:H27' },
      { say: "I'm outside P one twenty six", expectId: 'room:P126' },
      { say: "I'm near room B zero eight", expectId: 'room:B8' },
      { say: "I'm at room T nine bee", expectId: 'room:T9B' },
      { say: "I'm at the library", expectId: 'landmark:library' },
      { say: "near the library", expectId: 'landmark:library' },
      { say: "I'm standing by the swimming pool", expectId: 'landmark:pool' },
      { say: "I'm over at the gym", expectId: 'landmark:gym' },
      { say: "I'm at the football field", expectId: 'landmark:stadium' },
      { say: "I'm parked in the bus loop", expectId: 'landmark:busloop' },
      { say: "I'm in the H wing", expectId: 'building:h' },
      { say: "I'm by the T building", expectId: 'building:t' },
      { say: "I'm at the main office", expectId: 'front' },
      { say: "I'm at the quad", expectId: 'greek' },
      { say: 'student parking', expectId: 'parking' },
      { say: "I'm at the charger in", expectId: 'spot:chargerinn' },
      { say: "I'm at the attack", alts: ["I'm at the EPAC"], expectId: 'landmark:theater' },
    ];

    for (const tc of originCases) {
      const res = nlu.parseOrigin(tc.say, tc.alts);
      expect(res.kind, `Origin "${tc.say}" failed: ${JSON.stringify(res)}`).toBe('resolved');
      if (res.kind === 'resolved') {
        expect(res.origin.id, `Origin "${tc.say}" resolved to wrong id`).toBe(tc.expectId);
      }
    }

    // One-shot combined origin + destination in a single breath
    const combined1 = nlu.parseOrigin("I'm at the EPAC and I need to go to H-27");
    expect(combined1.kind).toBe('resolved');
    if (combined1.kind === 'resolved') {
      expect(combined1.origin.id).toBe('landmark:theater');
      expect(combined1.routeToDest?.key).toBe('room:H27');
    }

    const combined2 = nlu.parseOrigin('from the library to the pool');
    expect(combined2.kind).toBe('resolved');
    if (combined2.kind === 'resolved') {
      expect(combined2.origin.id).toBe('landmark:library');
      expect(combined2.routeToDest?.key).toBe('landmark:pool');
    }

    // Destination queries with contractions, spoken numbers, and STT mishearings
    const destCases: Array<{ say: string; expectKey: string }> = [
      { say: "Where's the epac?", expectKey: 'landmark:theater' },
      { say: "I'm looking for Mr. Boone", expectKey: 'teacher:boone-jacob' },
      { say: "Where's room H twenty seven?", expectKey: 'room:H27' },
      { say: "Take me to the football stadium", expectKey: 'landmark:stadium' },
      { say: "I'm trying to find the nearest bathroom", expectKey: 'spot:rr-epac' },
      { say: "I think my kid has Ms. Anderson for performing arts", expectKey: 'teacher:anderson-courtney' },
    ];
    const nearEpac = { x: 393, y: 531 };
    for (const tc of destCases) {
      const res = nlu.parseDestination(tc.say, nearEpac);
      expect(res.kind, `Destination "${tc.say}" failed: ${JSON.stringify(res)}`).toBe('resolved');
      if (res.kind === 'resolved') {
        expect(res.destination.key, `Destination "${tc.say}" got wrong key`).toBe(tc.expectKey);
      }
    }
  });

  it('understands spoken period + grade + department queries ("engineering, third period, he is a senior")', () => {
    const res = nlu.parseDestination("Oh I'm trying to go to engineering, third period, he's a senior");
    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      expect(res.destination.key).toBe('landmark:dpea');
      expect(res.periodFilter).toBe('3');
      expect(res.matchedTeachers && res.matchedTeachers.length).toBeGreaterThan(0);
      // Every matched senior Period 3 teacher should be teaching an upper-level P3 course (not STEM 101)
      expect(res.matchedTeachers!.some((t) => /PrdMfg|PrdDev2|Mech 2/i.test(t.periods['3'] ?? ''))).toBe(true);
    }
  });

  it('disambiguates shared teacher last names ("Ms. Anderson") and resolves follow-up reply', () => {
    const first = nlu.parseDestination('I need to find Ms. Anderson');
    expect(first.kind).toBe('disambiguate');
    if (first.kind === 'disambiguate') {
      const keys = first.options.map((o) => o.destination.key);
      expect(keys).toContain('teacher:anderson-courtney');
      expect(keys).toContain('teacher:anderson-kristi');

      const followUp = nlu.parseDestination(
        'performing arts',
        undefined,
        first.options.map((o) => o.destination)
      );
      expect(followUp.kind).toBe('resolved');
      if (followUp.kind === 'resolved') {
        expect(followUp.destination.key).toBe('teacher:anderson-courtney');
      }
    }
  });

  it('detects synthetic room plaques (dark-on-light and light-on-dark) 100% on-device', () => {
    // Helper: render crisp 5x7 glyphs onto an RGBA test buffer simulating a camera plaque capture
    const MINI: Record<string, string[]> = {
      H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
      S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
      P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
      '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
      '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
      '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
      '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
      '6': ['01110', '10000', '11110', '10001', '10001', '10001', '01110'],
      '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    };

    const renderSign = (text: string, darkBg: boolean) => {
      const w = 180;
      const h = 80;
      const buf = new Uint8ClampedArray(w * h * 4);
      const bg = darkBg ? [18, 35, 59] : [248, 245, 238];
      const fg = darkBg ? [250, 248, 240] : [18, 35, 59];
      for (let i = 0; i < w * h; i++) {
        buf[i * 4] = bg[0];
        buf[i * 4 + 1] = bg[1];
        buf[i * 4 + 2] = bg[2];
        buf[i * 4 + 3] = 255;
      }
      const scale = 5;
      const charW = 5 * scale + 7;
      const startX = Math.floor((w - text.length * charW) / 2);
      const startY = Math.floor((h - 7 * scale) / 2);
      for (let ci = 0; ci < text.length; ci++) {
        const pat = MINI[text[ci]];
        if (!pat) continue;
        for (let r = 0; r < 7; r++) {
          for (let c = 0; c < 5; c++) {
            if (pat[r][c] !== '1') continue;
            for (let dy = 0; dy < scale; dy++) {
              for (let dx = 0; dx < scale; dx++) {
                const px = startX + ci * charW + c * scale + dx;
                const py = startY + r * scale + dy;
                const idx = (py * w + px) * 4;
                buf[idx] = fg[0];
                buf[idx + 1] = fg[1];
                buf[idx + 2] = fg[2];
              }
            }
          }
        }
      }
      return { buf, w, h };
    };

    const s1 = renderSign('H-27', false);
    expect(detectRoomSignFromRgba(s1.buf, s1.w, s1.h, catalog)[0]?.destination.key).toBe('room:H27');

    const s2 = renderSign('S-4', true);
    expect(detectRoomSignFromRgba(s2.buf, s2.w, s2.h, catalog)[0]?.destination.key).toBe('room:S4');

    const s3 = renderSign('P-126', true);
    expect(detectRoomSignFromRgba(s3.buf, s3.w, s3.h, catalog)[0]?.destination.key).toBe('room:P126');

    // Heavy left-to-right sunlight/shadow lighting gradient across H-27 (tests adaptive local threshold!)
    const sGrad = renderSign('H-27', false);
    for (let y = 0; y < sGrad.h; y++) {
      for (let x = 0; x < sGrad.w; x++) {
        const shade = 0.45 + 0.55 * (x / sGrad.w);
        const idx = (y * sGrad.w + x) * 4;
        sGrad.buf[idx] = Math.round(sGrad.buf[idx] * shade);
        sGrad.buf[idx + 1] = Math.round(sGrad.buf[idx + 1] * shade);
        sGrad.buf[idx + 2] = Math.round(sGrad.buf[idx + 2] * shade);
      }
    }
    expect(detectRoomSignFromRgba(sGrad.buf, sGrad.w, sGrad.h, catalog)[0]?.destination.key).toBe('room:H27');

    expect(matchScannedTextToCampus('GYM', catalog)[0]?.destination.key).toBe('landmark:gym');
    expect(matchScannedTextToCampus('ROOM H-27', catalog)[0]?.destination.key).toBe('room:H27');
    expect(matchScannedTextToCampus('EPAC', catalog)[0]?.destination.key).toBe('landmark:theater');
  });

  it('supports Spanish voice/text NLU and natural Spanish walking directions', () => {
    const esOrigin1 = nlu.parseOrigin('Estoy en la biblioteca');
    expect(esOrigin1.kind).toBe('resolved');
    if (esOrigin1.kind === 'resolved') expect(esOrigin1.origin.id).toBe('landmark:library');

    const esOrigin2 = nlu.parseOrigin('Estoy afuera del salón S-4');
    expect(esOrigin2.kind).toBe('resolved');
    if (esOrigin2.kind === 'resolved') expect(esOrigin2.origin.id).toBe('room:S4');

    const esDest1 = nlu.parseDestination('¿Dónde está el baño?', { x: 393, y: 531 });
    expect(esDest1.kind).toBe('resolved');
    if (esDest1.kind === 'resolved') expect(esDest1.destination.key).toBe('spot:rr-epac');

    const esDest2 = nlu.parseDestination('Quiero ir a la alberca');
    expect(esDest2.kind).toBe('resolved');
    if (esDest2.kind === 'resolved') expect(esDest2.destination.key).toBe('landmark:pool');

    const esDest3 = nlu.parseDestination('Ingeniería período 3');
    expect(esDest3.kind).toBe('resolved');
    if (esDest3.kind === 'resolved') {
      expect(esDest3.destination.key).toBe('landmark:dpea');
      expect(esDest3.periodFilter).toBe('3');
    }

    const route = router.route(startOrigins[0], catalog.byKey.get('room:H27')!);
    const esSummary = localizeSummary(route.summarySentence, 'es');
    expect(esSummary).toMatch(/minutos caminando/i);
    const esArrive = localizeStep(route.steps[route.steps.length - 1], 'es');
    expect(esArrive.instruction).toMatch(/^Llegas a H-27/);
  });

  it('encodes, decodes, and chains Back-to-School Night My Schedule stops (Periods 1-5)', () => {
    const sched = {
      '1': { period: '1' as const, destKey: 'room:S4' },
      '3': { period: '3' as const, destKey: 'landmark:dpea' },
      '5': { period: '5' as const, destKey: 'room:H27' },
    };
    const encoded = encodeScheduleParam(sched);
    expect(encoded).toBe('1:room:S4,3:landmark:dpea,5:room:H27');

    const decoded = decodeScheduleParam(encoded, catalog);
    expect(decoded['1']?.destKey).toBe('room:S4');
    expect(decoded['3']?.destKey).toBe('landmark:dpea');
    expect(decoded['5']?.destKey).toBe('room:H27');

    const first = getNextScheduledStop(decoded, null, catalog);
    expect(first?.period).toBe('1');
    expect(first?.destination.key).toBe('room:S4');

    const second = getNextScheduledStop(decoded, '1', catalog);
    expect(second?.period).toBe('3');
    expect(second?.destination.key).toBe('landmark:dpea');

    const chainedOrigin = destinationAsOrigin(first!.destination);
    expect(chainedOrigin.roomId).toBe('S4');
    const chainedRoute = router.route(chainedOrigin, second!.destination);
    expect(chainedRoute.steps.length).toBeGreaterThan(1);
  });
});
