export interface CampusSchool {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export interface Georeference {
  formula: string;
  ax: number;
  ay: number;
  a0: number;
  ox: number;
  oy: number;
  o0: number;
  note: string;
}

export interface BuildingInfo {
  name: string;
  note: string;
  at?: string;
}

export interface RoomData {
  id: string;
  label: string;
  x: number;
  y: number;
  building: string;
}

export interface LandmarkData {
  id: string;
  label: string;
  x: number;
  y: number;
  keywords: string[];
}

export interface SpotData {
  id: string;
  label: string;
  sub: string;
  x: number;
  y: number;
  short?: string;
  keywords: string[];
}

export interface StartPointData {
  id: string;
  label: string;
  phrase: string;
  hint: string;
  x: number;
  y: number;
}

export interface CampusData {
  school: CampusSchool;
  map: { image: string; width: number; height: number; note: string };
  georeference: Georeference;
  buildings: Record<string, BuildingInfo>;
  rooms: RoomData[];
  landmarks: LandmarkData[];
  spots: SpotData[];
  startPoints: StartPointData[];
}

export interface WalkableData {
  cols: number;
  rows: number;
  mapUnitsPerCell: number;
  note: string;
  walkable: string[];
  core: string[];
}

export interface TeacherData {
  name: string;
  sortName: string;
  rooms: string[];
  departments: string[];
  periods: Record<string, string>;
}

export interface TeachersFile {
  note: string;
  teachers: TeacherData[];
}

export interface BellPeriod {
  s: number;
  e: number;
  n: string;
}

export interface BellSchedule {
  name: string;
  periods: BellPeriod[];
}

export interface BellScheduleFile {
  schedules: Record<string, BellSchedule>;
  dayToSchedule: Record<string, string>;
}

export interface MapPoint {
  x: number;
  y: number;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export type DestinationKind = 'room' | 'landmark' | 'spot' | 'teacher' | 'building';

export interface ResolvedDestination {
  key: string;
  kind: DestinationKind;
  title: string;
  subtitle: string;
  badge: string;
  x: number;
  y: number;
  routeTarget?: MapPoint;
  roomId?: string;
  buildingId?: string;
  landmarkId?: string;
  spotId?: string;
  teacher?: TeacherData;
  teachers?: TeacherData[];
  alternateRooms?: Array<{ label: string; key: string; x: number; y: number }>;
}

export type OriginKind = 'start' | 'gps' | 'custom' | 'room' | 'scanned';

export interface RouteOrigin {
  kind: OriginKind;
  id: string;
  label: string;
  phrase: string;
  x: number;
  y: number;
  roomId?: string;
}

export type TurnKind = 'start' | 'straight' | 'slight-left' | 'left' | 'slight-right' | 'right' | 'u-turn' | 'arrive';

export interface RouteStep {
  stepNumber: number;
  turn: TurnKind;
  instruction: string;
  detail?: string;
  distanceMeters: number;
  point: MapPoint;
  landmarkName?: string;
}

export interface RouteResult {
  origin: RouteOrigin;
  destination: ResolvedDestination;
  snappedStart: MapPoint;
  snappedEnd: MapPoint;
  gridCells: Array<{ r: number; c: number }>;
  points: MapPoint[];
  distanceMeters: number;
  walkMinutes: number;
  summarySentence: string;
  steps: RouteStep[];
}

export interface LiveProgress {
  offRouteMeters: number;
  remainingMeters: number;
  remainingMinutes: number;
  isOffRoute: boolean;
}

export interface CampusGeometry {
  width: number;
  height: number;
  courtyardPath: string;
  courtyardPolys: number[][];
  features: Array<{
    id: string;
    kind: string;
    zone: number;
    h: number;
    pts: number[];
    d: string;
    cx: number;
    cy: number;
    area: number;
    roomIds: string[];
  }>;
  subFeatures: Array<{
    kind: string;
    pts: number[];
    d: string;
    cx: number;
    cy: number;
  }>;
  rooms: Array<{
    id: string;
    label: string;
    building: string;
    h: number;
    pts: number[];
    d: string;
    cx: number;
    cy: number;
  }>;
}
