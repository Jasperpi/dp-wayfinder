import type {
  CampusData,
  MapPoint,
  ResolvedDestination,
  RouteOrigin,
  RouteStep,
  TurnKind,
} from '../types';
import {
  distanceMetersBetween,
  formatDistance,
  realWorldLandmarkRelation,
  realWorldTurnDegrees,
} from './geo';

interface NarrationAnchor {
  id: string;
  label: string;
  phrase: string;
  x: number;
  y: number;
  priority: number;
}

function landmarkPhrase(id: string, rawLabel: string): string {
  const clean = rawLabel.replace(/\s*[↑↓←→]\s*$/, '');
  if (id === 'greek') return 'the Greek Theater';
  if (id === 'patio') return 'Charger Patio';
  if (id === 'dpea') return 'the Engineering Academy';
  if (id === 'parking') return 'Student Parking';
  if (id === 'admin') return 'Administration';
  if (id === 'theater') return 'EPAC Theater';
  if (id === 'softball') return 'the Softball Fields';
  if (id === 'volleyball') return 'Beach Volleyball';
  return /^the /i.test(clean) ? clean : `the ${clean}`;
}

function buildNarrationAnchors(campus: CampusData): NarrationAnchor[] {
  const anchors: NarrationAnchor[] = [];

  for (const lm of campus.landmarks) {
    if (lm.id === 'softball') continue;
    anchors.push({
      id: `landmark:${lm.id}`,
      label: lm.label.replace(/\s*[↑↓←→]\s*$/, ''),
      phrase: landmarkPhrase(lm.id, lm.label),
      x: lm.x,
      y: lm.y,
      priority: 3,
    });
  }

  const helpfulSpotIds = new Set([
    'flagpole',
    'snackshack',
    'homebleachers',
    'visitorbleachers',
    'stadiumentrance',
    'frontdesk',
    'athletics',
  ]);
  for (const sp of campus.spots) {
    if (!helpfulSpotIds.has(sp.id)) continue;
    anchors.push({
      id: `spot:${sp.id}`,
      label: sp.label,
      phrase: `the ${sp.label}`,
      x: sp.x,
      y: sp.y,
      priority: 2,
    });
  }

  for (const [bId, info] of Object.entries(campus.buildings)) {
    if (info.at) continue;
    const bRooms = campus.rooms.filter((r) => r.building === bId);
    if (bRooms.length === 0) continue;
    const cx = bRooms.reduce((s, r) => s + r.x, 0) / bRooms.length;
    const cy = bRooms.reduce((s, r) => s + r.y, 0) / bRooms.length;
    anchors.push({
      id: `building:${bId}`,
      label: info.name,
      phrase: `the ${info.name}`,
      x: cx,
      y: cy,
      priority: 1.5,
    });
  }

  return anchors;
}

/**
 * Turn-significance simplification (combines minimum turn angle and leg length so
 * walkers only hear meaningful turns, never jittery 10-foot jogs).
 */
function simplifyForNarration(points: MapPoint[], campus: CampusData): MapPoint[] {
  if (points.length <= 2) return points;
  const geo = campus.georeference;
  const refLat = campus.school.lat;

  const working = points.slice();
  const significance = (idx: number): number => {
    const prev = working[idx - 1];
    const curr = working[idx];
    const next = working[idx + 1];
    const angle = Math.abs(realWorldTurnDegrees(prev, curr, next, geo, refLat));
    if (angle < 24) return 0;
    const shortLeg = Math.min(
      distanceMetersBetween(prev, curr, geo, refLat),
      distanceMetersBetween(curr, next, geo, refLat)
    );
    return angle * Math.min(shortLeg, 28);
  };

  while (working.length > 2) {
    let worstIdx = -1;
    let worstScore = Infinity;
    for (let i = 1; i < working.length - 1; i++) {
      const s = significance(i);
      if (s < worstScore) {
        worstScore = s;
        worstIdx = i;
      }
    }
    if (worstScore >= 520 || worstIdx === -1) break;
    working.splice(worstIdx, 1);
  }
  return working;
}

