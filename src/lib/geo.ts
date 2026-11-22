import type { Georeference, LatLng, MapPoint } from '../types';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Local meters-per-degree conversion at the campus latitude (WGS84 ellipsoid).
 */
export function metersPerDegree(latDeg: number): { mPerLat: number; mPerLng: number } {
  const latRad = latDeg * DEG_TO_RAD;
  const mPerLat =
    111132.954 -
    559.822 * Math.cos(2 * latRad) +
    1.175 * Math.cos(4 * latRad);
  const mPerLng =
    111412.84 * Math.cos(latRad) -
    93.5 * Math.cos(3 * latRad);
  return { mPerLat, mPerLng };
}

export function mapToLatLng(point: MapPoint, geo: Georeference): LatLng {
  return {
    lat: geo.ax * point.x + geo.ay * point.y + geo.a0,
    lng: geo.ox * point.x + geo.oy * point.y + geo.o0,
  };
}

export function latLngToMap(coord: LatLng, geo: Georeference): MapPoint {
  const det = geo.ax * geo.oy - geo.ay * geo.ox;
  if (Math.abs(det) < 1e-24) {
    throw new Error('Degenerate georeference matrix');
  }
  const dLat = coord.lat - geo.a0;
  const dLng = coord.lng - geo.o0;
  return {
    x: (geo.oy * dLat - geo.ay * dLng) / det,
    y: (-geo.ox * dLat + geo.ax * dLng) / det,
  };
}

/**
 * Convert a map-space displacement (dx, dy) into real-world (East, North) meters.
 */
export function mapDeltaToWorldMeters(
  dx: number,
  dy: number,
  geo: Georeference,
  refLat = geo.a0
): { east: number; north: number; meters: number } {
  const { mPerLat, mPerLng } = metersPerDegree(refLat);
  const dLat = geo.ax * dx + geo.ay * dy;
  const dLng = geo.ox * dx + geo.oy * dy;
  const north = dLat * mPerLat;
  const east = dLng * mPerLng;
  return { east, north, meters: Math.hypot(east, north) };
}

export function distanceMetersBetween(
  a: MapPoint,
  b: MapPoint,
  geo: Georeference,
  refLat = geo.a0
): number {
  return mapDeltaToWorldMeters(b.x - a.x, b.y - a.y, geo, refLat).meters;
}

/**
 * Real-world signed turn angle in degrees when walking along segment (a -> b) then (b -> c).
 * Computed directly in real-world (East, North) meters so left/right is guaranteed to match reality:
 *   positive (+1°..+180°) = turn LEFT
 *   negative (-1°..-180°) = turn RIGHT
 *   0° = straight ahead
 */
export function realWorldTurnDegrees(
  a: MapPoint,
  b: MapPoint,
  c: MapPoint,
  geo: Georeference,
  refLat = geo.a0
): number {
  const u = mapDeltaToWorldMeters(b.x - a.x, b.y - a.y, geo, refLat);
  const v = mapDeltaToWorldMeters(c.x - b.x, c.y - b.y, geo, refLat);
  if (u.meters < 1e-6 || v.meters < 1e-6) return 0;
  // Standard right-handed (East = +X, North = +Y) viewed from above:
  // CCW (left turn) has positive cross product u.east * v.north - u.north * v.east.
  const cross = u.east * v.north - u.north * v.east;
  const dot = u.east * v.east + u.north * v.north;
  return Math.atan2(cross, dot) * RAD_TO_DEG;
}

/**
 * Determine which side of a walking segment (a -> b) a landmark point `p` sits on in the real world.
 * Returns 'left' | 'right' | 'ahead' along with perpendicular distance in meters and forward projection fraction.
 */
