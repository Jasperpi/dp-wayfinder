import type { ResolvedDestination, RouteOrigin } from '../types';
import type { CampusCatalog } from './catalog';

export const SCHEDULE_PERIODS = ['1', '2', '3', '4', '5'] as const;
export type SchedulePeriodKey = (typeof SCHEDULE_PERIODS)[number];

export interface SavedPeriodEntry {
  period: SchedulePeriodKey;
  destKey: string;
  note?: string;
}

export type MyScheduleMap = Partial<Record<SchedulePeriodKey, SavedPeriodEntry>>;

const STORAGE_KEY = 'dp-wayfinder-my-schedule-v1';

export function loadMySchedule(): MyScheduleMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, SavedPeriodEntry>;
    const out: MyScheduleMap = {};
    for (const p of SCHEDULE_PERIODS) {
      if (parsed[p] && typeof parsed[p].destKey === 'string') {
        out[p] = { period: p, destKey: parsed[p].destKey, note: parsed[p].note };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveMySchedule(sched: MyScheduleMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sched));
  } catch {
    // ignore storage errors
  }
}

/**
 * Encode Periods 1..5 into a compact shareable URL query parameter:
 * e.g. `1:room:S4,2:room:H27,3:landmark:dpea`
 */
export function encodeScheduleParam(sched: MyScheduleMap): string {
  const parts: string[] = [];
  for (const p of SCHEDULE_PERIODS) {
    const entry = sched[p];
    if (entry?.destKey) {
      parts.push(`${p}:${entry.destKey}`);
    }
  }
  return parts.join(',');
}

export function decodeScheduleParam(param: string | null, catalog: CampusCatalog): MyScheduleMap {
  if (!param) return {};
  const out: MyScheduleMap = {};
  for (const item of param.split(',')) {
    const idx = item.indexOf(':');
    if (idx <= 0) continue;
    const p = item.slice(0, idx).trim() as SchedulePeriodKey;
    const rawKey = item.slice(idx + 1).trim();
    if (!SCHEDULE_PERIODS.includes(p) || !rawKey) continue;
    const dest = catalog.resolveParam(rawKey);
    if (dest) {
      const course = dest.teacher?.periods[p];
      out[p] = { period: p, destKey: dest.key, note: course };
    }
  }
  return out;
}

/**
 * Given the currently routed period (e.g. Period 2), find the next saved period (e.g. Period 3)
 * and convert the current class into the next RouteOrigin so Back-to-School Night walkers
 * chain Period 1 -> Period 2 -> Period 3 -> Period 4 -> Period 5 in one tap!
 */
export function getNextScheduledStop(
  sched: MyScheduleMap,
  currentPeriod: SchedulePeriodKey | null,
  catalog: CampusCatalog
): { period: SchedulePeriodKey; destination: ResolvedDestination; note?: string } | null {
  const startIdx = currentPeriod ? SCHEDULE_PERIODS.indexOf(currentPeriod) + 1 : 0;
  for (let i = startIdx; i < SCHEDULE_PERIODS.length; i++) {
    const p = SCHEDULE_PERIODS[i];
    const entry = sched[p];
    if (!entry) continue;
    const dest = catalog.byKey.get(entry.destKey);
    if (dest) {
      return { period: p, destination: dest, note: entry.note };
    }
  }
  return null;
}

export function destinationAsOrigin(dest: ResolvedDestination): RouteOrigin {
  return {
    kind: dest.kind === 'room' ? 'room' : 'custom',
    id: dest.key,
    label: dest.kind === 'teacher' ? dest.badge : dest.title,
    phrase: dest.kind === 'room' ? dest.title : dest.kind === 'teacher' ? dest.badge : `the ${dest.title.replace(/^the\s+/i, '')}`,
    x: dest.routeTarget?.x ?? dest.x,
    y: dest.routeTarget?.y ?? dest.y,
    roomId: dest.roomId,
  };
}