function classifyTurn(angleDeg: number): TurnKind {
  const abs = Math.abs(angleDeg);
  if (abs < 24) return 'straight';
  if (abs > 142) return 'u-turn';
  if (angleDeg > 0) {
    return abs < 58 ? 'slight-left' : 'left';
  }
  return abs < 58 ? 'slight-right' : 'right';
}

function turnVerb(turn: TurnKind): string {
  switch (turn) {
    case 'left':
      return 'Turn left';
    case 'slight-left':
      return 'Bear left';
    case 'right':
      return 'Turn right';
    case 'slight-right':
      return 'Bear right';
    case 'u-turn':
      return 'Turn around';
    default:
      return 'Continue straight';
  }
}

function findBestPassedLandmark(
  a: MapPoint,
  b: MapPoint,
  anchors: NarrationAnchor[],
  campus: CampusData,
  excludeIds: Set<string>
): { anchor: NarrationAnchor; side: 'left' | 'right' | 'ahead' } | null {
  const geo = campus.georeference;
  const refLat = campus.school.lat;
  const segMeters = distanceMetersBetween(a, b, geo, refLat);
  if (segMeters < 10) return null;

  let bestScore = Infinity;
  let best: { anchor: NarrationAnchor; side: 'left' | 'right' | 'ahead' } | null = null;

  for (const anchor of anchors) {
    if (excludeIds.has(anchor.id)) continue;
    const rel = realWorldLandmarkRelation(a, b, anchor, geo, refLat);
    if (rel.alongFraction < 0.12 || rel.alongFraction > 1.05) continue;
    if (rel.distMeters > 38) continue;
    if (rel.side === 'ahead') continue;
    const score = rel.distMeters - anchor.priority * 6;
    if (score < bestScore) {
      bestScore = score;
      best = { anchor, side: rel.side };
    }
  }
  return best;
}

function findNearestAnchorToPoint(
  pt: MapPoint,
  anchors: NarrationAnchor[],
  campus: CampusData,
  excludeIds: Set<string>,
  maxMeters = 32
): NarrationAnchor | null {
  const geo = campus.georeference;
  const refLat = campus.school.lat;
  let bestScore = Infinity;
  let best: NarrationAnchor | null = null;

  for (const anchor of anchors) {
    if (excludeIds.has(anchor.id)) continue;
    const d = distanceMetersBetween(pt, anchor, geo, refLat);
    if (d > maxMeters) continue;
    const score = d - anchor.priority * 5;
    if (score < bestScore) {
      bestScore = score;
      best = anchor;
    }
  }
  return best;
}

/**
 * Build a warm, human-friendly single-sentence overview of the walk (like a student
 * explaining the walk to a visiting parent, never using compass directions).
 */