export function realWorldLandmarkRelation(
  a: MapPoint,
  b: MapPoint,
  p: MapPoint,
  geo: Georeference,
  refLat = geo.a0
): { side: 'left' | 'right' | 'ahead'; perpMeters: number; alongFraction: number; distMeters: number } {
  const u = mapDeltaToWorldMeters(b.x - a.x, b.y - a.y, geo, refLat);
  const w = mapDeltaToWorldMeters(p.x - a.x, p.y - a.y, geo, refLat);
  if (u.meters < 1e-6) {
    return { side: 'ahead', perpMeters: w.meters, alongFraction: 0, distMeters: w.meters };
  }
  const cross = u.east * w.north - u.north * w.east;
  const dot = u.east * w.east + u.north * w.north;
  const perpSigned = cross / u.meters; // > 0 means left, < 0 means right
  const alongFraction = dot / (u.meters * u.meters);
  const clampedT = Math.max(0, Math.min(1, alongFraction));
  const closestE = u.east * clampedT;
  const closestN = u.north * clampedT;
  const distMeters = Math.hypot(w.east - closestE, w.north - closestN);
  const side: 'left' | 'right' | 'ahead' =
    Math.abs(perpSigned) < 2.5 ? 'ahead' : perpSigned > 0 ? 'left' : 'right';
  return {
    side,
    perpMeters: Math.abs(perpSigned),
    alongFraction,
    distMeters,
  };
}

/**
 * Real-world compass bearing (degrees clockwise from North: 0=N, 90=E, 180=S, 270=W)
 * corresponding to a displacement vector (dx, dy) in map coordinates.
 */
export function mapVectorToCompassBearing(
  dx: number,
  dy: number,
  geo: Georeference,
  refLat = geo.a0
): number {
  const { east, north } = mapDeltaToWorldMeters(dx, dy, geo, refLat);
  return ((Math.atan2(east, north) * RAD_TO_DEG) + 360) % 360;
}

/**
 * Screen-up compass bearing when map rotation is 0 degrees.
 * Screen-up is map vector (0, -1). On DP's map, (0, -1) points due East (~90°).
 */
export function mapUpCompassBearing(geo: Georeference, refLat = geo.a0): number {
  return mapVectorToCompassBearing(0, -1, geo, refLat);
}

/**
 * Map SVG clockwise rotation (degrees) needed so that a real-world compass heading
 * `headingDeg` (0=N, 90=E, 180=S, 270=W) points straight up on the phone screen.
 */
export function headingToMapRotationDeg(
  headingDeg: number,
  geo: Georeference,
  refLat = geo.a0
): number {
  const upBearing = mapUpCompassBearing(geo, refLat);
  // Rotating the map clockwise by delta moves a bearing of (upBearing - delta) to screen-up.
  // So we want upBearing - delta ≡ headingDeg (mod 360) => delta = upBearing - headingDeg.
  let deg = (upBearing - headingDeg) % 360;
  if (deg > 180) deg -= 360;
  if (deg < -180) deg += 360;
  return deg;
}

/**
 * Check whether a map point is within the campus bounds (with a modest perimeter buffer).
 */
export function isOnCampus(point: MapPoint, margin = 60): boolean {
  return (
    point.x >= -margin &&
    point.x <= 1000 + margin &&
    point.y >= -margin &&
    point.y <= 875 + margin
  );
}

export function formatDistance(meters: number): string {
  const feet = Math.round(meters * 3.28084);
  if (feet < 50) {
    return `${Math.max(10, Math.round(feet / 5) * 5)} ft`;
  }
  if (feet < 1000) {
    return `${Math.round(feet / 10) * 10} ft`;
  }
  const miles = meters / 1609.344;
  return `${miles.toFixed(2)} mi`;
}

export function formatWalkTime(meters: number): { minutes: number; label: string } {
  // Comfortable campus walking speed ~1.30 m/s (~2.9 mph)
  const rawMin = meters / (1.3 * 60);
  const minutes = Math.max(1, Math.round(rawMin));
  return {
    minutes,
    label: rawMin < 0.75 ? '< 1 min walk' : `${minutes} min walk`,
  };
}
