import type {
  CampusData,
  DestinationKind,
  MapPoint,
  ResolvedDestination,
  RoomData,
  TeacherData,
  TeachersFile,
} from '../types';

/**
 * Normalize a room code so "h27", "H 27", "H-27", "B-08", "b8", "E-09", "e9" all match.
 */
export function normalizeRoomCode(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = cleaned.match(/^([A-Z]+)0+(\d+[A-Z]*)$/);
  return m ? `${m[1]}${m[2]}` : cleaned;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Official entrance spots from campus.json for large enclosed landmarks whose center
 * pin sits deep inside walls/tracks and would otherwise snap to a rear wall or away bleachers.
 */
const LANDMARK_ENTRANCE_SPOT: Record<string, string> = {
  stadium: 'stadiumentrance',
  gym: 'gymlobby',
  theater: 'epaclobby',
  admin: 'frontdesk',
  pool: 'pooloffice',
  dpea: 'rr-dpea',
};

/**
 * Teacher `rooms` values that refer to a campus landmark or spot instead of a classroom label.
 */
const TEACHER_SPECIAL_LOCATION: Record<string, { kind: 'landmark' | 'spot'; id: string }> = {
  DPEA: { kind: 'landmark', id: 'dpea' },
  GYM: { kind: 'landmark', id: 'gym' },
  CHARGER: { kind: 'spot', id: 'chargerinn' },
};

export interface CampusCatalog {
  all: ResolvedDestination[];
  byKey: Map<string, ResolvedDestination>;
  roomsByNorm: Map<string, RoomData>;
  teachersByRoomId: Map<string, TeacherData[]>;
  teachersByLandmarkId: Map<string, TeacherData[]>;
  teachersBySpotId: Map<string, TeacherData[]>;
  /** Resolve a share URL `?to=...` value (canonical key or shorthand like "H-27" or "pool") */
  resolveParam(param: string | null): ResolvedDestination | null;
}

export function buildCatalog(campus: CampusData, teachersFile: TeachersFile): CampusCatalog {
  const roomsByNorm = new Map<string, RoomData>();
  for (const r of campus.rooms) {
    roomsByNorm.set(normalizeRoomCode(r.label), r);
    roomsByNorm.set(normalizeRoomCode(r.id), r);
  }

  const landmarksById = new Map(campus.landmarks.map((l) => [l.id, l]));
  const spotsById = new Map(campus.spots.map((s) => [s.id, s]));

  const teachersByRoomId = new Map<string, TeacherData[]>();
  const teachersByLandmarkId = new Map<string, TeacherData[]>();
  const teachersBySpotId = new Map<string, TeacherData[]>();

  const pushMap = <K, V>(map: Map<K, V[]>, k: K, v: V) => {
    const arr = map.get(k);
    if (arr) arr.push(v);
    else map.set(k, [v]);
  };

  interface TeacherLocationMatch {
    label: string;
    key: string;
    x: number;
    y: number;
    routeTarget?: MapPoint;
    roomId?: string;
    buildingId?: string;
    landmarkId?: string;
    spotId?: string;
  }

  const resolveTeacherRoomString = (rawRoom: string): TeacherLocationMatch | null => {
    const norm = normalizeRoomCode(rawRoom);
    const room = roomsByNorm.get(norm);
    if (room) {
      return {
        label: room.label,
        key: `room:${room.id}`,
        x: room.x,
        y: room.y,
        roomId: room.id,
        buildingId: room.building,
      };
    }
    const special = TEACHER_SPECIAL_LOCATION[rawRoom.trim().toUpperCase()];
    if (special) {
      if (special.kind === 'landmark') {
        const lm = landmarksById.get(special.id);
        if (lm) {
          const entId = LANDMARK_ENTRANCE_SPOT[lm.id];
          const ent = entId ? spotsById.get(entId) : undefined;
          return {
            label: lm.label,
            key: `landmark:${lm.id}`,
            x: lm.x,
            y: lm.y,
            routeTarget: ent ? { x: ent.x, y: ent.y } : undefined,
            landmarkId: lm.id,
          };
        }
      } else {
        const sp = spotsById.get(special.id);
        if (sp) {
          return {
            label: sp.label,
            key: `spot:${sp.id}`,
            x: sp.x,
            y: sp.y,
            spotId: sp.id,
          };
        }
      }
    }
    return null;
  };

  // Pre-associate teachers with rooms/landmarks/spots
  for (const t of teachersFile.teachers) {
    for (const rawRoom of t.rooms) {
      const m = resolveTeacherRoomString(rawRoom);
      if (!m) continue;
      if (m.roomId) pushMap(teachersByRoomId, m.roomId, t);
      if (m.landmarkId) pushMap(teachersByLandmarkId, m.landmarkId, t);
      if (m.spotId) pushMap(teachersBySpotId, m.spotId, t);
    }
  }

  const all: ResolvedDestination[] = [];
  const byKey = new Map<string, ResolvedDestination>();

  const register = (dest: ResolvedDestination) => {
    all.push(dest);
    byKey.set(dest.key, dest);
  };

  // 1. Classrooms
  for (const r of campus.rooms) {
    const bldg = campus.buildings[r.building];
    const bldgName = bldg ? bldg.name : `${r.building.toUpperCase()} building`;
    const sub = bldg ? `${bldgName} · ${bldg.note}` : bldgName;
    register({
      key: `room:${r.id}`,
      kind: 'room',
      title: r.label,
      subtitle: sub,
      badge: bldgName,
      x: r.x,
      y: r.y,
      roomId: r.id,
      buildingId: r.building,
      teachers: teachersByRoomId.get(r.id) ?? [],
    });
  }

  // 2. Landmarks
  for (const l of campus.landmarks) {
    const cleanLabel = l.label.replace(/\s*[↑↓←→]\s*$/, '');
    const entId = LANDMARK_ENTRANCE_SPOT[l.id];
    const ent = entId ? spotsById.get(entId) : undefined;
    const subtitle =
      l.id === 'dpea'
        ? 'E building · Engineering Academy courtyard entrance'
        : ent
          ? `Campus landmark · routes to ${ent.label}`
          : 'Campus landmark';
    register({
      key: `landmark:${l.id}`,
      kind: 'landmark',
      title: cleanLabel,
      subtitle,
      badge: 'Landmark',
      x: l.x,
      y: l.y,
      routeTarget: ent ? { x: ent.x, y: ent.y } : undefined,
      landmarkId: l.id,
      teachers: teachersByLandmarkId.get(l.id) ?? [],
    });
  }

  // 3. Named spots
  for (const s of campus.spots) {
    register({
      key: `spot:${s.id}`,
      kind: 'spot',
      title: s.label,
      subtitle: s.sub || 'Campus spot',
      badge: s.id.startsWith('rr-') ? 'Restrooms' : 'Campus Spot',
      x: s.x,
      y: s.y,
      spotId: s.id,
      teachers: teachersBySpotId.get(s.id) ?? [],
    });
  }

  // 4. Buildings (centered on the centroid of their rooms, or their `at` landmark)
  for (const [bId, bInfo] of Object.entries(campus.buildings)) {
    const bRooms = campus.rooms.filter((r) => r.building === bId);
    let bx = 500;
    let by = 500;
    let routeTarget: MapPoint | undefined;
    if (bInfo.at && landmarksById.has(bInfo.at)) {
      const lm = landmarksById.get(bInfo.at)!;
      bx = lm.x;
      by = lm.y;
      const entId = LANDMARK_ENTRANCE_SPOT[lm.id];
      const ent = entId ? spotsById.get(entId) : undefined;
      if (ent) routeTarget = { x: ent.x, y: ent.y };
    } else if (bRooms.length > 0) {
      bx = bRooms.reduce((acc, r) => acc + r.x, 0) / bRooms.length;
      by = bRooms.reduce((acc, r) => acc + r.y, 0) / bRooms.length;
    }
    register({
      key: `building:${bId}`,
      kind: 'building',
      title: bInfo.name,
      subtitle: bInfo.note,
      badge: 'Building',
      x: bx,
      y: by,
      routeTarget,
      buildingId: bId,
    });
  }

  // 5. Teachers
  for (const t of teachersFile.teachers) {
    const matches = t.rooms
      .map(resolveTeacherRoomString)
      .filter((m): m is TeacherLocationMatch => m !== null);
    if (matches.length === 0) continue;
    const primary = matches[0];
    const roomSummary = matches.map((m) => m.label).join(', ');
    const deptSummary = t.departments.join(' · ');
    const slug = slugify(t.sortName || t.name);
    register({
      key: `teacher:${slug}`,
      kind: 'teacher',
      title: t.name,
      subtitle: `${roomSummary} · ${deptSummary}`,
      badge: primary.label,
      x: primary.x,
      y: primary.y,
      routeTarget: primary.routeTarget,
      roomId: primary.roomId,
      buildingId: primary.buildingId,
      landmarkId: primary.landmarkId,
      spotId: primary.spotId,
      teacher: t,
      teachers: [t],
      alternateRooms:
        matches.length > 1
          ? matches.map((m) => ({ label: m.label, key: m.key, x: m.x, y: m.y }))
          : undefined,
    });
  }

  const resolveParam = (param: string | null): ResolvedDestination | null => {
    if (!param) return null;
    const trimmed = param.trim();
    if (!trimmed) return null;
    if (byKey.has(trimmed)) return byKey.get(trimmed)!;

    const lower = trimmed.toLowerCase();
    // Try case-insensitive key match
    for (const [k, v] of byKey.entries()) {
      if (k.toLowerCase() === lower) return v;
    }
    // Try room code shorthand (e.g. "?to=H-27" or "?to=h27")
    const rm = roomsByNorm.get(normalizeRoomCode(trimmed));
    if (rm) return byKey.get(`room:${rm.id}`) ?? null;
    // Try spot/landmark/building id shorthand (e.g. "?to=pool" or "?to=stafflounge")
    for (const prefix of ['landmark:', 'spot:', 'building:', 'teacher:'] as const) {
      const hit = byKey.get(`${prefix}${lower}`);
      if (hit) return hit;
    }
    // Try slugified teacher name
    const teacherHit = byKey.get(`teacher:${slugify(trimmed)}`);
    if (teacherHit) return teacherHit;

    // Fallback: match by exact title (case-insensitive)
    for (const d of all) {
      if (d.title.toLowerCase() === lower) return d;
    }
    return null;
  };

  return {
    all,
    byKey,
    roomsByNorm,
    teachersByRoomId,
    teachersByLandmarkId,
    teachersBySpotId,
    resolveParam,
  };
}

export function destinationKindLabel(kind: DestinationKind): string {
  switch (kind) {
    case 'teacher':
      return 'Teacher';
    case 'room':
      return 'Room';
    case 'spot':
      return 'Spot';
    case 'landmark':
      return 'Landmark';
    case 'building':
      return 'Building';
  }
}