export function buildSummarySentence(
  polyline: MapPoint[],
  origin: RouteOrigin,
  destination: ResolvedDestination,
  walkMinutes: number,
  campus: CampusData
): string {
  const geo = campus.georeference;
  const refLat = campus.school.lat;

  if (polyline.length < 2) {
    return `You're right at ${destination.title}.`;
  }

  let totalMeters = 0;
  const cumMeters = [0];
  for (let i = 1; i < polyline.length; i++) {
    totalMeters += distanceMetersBetween(polyline[i - 1], polyline[i], geo, refLat);
    cumMeters.push(totalMeters);
  }

  if (totalMeters < 10) {
    return `You're right next to ${destination.title}.`;
  }

  const passed: Array<{ id: string; phrase: string; side: 'left' | 'right' | 'ahead'; at: number }> = [];
  for (const lm of campus.landmarks) {
    if (lm.id === 'softball') continue;
    if (destination.landmarkId === lm.id) continue;
    if (distanceMetersBetween(origin, lm, geo, refLat) < 42) continue;
    if (distanceMetersBetween(destination, lm, geo, refLat) < 38) continue;

    let bestDist = Infinity;
    let bestAt = 0;
    let bestSide: 'left' | 'right' | 'ahead' = 'ahead';

    for (let i = 1; i < polyline.length; i++) {
      const rel = realWorldLandmarkRelation(polyline[i - 1], polyline[i], lm, geo, refLat);
      if (rel.distMeters < bestDist) {
        bestDist = rel.distMeters;
        const segLen = cumMeters[i] - cumMeters[i - 1];
        bestAt = cumMeters[i - 1] + Math.max(0, Math.min(1, rel.alongFraction)) * segLen;
        bestSide = rel.side;
      }
    }

    if (bestDist <= 40) {
      const frac = bestAt / totalMeters;
      if (frac >= 0.1 && frac <= 0.92) {
        passed.push({
          id: lm.id,
          phrase: landmarkPhrase(lm.id, lm.label),
          side: bestSide,
          at: bestAt,
        });
      }
    }
  }

  passed.sort((a, b) => a.at - b.at);
  const spaced: typeof passed = [];
  for (const item of passed) {
    if (spaced.length === 0 || item.at - spaced[spaced.length - 1].at >= 28) {
      spaced.push(item);
    }
    if (spaced.length >= 3) break;
  }

  const parts = [`From ${origin.phrase}, it's about a ${walkMinutes}-minute walk`];
  if (spaced.length > 0) {
    const landmarkClause = spaced
      .map((l, idx) =>
        idx === 0 && l.side !== 'ahead' ? `${l.phrase} on your ${l.side}` : l.phrase
      )
      .join(', then ');
    parts.push(`past ${landmarkClause}`);
  }

  let sentence = `${parts.join(', ')}.`;

  if (destination.buildingId && campus.buildings[destination.buildingId]) {
    const b = campus.buildings[destination.buildingId];
    const targetLabel = destination.kind === 'teacher' ? destination.badge : destination.title;
    if (b.name !== targetLabel) {
      sentence += ` ${targetLabel} is in the ${b.name} — ${b.note}.`;
    }
  }

  return sentence;
}

/**
 * Generate numbered plain-English turn-by-turn walking directions using campus landmarks
 * and strictly real-world left/right geometry (never compass directions).
 */
