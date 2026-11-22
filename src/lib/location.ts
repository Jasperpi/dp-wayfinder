import type { Georeference, MapPoint } from '../types';
import { isOnCampus, latLngToMap } from './geo';

export type LocationState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | {
      status: 'active';
      point: MapPoint;
      accuracyMeters: number;
      onCampus: boolean;
      headingDeg: number | null;
    }
  | {
      status: 'error';
      code: 'denied' | 'blocked' | 'unavailable' | 'timeout' | 'unsupported';
      message: string;
      fixSteps: string[];
    };

export interface LocationCallbacks {
  onUpdate: (state: LocationState) => void;
  onHeading: (headingDeg: number) => void;
}

interface IOSDeviceOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
}

interface DeviceOrientationConstructor {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

export interface BrowserEnvInfo {
  iOS: boolean;
  android: boolean;
  inApp: boolean;
  secure: boolean;
}

export function detectBrowserEnv(): BrowserEnvInfo {
  if (typeof navigator === 'undefined') {
    return { iOS: false, android: false, inApp: false, secure: true };
  }
  const ua = navigator.userAgent || '';
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const inApp =
    /FBAN|FBAV|FB_IAB|Instagram|Snapchat|TikTok|Line\/|MicroMessenger|LinkedInApp|Pinterest|GSA\//i.test(ua) ||
    (iOS && !/\bSafari\b/.test(ua) && /AppleWebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua));
  return {
    iOS,
    android,
    inApp,
    secure: typeof window !== 'undefined' ? window.isSecureContext : true,
  };
}

export function locationFixSteps(code: string, env: BrowserEnvInfo = detectBrowserEnv()): string[] {
  if (env.inApp) {
    return env.iOS
      ? [
          'This page opened inside another app, which blocks GPS.',
          'Tap the ••• or Share icon, then choose “Open in Safari”.',
          'Tap “Use my location” again in Safari.',
        ]
      : [
          'This page opened inside another app, which blocks GPS.',
          'Tap the ⋮ menu, then choose “Open in Chrome”.',
          'Tap “Use my location” again once Chrome opens it.',
        ];
  }
  if (env.iOS) {
    return code === 'denied'
      ? [
          'Tap “aA” (or the page icon) in Safari’s address bar.',
          'Choose Website Settings → Location → Allow.',
          'If missing, open iPhone Settings → Privacy & Security → Location Services → Safari Websites → While Using the App.',
        ]
      : [
          'Open iPhone Settings → Privacy & Security → Location Services and turn it on.',
          'Scroll to Safari Websites → While Using the App.',
          'Return here and tap “Use my location” again.',
        ];
  }
  if (env.android) {
    return [
      'Tap the lock or tune icon on the left of the address bar.',
      'Tap Permissions → Location → Allow.',
      'Make sure Android Settings → Location is switched on.',
    ];
  }
  return [
    'Click the site-settings icon at the left of the address bar and set Location to Allow.',
    'Or skip GPS — scan a classroom sign, speak where you are, or tap the map.',
  ];
}

export class DeviceLocationController {
  private watchId: number | null = null;
  private geo: Georeference;
  private callbacks: LocationCallbacks;
  private lastHeading: number | null = null;
  private lastState: LocationState = { status: 'idle' };
  private orientationListening = false;
  private timeoutTimer: number | null = null;

  constructor(geo: Georeference, callbacks: LocationCallbacks) {
    this.geo = geo;
    this.callbacks = callbacks;
  }

  get state(): LocationState {
    return this.lastState;
  }

  get heading(): number | null {
    return this.lastHeading;
  }

  private emit(next: LocationState): void {
    this.lastState = next;
    this.callbacks.onUpdate(next);
  }

  start(): void {
    const env = detectBrowserEnv();
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      this.emit({
        status: 'error',
        code: 'unsupported',
        message: 'This browser does not offer GPS. Scan a room sign, tell me where you are, or tap the map.',
        fixSteps: locationFixSteps('unsupported', env),
      });
      return;
    }

    if (env.inApp) {
      this.emit({
        status: 'error',
        code: 'blocked',
        message: 'This page opened inside an in-app browser, which blocks GPS.',
        fixSteps: locationFixSteps('blocked', env),
      });
      return;
    }

    if (this.watchId !== null) return;
    this.emit({ status: 'requesting' });