export function buildDirections(
  polyline: MapPoint[],
  origin: RouteOrigin,
  destination: ResolvedDestination,
  campus: CampusData
): RouteStep[] {
  const geo = campus.georeference;
  const refLat = campus.school.lat;
  const anchors = buildNarrationAnchors(campus);

  const destAnchorIds = new Set<string>([destination.key]);
  if (destination.landmarkId) destAnchorIds.add(`landmark:${destination.landmarkId}`);
  if (destination.spotId) destAnchorIds.add(`spot:${destination.spotId}`);

  const startExcludeIds = new Set<string>(destAnchorIds);
  if (origin.id === 'front') {
    startExcludeIds.add('spot:frontdesk');
    startExcludeIds.add('landmark:admin');
  } else if (origin.id === 'greek') {
    startExcludeIds.add('landmark:greek');
  } else if (origin.id === 'parking') {
    startExcludeIds.add('landmark:parking');
  }

  let totalMeters = 0;
  for (let i = 1; i < polyline.length; i++) {
    totalMeters += distanceMetersBetween(polyline[i - 1], polyline[i], geo, refLat);
  }
  if (totalMeters < 8 || polyline.length < 2) {
    return [
      {
        stepNumber: 1,
        turn: 'arrive',
        instruction: `You are right at ${destination.title}`,
        detail: destination.subtitle,
        distanceMeters: totalMeters,
        point: polyline[polyline.length - 1] ?? { x: destination.x, y: destination.y },
      },
    ];
  }

  const simp = simplifyForNarration(polyline, campus);
  const steps: RouteStep[] = [];
  const usedInPrevStep = new Set<string>();

  // Step 1: Start leg
  const firstLegMeters = distanceMetersBetween(simp[0], simp[1], geo, refLat);
  const firstPassed = findBestPassedLandmark(simp[0], simp[1], anchors, campus, startExcludeIds);
  const firstToward = !firstPassed
    ? findNearestAnchorToPoint(simp[1], anchors, campus, startExcludeIds, 34)
    : null;

  let startText = `Head out from ${origin.phrase}`;
  let startLandmarkName: string | undefined;

  if (firstPassed) {
    startText = `Head out from ${origin.phrase}, passing ${firstPassed.anchor.phrase} on your ${firstPassed.side}`;
    startLandmarkName = firstPassed.anchor.label;
    usedInPrevStep.add(firstPassed.anchor.id);
  } else if (firstToward) {
    startText = `Head out from ${origin.phrase} toward ${firstToward.phrase}`;
    startLandmarkName = firstToward.label;
    usedInPrevStep.add(firstToward.id);
  }

  steps.push({
    stepNumber: 1,
    turn: 'start',
    instruction: startText,
    detail: `Walk ${formatDistance(firstLegMeters)}`,
    distanceMeters: firstLegMeters,
    point: simp[0],
    landmarkName: startLandmarkName,
  });

  // Intermediate turn steps
  for (let i = 1; i < simp.length - 1; i++) {
    const prev = simp[i - 1];
    const curr = simp[i];
    const next = simp[i + 1];

    const angleDeg = realWorldTurnDegrees(prev, curr, next, geo, refLat);
    const turn = classifyTurn(angleDeg);
    const legMeters = distanceMetersBetween(curr, next, geo, refLat);

    const excludeForTurn = new Set([...destAnchorIds, ...usedInPrevStep]);
    const atTurn = findNearestAnchorToPoint(curr, anchors, campus, excludeForTurn, 28);
    const passedOnLeg = findBestPassedLandmark(
      curr,
      next,
      anchors,
      campus,
      new Set([...destAnchorIds, ...(atTurn ? [atTurn.id] : [])])
    );

    usedInPrevStep.clear();
    let instruction = turnVerb(turn);
    let landmarkName: string | undefined;

    if (atTurn && passedOnLeg) {
      instruction = `${turnVerb(turn)} by ${atTurn.phrase}, then pass ${passedOnLeg.anchor.phrase} on your ${passedOnLeg.side}`;
      landmarkName = passedOnLeg.anchor.label;
      usedInPrevStep.add(atTurn.id);
      usedInPrevStep.add(passedOnLeg.anchor.id);
    } else if (passedOnLeg) {
      instruction = `${turnVerb(turn)} and walk past ${passedOnLeg.anchor.phrase} on your ${passedOnLeg.side}`;
      landmarkName = passedOnLeg.anchor.label;
      usedInPrevStep.add(passedOnLeg.anchor.id);
    } else if (atTurn) {
      instruction = `${turnVerb(turn)} by ${atTurn.phrase}`;
      landmarkName = atTurn.label;
      usedInPrevStep.add(atTurn.id);
    }

    steps.push({
      stepNumber: steps.length + 1,
      turn,
      instruction,
      detail: `Continue ${formatDistance(legMeters)}`,
      distanceMeters: legMeters,
      point: curr,
      landmarkName,
    });
  }

  // Final arrival step
  const lastA = simp[simp.length - 2];
  const lastB = simp[simp.length - 1];
  const relDest = realWorldLandmarkRelation(
    lastA,
    lastB,
    { x: destination.x, y: destination.y },
    geo,
    refLat
  );

  const sidePhrase =
    relDest.side === 'left'
      ? ' on your left'
      : relDest.side === 'right'
        ? ' on your right'
        : ' ahead';

  const bldgNote =
    destination.kind === 'room' && destination.buildingId && campus.buildings[destination.buildingId]
      ? ` (${campus.buildings[destination.buildingId].name})`
      : '';

  const arriveTarget =
    destination.kind === 'teacher'
      ? `${destination.badge} (${destination.title})`
      : `${destination.title}${bldgNote}`;

  steps.push({
    stepNumber: steps.length + 1,
    turn: 'arrive',
    instruction: `Arrive at ${arriveTarget}${sidePhrase}`,
    detail: destination.subtitle,
    distanceMeters: 0,
    point: lastB,
  });

  return steps;
}