    if (this.timeoutTimer !== null) window.clearTimeout(this.timeoutTimer);
    this.timeoutTimer = window.setTimeout(() => {
      if (this.lastState.status === 'requesting') {
        this.emit({
          status: 'error',
          code: 'timeout',
          message: 'Your phone has not answered yet — Location may be turned off for this browser.',
          fixSteps: locationFixSteps('timeout', env),
        });
      }
    }, 9500);

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (this.timeoutTimer !== null) {
          window.clearTimeout(this.timeoutTimer);
          this.timeoutTimer = null;
        }
        const pt = latLngToMap(
          { lat: pos.coords.latitude, lng: pos.coords.longitude },
          this.geo
        );
        const gpsHeading =
          typeof pos.coords.heading === 'number' &&
          !Number.isNaN(pos.coords.heading) &&
          (pos.coords.speed ?? 0) > 0.4
            ? ((pos.coords.heading % 360) + 360) % 360
            : null;
        if (gpsHeading !== null && this.lastHeading === null) {
          this.lastHeading = gpsHeading;
          this.callbacks.onHeading(gpsHeading);
        }
        this.emit({
          status: 'active',
          point: pt,
          accuracyMeters: pos.coords.accuracy ?? 15,
          onCampus: isOnCampus(pt),
          headingDeg: this.lastHeading ?? gpsHeading,
        });
      },
      (err) => {
        if (this.timeoutTimer !== null) {
          window.clearTimeout(this.timeoutTimer);
          this.timeoutTimer = null;
        }
        this.stopWatchOnly();
        const envNow = detectBrowserEnv();
        if (err.code === err.PERMISSION_DENIED) {
          this.emit({
            status: 'error',
            code: 'denied',
            message: 'Your phone declined location permission — you can still scan a room sign or tap the map.',
            fixSteps: locationFixSteps('denied', envNow),
          });
        } else if (err.code === err.TIMEOUT) {
          this.emit({
            status: 'error',
            code: 'timeout',
            message: 'GPS took too long to respond. Try again or pick where you are.',
            fixSteps: locationFixSteps('timeout', envNow),
          });
        } else {
          this.emit({
            status: 'error',
            code: 'unavailable',
            message: 'Could not get a GPS fix right now. Pick a starting point, scan a sign, or tap the map.',
            fixSteps: locationFixSteps('unavailable', envNow),
          });
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 4000,
        timeout: 14000,
      }
    );
  }

  async enableCompass(): Promise<boolean> {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
      return false;
    }
    const ctor = window.DeviceOrientationEvent as unknown as DeviceOrientationConstructor;
    if (typeof ctor.requestPermission === 'function') {
      try {
        const res = await ctor.requestPermission();
        if (res !== 'granted') return false;
      } catch {
        return false;
      }
    }
    if (!this.orientationListening) {
      this.orientationListening = true;
      window.addEventListener('deviceorientationabsolute', this.handleOrientation as EventListener, true);
      window.addEventListener('deviceorientation', this.handleOrientation as EventListener, true);
    }
    return true;
  }

  private handleOrientation = (ev: IOSDeviceOrientationEvent): void => {
    let heading: number | null = null;
    if (typeof ev.webkitCompassHeading === 'number' && !Number.isNaN(ev.webkitCompassHeading)) {
      heading = ev.webkitCompassHeading;
    } else if (ev.absolute && typeof ev.alpha === 'number' && !Number.isNaN(ev.alpha)) {
      heading = (360 - ev.alpha) % 360;
    } else if (typeof ev.alpha === 'number' && !Number.isNaN(ev.alpha)) {
      heading = (360 - ev.alpha) % 360;
    }
    if (heading === null) return;
    heading = ((heading % 360) + 360) % 360;

    if (this.lastHeading === null) {
      this.lastHeading = heading;
    } else {
      let delta = heading - this.lastHeading;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      if (Math.abs(delta) < 1.5) return;
      this.lastHeading = ((this.lastHeading + delta * 0.3) % 360 + 360) % 360;
    }

    this.callbacks.onHeading(this.lastHeading);
    if (this.lastState.status === 'active') {
      this.emit({ ...this.lastState, headingDeg: this.lastHeading });
    }
  };

  private stopWatchOnly(): void {
    if (this.watchId !== null && typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  stop(): void {
    if (this.timeoutTimer !== null) {
      window.clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    this.stopWatchOnly();
    if (this.orientationListening && typeof window !== 'undefined') {
      window.removeEventListener('deviceorientationabsolute', this.handleOrientation as EventListener, true);
      window.removeEventListener('deviceorientation', this.handleOrientation as EventListener, true);
      this.orientationListening = false;
    }
    this.emit({ status: 'idle' });
  }
}
