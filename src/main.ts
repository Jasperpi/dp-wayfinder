import './styles.css';
import campusRaw from '../data/campus.json';
import walkableRaw from '../data/walkable.json';
import teachersRaw from '../data/teachers.json';
import bellRaw from '../data/bell-schedule.json';
import geometryRaw from './data/campus-geometry.json';

import type {
  BellScheduleFile,
  CampusData,
  CampusGeometry,
  MapPoint,
  ResolvedDestination,
  RouteOrigin,
  RouteResult,
  TeacherData,
  TeachersFile,
  WalkableData,
} from './types';
import { buildCatalog } from './lib/catalog';
import { CampusRouter } from './lib/router';
import { CampusSearch } from './lib/search';
import { CampusNLU } from './lib/nlu';
import { VoiceController } from './lib/voice';
import { detectRoomSignFromCanvas, type ScanCandidate } from './lib/scanner';
import { formatDistance, formatWalkTime, headingToMapRotationDeg } from './lib/geo';
import { formatMinutesOfDay, getCurrentBellStatus } from './lib/schedule';
import { DeviceLocationController, type LocationState } from './lib/location';
import { CampusMap, type MapStyleMode } from './components/CampusMap';
import {
  type AppLang,
  getSavedLang,
  localizeStep,
  localizeSummary,
  saveLang,
  tr,
} from './lib/i18n';
import {
  type MyScheduleMap,
  SCHEDULE_PERIODS,
  type SchedulePeriodKey,
  decodeScheduleParam,
  destinationAsOrigin,
  encodeScheduleParam,
  getNextScheduledStop,
  loadMySchedule,
  saveMySchedule,
} from './lib/mySchedule';

const campus = campusRaw as unknown as CampusData;
const walkable = walkableRaw as unknown as WalkableData;
const teachersFile = teachersRaw as unknown as TeachersFile;
const bellData = bellRaw as unknown as BellScheduleFile;
const geometry = geometryRaw as unknown as CampusGeometry;

const catalog = buildCatalog(campus, teachersFile);
const router = new CampusRouter(walkable, campus);
const searchEngine = new CampusSearch(catalog, campus);
const nlu = new CampusNLU(catalog, searchEngine, campus);
const voice = new VoiceController();

const ROOM_WINGS = Array.from(
  new Set(campus.rooms.map((r) => r.building.toUpperCase()).filter((w) => w !== 'EP'))
).sort();

type AppMode = 'guide' | 'map' | 'schedule';
type GuideStage = 'ask-origin' | 'ask-dest' | 'guiding';
type BrowseCategory = null | 'place' | 'restroom' | 'teacher' | 'room';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class WayfinderV2App {
  private root: HTMLElement;
  private map!: CampusMap;
  private location!: DeviceLocationController;

  // Shell DOM refs
  private guidePanel!: HTMLElement;
  private schedulePanel!: HTMLElement;
  private mapSearchInput!: HTMLInputElement;
  private mapSearchClear!: HTMLButtonElement;
  private mapSearchDropdown!: HTMLElement;
  private browseFiltersEl!: HTMLElement;
  private wingFiltersEl!: HTMLElement;
  private mapHudBanner!: HTMLElement;
  private mapSheetEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private langBtn!: HTMLButtonElement;
  private voiceBtn!: HTMLButtonElement;
  private themeBtn!: HTMLButtonElement;
  private gpsBtn!: HTMLButtonElement;
  private headingBtn!: HTMLButtonElement;

  // Camera scanner DOM refs
  private scannerModal!: HTMLElement;
  private scannerVideo!: HTMLVideoElement;
  private scannerPreview!: HTMLCanvasElement;
  private scannerResultEl!: HTMLElement;
  private scannerFileInput!: HTMLInputElement;
  private cameraStream: MediaStream | null = null;
  private scanCandidates: ScanCandidate[] = [];

  // Core application state
  private lang: AppLang = getSavedLang();
  private mySchedule: MyScheduleMap = loadMySchedule();
  private activeSchedulePeriod: SchedulePeriodKey | null = null;
  private appMode: AppMode = 'guide';
  private guideStage: GuideStage = 'ask-origin';
  private currentOrigin: RouteOrigin | null = null;
  private selectedDest: ResolvedDestination | null = null;
  private activeRoute: RouteResult | null = null;
  private activeStepIdx = -1;
  private periodFilter: string | null = null;
  private matchedTeachers: TeacherData[] | null = null;

  // Conversational state
  private assistantLead = tr(getSavedLang(), 'askOriginLead');
  private assistantBody = tr(getSavedLang(), 'askOriginBody');
  private lastUserTranscript = '';
  private originChoices: Array<{ label: string; sub: string; origin: RouteOrigin }> = [];
  private destChoices: Array<{ destination: ResolvedDestination; detail?: string }> = [];
  private stepsExpanded = true;

  // Map & Browse state
  private browseCat: BrowseCategory = null;
  private browseWing: string | null = null;
  private mapSearchHits: ReturnType<CampusSearch['search']> = [];
  private mapSheetExpanded = false;
  private pickOriginMode = false;
  private followUser = false;
  private headingUp = false;
  private lastLocState: LocationState = { status: 'idle' };
  private isOffline = false;
  private toastTimer: number | null = null;
  private typeTimer: number | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.initTheme();
    this.renderShell();
    this.initMapAndLocation();
    this.bindShellEvents();
    this.loadFromUrl();
    this.startConnectivityChecks();
    this.registerOfflineWorker();
  }

  private initTheme(): void {
    const saved = localStorage.getItem('dp-wayfinder-theme');
    if (saved === 'dark' || saved === 'light') {
      document.documentElement.dataset.theme = saved;
    } else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      document.documentElement.dataset.theme = 'dark';
    } else {
      document.documentElement.dataset.theme = 'light';
    }
  }

  private toggleTheme(): void {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('dp-wayfinder-theme', next);
    this.updateTopIcons();
    this.map.render();
  }

  private updateTopIcons(): void {
    const isDark = document.documentElement.dataset.theme === 'dark';
    this.themeBtn.setAttribute('aria-label', isDark ? 'Switch to warm cream light mode' : 'Switch to night dark mode');
    this.themeBtn.innerHTML = isDark
      ? `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`
      : `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

    this.langBtn.textContent = this.lang === 'en' ? 'ES' : 'EN';
    this.langBtn.classList.toggle('active', this.lang === 'es');
    this.langBtn.title = this.lang === 'en' ? 'Cambiar a Español' : 'Switch to English';

    this.voiceBtn.classList.toggle('active', voice.speechEnabled);
    this.voiceBtn.setAttribute('aria-label', voice.speechEnabled ? 'Mute voice guide' : 'Unmute voice guide');
    this.voiceBtn.title = voice.speechEnabled ? 'Voice guide on (tap to mute)' : 'Voice guide muted';
    this.voiceBtn.innerHTML = voice.speechEnabled
      ? `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`
      : `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;

    this.syncStaticShellLabels();
  }

  private syncStaticShellLabels(): void {
    const tGuide = document.getElementById('tab-guide');
    const tMap = document.getElementById('tab-map');
    const tSched = document.getElementById('tab-schedule');
    if (tGuide) tGuide.textContent = tr(this.lang, 'tabGuide');
    if (tMap) tMap.textContent = tr(this.lang, 'tabMap');
    if (tSched) tSched.textContent = tr(this.lang, 'tabSchedule');
    if (this.mapSearchInput) this.mapSearchInput.placeholder = tr(this.lang, 'mapSearchPlaceholder');
    const catMap: Record<string, string> = {
      place: 'places',
      restroom: 'restrooms',
      teacher: 'teachers',
      room: 'rooms',
    };
    this.browseFiltersEl?.querySelectorAll<HTMLButtonElement>('[data-cat]').forEach((b) => {
      const k = catMap[b.dataset.cat ?? ''];
      if (k) b.textContent = tr(this.lang, k);
    });
    const styleMap: Record<string, string> = {
      iso3d: 'styleIso',
      top2d: 'style2d',
      printed: 'stylePrinted',
    };
    document.querySelectorAll<HTMLButtonElement>('[data-style]').forEach((b) => {
      const k = styleMap[b.dataset.style ?? ''];
      if (k) b.textContent = tr(this.lang, k);
    });
  }

  private toggleLang(): void {
    this.lang = this.lang === 'en' ? 'es' : 'en';
    saveLang(this.lang);
    document.documentElement.lang = this.lang;
    if (this.guideStage === 'ask-origin') {
      this.assistantLead = tr(this.lang, 'askOriginLead');
      this.assistantBody = tr(this.lang, 'askOriginBody');
    } else if (this.guideStage === 'ask-dest') {
      this.assistantLead = tr(this.lang, 'askDestLead');
      this.assistantBody = tr(this.lang, 'askDestPrompt');
    } else if (this.guideStage === 'guiding' && this.activeRoute) {
      this.assistantBody = localizeSummary(this.activeRoute.summarySentence, this.lang);
    }
    this.updateTopIcons();
    this.renderGuidePanel();
    this.renderMapSheet();
    this.renderSchedulePanel();
    this.showToast(this.lang === 'es' ? 'Idioma: Español' : 'Language: English');
  }

  private renderShell(): void {
    this.root.className = 'mode-guide';
    this.root.innerHTML = `
      <header class="topbar">
        <button id="brand-reset" class="brand-btn" type="button" title="Start over">
          <span class="brand-crest">DP</span>
          <span class="brand-title">DP Wayfinder</span>
        </button>

        <nav class="mode-switch" aria-label="View mode">
          <button id="tab-guide" class="mode-tab active" type="button">Guide</button>
          <button id="tab-map" class="mode-tab" type="button">Map</button>
          <button id="tab-schedule" class="mode-tab" type="button">Schedule</button>
        </nav>

        <div class="topbar-actions">
          <button id="lang-btn" class="lang-btn" type="button">ES</button>
          <button id="voice-btn" class="icon-btn active" type="button"></button>
          <button id="theme-btn" class="icon-btn" type="button"></button>
        </div>
      </header>

      <main class="workspace">
        <section id="guide-panel" class="guide-panel" aria-live="polite"></section>
        <section id="schedule-panel" class="schedule-panel" aria-live="polite"></section>

        <section class="map-viewport" id="map-viewport">
          <div class="map-search-overlay">
            <div class="search-box-wrap">
              <div class="search-bar">
                <input
                  id="map-search-input"
                  class="search-input"
                  type="search"
                  inputmode="search"
                  autocomplete="off"
                  autocorrect="off"
                  spellcheck="false"
                  placeholder="Room (H-27), teacher, class, or place..."
                  aria-label="Search Dos Pueblos campus"
                />
                <button id="map-search-clear" class="icon-btn hidden" type="button" aria-label="Clear search">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>
              <div id="map-search-dropdown" class="search-dropdown hidden" role="listbox"></div>
            </div>
            <div id="browse-filters" class="browse-filters" aria-label="Browse campus categories">
              <button class="filter-pill" type="button" data-cat="place">Places</button>
              <button class="filter-pill" type="button" data-cat="restroom">Restrooms</button>
              <button class="filter-pill" type="button" data-cat="teacher">Teachers</button>
              <button class="filter-pill" type="button" data-cat="room">Rooms</button>
            </div>
            <div id="wing-filters" class="browse-filters hidden" aria-label="Filter rooms by building wing"></div>
          </div>

          <div class="map-style-bar" role="group" aria-label="Map style">
            <button class="style-pill active" type="button" data-style="iso3d">3D Iso</button>
            <button class="style-pill" type="button" data-style="top2d">2D</button>
            <button class="style-pill" type="button" data-style="printed">Printed</button>
          </div>

          <aside class="map-controls" aria-label="Map controls">
            <button id="compass-btn" class="map-ctrl-btn" type="button" aria-label="Reset map orientation" title="Red pointer faces North">
              <svg width="28" height="28" viewBox="0 0 36 36">
                <g id="compass-needle">
                  <polygon points="18,4 22.5,18 18,15.5 13.5,18" fill="#d43f3a"/>
                  <polygon points="18,32 22.5,18 18,20.5 13.5,18" fill="currentColor" opacity="0.34"/>
                </g>
                <circle cx="18" cy="18" r="2.2" fill="var(--surface-solid)" stroke="currentColor" stroke-width="1.2"/>
              </svg>
            </button>
            <button id="gps-btn" class="map-ctrl-btn" type="button" aria-label="Use my GPS location" title="Use my location">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7" stroke-opacity="0.45"/></svg>
            </button>
            <button id="heading-btn" class="map-ctrl-btn" type="button" aria-label="Heading-up rotation" title="Turn map to face my direction">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><polygon points="12 2 19 21 12 17 5 21 12 2"/></svg>
            </button>
            <div class="map-ctrl-group">
              <button id="zoom-in" class="map-ctrl-btn" type="button" aria-label="Zoom in">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
              </button>
              <button id="zoom-out" class="map-ctrl-btn" type="button" aria-label="Zoom out">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14"/></svg>
              </button>
              <button id="fit-btn" class="map-ctrl-btn" type="button" aria-label="Fit walk or whole campus" title="Fit walk">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
              </button>
            </div>
          </aside>

          <div id="map-hud-banner" class="map-hud-banner hidden" role="status"></div>

          <div class="map-sheet-wrap">
            <section id="map-sheet" class="map-sheet" aria-live="polite"></section>
          </div>
        </section>
      </main>

      <!-- On-device Camera Room Sign Scanner Modal -->
      <div id="scanner-modal" class="scanner-modal hidden" role="dialog" aria-modal="true" aria-label="Scan a classroom sign">
        <div class="scanner-head">
          <h2>Scan a Classroom Sign</h2>
          <button id="scanner-close" class="hero-btn" type="button" style="min-height:36px;padding:0 12px;">Close</button>
        </div>
        <div class="scanner-view">
          <video id="scanner-video" class="scanner-video" autoplay playsinline muted></video>
          <canvas id="scanner-preview" class="scanner-preview hidden"></canvas>
          <div class="scanner-reticle"><span>Center sign (e.g. H-27, S-4, GYM)</span></div>
        </div>
        <div id="scanner-result" class="scanner-result hidden"></div>
        <div class="scanner-controls">
          <button id="scanner-capture" class="hero-btn gold" type="button" style="flex:1;max-width:220px;">Snap & Detect</button>
          <button id="scanner-upload-btn" class="hero-btn" type="button">Take / Pick Photo</button>
          <input id="scanner-file" type="file" accept="image/*" capture="environment" style="display:none;" />
        </div>
      </div>

      <div id="toast" class="toast" role="status"></div>
    `;

    this.guidePanel = document.getElementById('guide-panel') as HTMLElement;
    this.schedulePanel = document.getElementById('schedule-panel') as HTMLElement;
    this.mapSearchInput = document.getElementById('map-search-input') as HTMLInputElement;
    this.mapSearchClear = document.getElementById('map-search-clear') as HTMLButtonElement;
    this.mapSearchDropdown = document.getElementById('map-search-dropdown') as HTMLElement;
    this.browseFiltersEl = document.getElementById('browse-filters') as HTMLElement;
    this.wingFiltersEl = document.getElementById('wing-filters') as HTMLElement;
    this.mapHudBanner = document.getElementById('map-hud-banner') as HTMLElement;
    this.mapSheetEl = document.getElementById('map-sheet') as HTMLElement;
    this.toastEl = document.getElementById('toast') as HTMLElement;
    this.langBtn = document.getElementById('lang-btn') as HTMLButtonElement;
    this.voiceBtn = document.getElementById('voice-btn') as HTMLButtonElement;
    this.themeBtn = document.getElementById('theme-btn') as HTMLButtonElement;
    this.gpsBtn = document.getElementById('gps-btn') as HTMLButtonElement;
    this.headingBtn = document.getElementById('heading-btn') as HTMLButtonElement;

    this.scannerModal = document.getElementById('scanner-modal') as HTMLElement;
    this.scannerVideo = document.getElementById('scanner-video') as HTMLVideoElement;
    this.scannerPreview = document.getElementById('scanner-preview') as HTMLCanvasElement;
    this.scannerResultEl = document.getElementById('scanner-result') as HTMLElement;
    this.scannerFileInput = document.getElementById('scanner-file') as HTMLInputElement;

    this.wingFiltersEl.innerHTML = ROOM_WINGS.map(
      (w) => `<button class="filter-pill" type="button" data-wing="${w}">${w} wing</button>`
    ).join('');

    this.updateTopIcons();
  }

  private initMapAndLocation(): void {
    const viewport = document.getElementById('map-viewport') as HTMLElement;
    this.map = new CampusMap({
      container: viewport,
      campus,
      geometry,
      onMapTap: (pt) => this.handleMapTap(pt),
      onEntityTap: (key) => this.handleEntityTap(key),
      onUserDrag: () => {
        this.followUser = false;
      },
    });
    this.map.setCompassNeedle(document.getElementById('compass-needle') as SVGGElement | null);

    this.location = new DeviceLocationController(campus.georeference, {
      onUpdate: (state) => this.handleLocationUpdate(state),
      onHeading: (deg) => this.handleHeadingUpdate(deg),
    });

    this.renderGuidePanel();
    this.renderMapSheet();
    this.renderSchedulePanel();
  }

  private bindShellEvents(): void {
    document.getElementById('brand-reset')?.addEventListener('click', () => this.resetFlow());
    document.getElementById('tab-guide')?.addEventListener('click', () => this.setAppMode('guide'));
    document.getElementById('tab-map')?.addEventListener('click', () => this.setAppMode('map'));
    document.getElementById('tab-schedule')?.addEventListener('click', () => this.setAppMode('schedule'));

    this.langBtn.addEventListener('click', () => this.toggleLang());
    this.themeBtn.addEventListener('click', () => this.toggleTheme());
    this.voiceBtn.addEventListener('click', () => {
      voice.speechEnabled = !voice.speechEnabled;
      if (!voice.speechEnabled) voice.stopSpeaking();
      this.updateTopIcons();
      this.showToast(voice.speechEnabled ? 'Voice guide enabled' : 'Voice guide muted');
    });

    // Map style switcher (3D Iso | 2D | Printed)
    document.querySelectorAll<HTMLButtonElement>('[data-style]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.style as MapStyleMode;
        this.setMapStyle(mode);
      });
    });

    // Map controls
    document.getElementById('zoom-in')?.addEventListener('click', () => this.map.zoomBy(1.4));
    document.getElementById('zoom-out')?.addEventListener('click', () => this.map.zoomBy(1 / 1.4));
    document.getElementById('fit-btn')?.addEventListener('click', () => {
      this.followUser = false;
      if (this.activeRoute) {
        this.fitCurrentRoute();
      } else {
        this.map.fitCampusOverview(true);
      }
    });
    document.getElementById('compass-btn')?.addEventListener('click', () => {
      this.headingUp = false;
      this.headingBtn.classList.remove('active');
      this.map.setRotation(this.map.getStyleMode() === 'iso3d' ? -22 : 0);
      this.showToast('Map orientation reset');
    });
    this.gpsBtn.addEventListener('click', () => this.requestGps());
    this.headingBtn.addEventListener('click', () => this.toggleHeadingUp());

    // Map & Browse search events
    this.mapSearchInput.addEventListener('input', () => this.refreshMapSearch());
    this.mapSearchInput.addEventListener('focus', () => this.refreshMapSearch(true));
    this.mapSearchClear.addEventListener('click', () => {
      this.mapSearchInput.value = '';
      this.browseCat = null;
      this.browseWing = null;
      this.updateBrowseFilterPills();
      this.mapSearchClear.classList.add('hidden');
      this.mapSearchDropdown.classList.add('hidden');
    });

    this.browseFiltersEl.addEventListener('click', (ev) => {
      const btn = (ev.target as Element | null)?.closest<HTMLButtonElement>('[data-cat]');
      if (!btn) return;
      const cat = btn.dataset.cat as BrowseCategory;
      this.browseCat = this.browseCat === cat ? null : cat;
      this.browseWing = null;
      this.updateBrowseFilterPills();
      this.refreshMapSearch(true);
    });

    this.wingFiltersEl.addEventListener('click', (ev) => {
      const btn = (ev.target as Element | null)?.closest<HTMLButtonElement>('[data-wing]');
      if (!btn) return;
      const w = btn.dataset.wing!;
      this.browseWing = this.browseWing === w ? null : w;
      this.updateBrowseFilterPills();
      this.refreshMapSearch(true);
    });

    document.addEventListener('pointerdown', (ev) => {
      const t = ev.target as Element | null;
      if (!t?.closest('.map-search-overlay')) {
        this.mapSearchDropdown.classList.add('hidden');
      }
    });

    // Camera Scanner Modal events
    document.getElementById('scanner-close')?.addEventListener('click', () => this.closeScanner());
    document.getElementById('scanner-capture')?.addEventListener('click', () => this.captureCameraFrame());
    document.getElementById('scanner-upload-btn')?.addEventListener('click', () => this.scannerFileInput.click());
    this.scannerFileInput.addEventListener('change', () => this.handleUploadedPhoto());

    window.addEventListener('popstate', () => this.loadFromUrl());
  }

  private setMapStyle(mode: MapStyleMode): void {
    this.map.setStyleMode(mode);
    document.querySelectorAll<HTMLButtonElement>('[data-style]').forEach((b) => {
      b.classList.toggle('active', b.dataset.style === mode);
    });
    if (this.activeRoute) {
      window.setTimeout(() => this.fitCurrentRoute(), 60);
    }
  }

  private setAppMode(mode: AppMode): void {
    this.appMode = mode;
    this.root.className = `mode-${mode}`;
    document.getElementById('tab-guide')?.classList.toggle('active', mode === 'guide');
    document.getElementById('tab-map')?.classList.toggle('active', mode === 'map');
    document.getElementById('tab-schedule')?.classList.toggle('active', mode === 'schedule');
    if (mode === 'schedule') {
      this.renderSchedulePanel();
      return;
    }
    window.setTimeout(() => {
      if (this.activeRoute) this.fitCurrentRoute();
      else if (this.currentOrigin && this.guideStage === 'ask-dest') this.map.focusOriginIsometric(this.currentOrigin);
      else this.map.fitCampusOverview(true);
    }, 60);
    this.renderMapSheet();
  }

  private resetFlow(): void {
    voice.stopSpeaking();
    voice.stopListening();
    this.currentOrigin = null;
    this.selectedDest = null;
    this.activeRoute = null;
    this.activeSchedulePeriod = null;
    this.activeStepIdx = -1;
    this.periodFilter = null;
    this.matchedTeachers = null;
    this.originChoices = [];
    this.destChoices = [];
    this.lastUserTranscript = '';
    this.guideStage = 'ask-origin';
    this.assistantLead = tr(this.lang, 'askOriginLead');
    this.assistantBody = tr(this.lang, 'askOriginBody');
    this.map.renderRoute(null);
    this.map.setOriginMarker(null);
    this.syncUrl();
    this.setAppMode('guide');
    this.renderGuidePanel();
    this.renderMapSheet();
    this.map.fitCampusOverview(true);
  }

  private loadFromUrl(): void {
    const params = new URLSearchParams(window.location.search);
    const fromParam = params.get('from');
    const toParam = params.get('to');
    const schedParam = params.get('sched');
    const langParam = params.get('lang');

    if (langParam === 'es' || langParam === 'en') {
      this.lang = langParam;
      saveLang(langParam);
      document.documentElement.lang = langParam;
      this.assistantLead = tr(this.lang, 'askOriginLead');
      this.assistantBody = tr(this.lang, 'askOriginBody');
      this.updateTopIcons();
    }

    if (schedParam) {
      const decoded = decodeScheduleParam(schedParam, catalog);
      if (Object.keys(decoded).length > 0) {
        this.mySchedule = decoded;
        saveMySchedule(decoded);
        this.renderSchedulePanel();
        if (!toParam) {
          this.setAppMode('schedule');
        }
      }
    }

    if (fromParam) {
      const sp = campus.startPoints.find((s) => s.id === fromParam);
      if (sp) {
        this.currentOrigin = {
          kind: 'start',
          id: sp.id,
          label: sp.label,
          phrase: sp.phrase,
          x: sp.x,
          y: sp.y,
        };
      } else {
        const fromDest = catalog.resolveParam(fromParam);
        if (fromDest) {
          this.currentOrigin = {
            kind: fromDest.kind === 'room' ? 'room' : 'custom',
            id: fromDest.key,
            label: fromDest.title,
            phrase: fromDest.title,
            x: fromDest.x,
            y: fromDest.y,
            roomId: fromDest.roomId,
          };
        }
      }
    }

    if (toParam) {
      const dest = catalog.resolveParam(toParam);
      if (dest) {
        if (!this.currentOrigin) {
          const front = campus.startPoints[0];
          this.currentOrigin = {
            kind: 'start',
            id: front.id,
            label: front.label,
            phrase: front.phrase,
            x: front.x,
            y: front.y,
          };
        }
        this.applyDestination(dest, { updateUrl: false, speakOut: false });
        return;
      }
    }

    this.renderGuidePanel();
    this.renderMapSheet();
  }

  private syncUrl(): void {
    const url = new URL(window.location.href);
    if (this.selectedDest) url.searchParams.set('to', this.selectedDest.key);
    else url.searchParams.delete('to');

    if (this.currentOrigin && (this.currentOrigin.kind === 'start' || this.currentOrigin.kind === 'room')) {
      url.searchParams.set('from', this.currentOrigin.id);
    } else {
      url.searchParams.delete('from');
    }
    window.history.replaceState(null, '', url.toString());
  }

  // ==================== CONVERSATIONAL GUIDE LOGIC ====================

  private setOriginAndAdvance(origin: RouteOrigin, spokenReply: string, speakOut = true): void {
    this.currentOrigin = origin;
    this.originChoices = [];
    this.destChoices = [];
    this.setPickOriginMode(false);
    this.map.setOriginMarker(origin);

    if (this.selectedDest) {
      this.computeAndShowRoute(spokenReply, speakOut);
      return;
    }

    this.guideStage = 'ask-dest';
    this.assistantLead = tr(this.lang, 'askDestLead');
    this.assistantBody =
      this.lang === 'es'
        ? `Listo — te ubiqué en ${origin.label}. ${tr(this.lang, 'askDestPrompt')}`
        : `${spokenReply} ${tr(this.lang, 'askDestPrompt')}`;
    this.renderGuidePanel(true);
    this.renderMapSheet();
    // Zoom right into a 3D isometric view of their classroom/spot!
    this.map.focusOriginIsometric(origin);
    this.syncUrl();
    if (speakOut) {
      const spoken =
        this.lang === 'es'
          ? `Listo, te ubiqué en ${origin.label}. ¿Adónde quieres ir?`
          : `${spokenReply} Where are you trying to go?`;
      voice.speak(spoken, this.lang);
    }
  }

  private applyDestination(
    dest: ResolvedDestination,
    opts: {
      reply?: string;
      matchedTeachers?: TeacherData[];
      periodFilter?: string;
      updateUrl?: boolean;
      speakOut?: boolean;
    } = {}
  ): void {
    this.selectedDest = dest;
    this.destChoices = [];
    this.matchedTeachers = opts.matchedTeachers ?? dest.teachers ?? null;
    this.periodFilter = opts.periodFilter ?? null;

    if (!this.currentOrigin) {
      // Default gracefully to Front Office if someone jumped straight to destination via map tap/browse
      const front = campus.startPoints[0];
      this.currentOrigin = {
        kind: 'start',
        id: front.id,
        label: front.label,
        phrase: front.phrase,
        x: front.x,
        y: front.y,
      };
    }

    if (opts.updateUrl !== false) this.syncUrl();
    this.computeAndShowRoute(opts.reply, opts.speakOut ?? true);
  }

  private computeAndShowRoute(leadReply?: string, speakOut = false): void {
    if (!this.currentOrigin || !this.selectedDest) return;
    this.activeRoute = router.route(this.currentOrigin, this.selectedDest);
    this.activeStepIdx = -1;
    this.guideStage = 'guiding';
    this.stepsExpanded = true;

    const destTitle =
      this.selectedDest.kind === 'teacher'
        ? `${this.selectedDest.title} (${this.selectedDest.badge})`
        : this.selectedDest.title;

    this.assistantLead = destTitle;
    const summaryText = localizeSummary(this.activeRoute.summarySentence, this.lang);
    this.assistantBody = leadReply && this.lang === 'en' ? `${leadReply} ${summaryText}` : summaryText;

    this.map.renderRoute(this.activeRoute, this.activeStepIdx);
    this.renderGuidePanel(true);
    this.renderMapSheet();
    this.fitCurrentRoute();

    if (speakOut) {
      voice.speak(this.assistantBody, this.lang);
    }
  }

  private fitCurrentRoute(): void {
    if (!this.activeRoute) return;
    if (this.appMode === 'guide') {
      this.map.fitRoute(this.activeRoute, 14, 34, 52);
    } else {
      const bottomInset = this.mapSheetExpanded ? Math.round(window.innerHeight * 0.5) : 195;
      this.map.fitRoute(this.activeRoute, bottomInset, 108, 56);
    }
  }

  private handleGuideUtterance(text: string, alternatives: string[] = []): void {
    const clean = text.trim();
    if (!clean) return;
    this.lastUserTranscript = clean;

    if (this.guideStage === 'ask-origin') {
      const res = nlu.parseOrigin(clean, alternatives);
      if (res.kind === 'resolved') {
        if (res.routeToDest) {
          this.currentOrigin = res.origin;
          this.originChoices = [];
          this.destChoices = [];
          this.setPickOriginMode(false);
          this.map.setOriginMarker(res.origin);
          this.applyDestination(res.routeToDest, {
            reply: res.routeReply ?? res.reply,
            matchedTeachers: res.matchedTeachers,
            periodFilter: res.periodFilter,
            speakOut: true,
          });
        } else {
          this.setOriginAndAdvance(res.origin, res.reply, true);
        }
      } else if (res.kind === 'disambiguate') {
        this.originChoices = res.options.map((o) => ({ label: o.label, sub: o.sub, origin: o.origin }));
        this.assistantBody = tr(this.lang, 'whichClosest');
        this.renderGuidePanel(true);
        voice.speak(this.assistantBody, this.lang);
      } else {
        this.assistantBody =
          this.lang === 'es'
            ? `No reconocí "${clean}" en el campus. Prueba un salón (como H-27 o S-4), un lugar (EPAC, Biblioteca, Gimnasio) o escanea un letrero.`
            : res.reply;
        this.renderGuidePanel(true);
        voice.speak(this.assistantBody, this.lang);
      }
      return;
    }

    // Asking or updating destination
    this.activeSchedulePeriod = null;
    const pendingOpts = this.destChoices.map((c) => c.destination);
    const res = nlu.parseDestination(
      clean,
      this.currentOrigin ? { x: this.currentOrigin.x, y: this.currentOrigin.y } : undefined,
      pendingOpts.length > 0 ? pendingOpts : undefined,
      alternatives
    );

    if (res.kind === 'resolved') {
      this.applyDestination(res.destination, {
        reply: res.reply,
        matchedTeachers: res.matchedTeachers,
        periodFilter: res.periodFilter,
        speakOut: true,
      });
    } else if (res.kind === 'disambiguate') {
      this.guideStage = 'ask-dest';
      this.destChoices = res.options;
      this.assistantLead = tr(this.lang, 'whichMean');
      this.assistantBody = res.reply;
      this.renderGuidePanel(true);
      voice.speak(res.reply, this.lang);
    } else {
      this.assistantBody =
        this.lang === 'es'
          ? `No encontré "${clean}" en el directorio de Dos Pueblos. Prueba el apellido de un maestro, un salón como H-27 o un lugar como Alberca o Baños.`
          : res.reply;
      this.renderGuidePanel(true);
      voice.speak(this.assistantBody, this.lang);
    }
  }

  private streamText(el: HTMLElement | null, fullText: string): void {
    if (!el) return;
    if (this.typeTimer !== null) {
      window.clearInterval(this.typeTimer);
      this.typeTimer = null;
    }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = fullText;
      return;
    }
    const words = fullText.split(' ');
    if (words.length <= 4) {
      el.textContent = fullText;
      return;
    }
    let idx = 2;
    el.textContent = words.slice(0, idx).join(' ');
    this.typeTimer = window.setInterval(() => {
      idx += 2;
      if (idx >= words.length) {
        el.textContent = fullText;
        if (this.typeTimer !== null) {
          window.clearInterval(this.typeTimer);
          this.typeTimer = null;
        }
      } else {
        el.textContent = words.slice(0, idx).join(' ');
      }
    }, 34);
  }

  private renderTeacherScheduleHtml(teachers: TeacherData[] | null, highlightPeriod?: string | null): string {
    if (!teachers || teachers.length === 0) return '';
    const bell = getCurrentBellStatus(bellData);
    const activeP = highlightPeriod ?? bell.activePeriodNumber;

    const rows = teachers
      .slice(0, 6)
      .map((t) => {
        const periods = Object.entries(t.periods)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([p, cls]) => {
            const hl = activeP === p;
            return `<span class="period-chip${hl ? ' highlight' : ''}"><strong>P${esc(p)}</strong>${esc(cls)}</span>`;
          })
          .join('');
        return `
          <div class="teacher-row">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;">
              <span class="teacher-name">${esc(t.name)}</span>
              <span class="teacher-dept">${esc(t.rooms.join(', '))} · ${esc(t.departments.join(', '))}</span>
            </div>
            <div class="period-chips">${periods}</div>
          </div>
        `;
      })
      .join('');

    const tag = highlightPeriod
      ? `Period ${highlightPeriod} filter`
      : bell.activePeriod
        ? `${bell.activePeriod.n} (${formatMinutesOfDay(bell.activePeriod.s)}–${formatMinutesOfDay(bell.activePeriod.e)})`
        : 'Master Schedule';

    return `
      <div class="teacher-box">
        <div class="teacher-box-head">
          <span>${teachers.length === 1 ? 'Teacher Schedule' : `Matching Teachers (${teachers.length})`}</span>
          <span>${esc(tag)}</span>
        </div>
        ${rows}
      </div>
    `;
  }

  private renderGpsFixAccordion(): string {
    if (this.lastLocState.status !== 'error') return '';
    return `
      <details class="gps-help">
        <summary>${esc(tr(this.lang, 'gpsFixSummary'))}</summary>
        <p style="margin:6px 0 0;">${esc(this.lastLocState.message)}</p>
        <ol>${this.lastLocState.fixSteps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        <p style="margin:6px 0 0;font-size:12px;">${esc(tr(this.lang, 'gpsFixFooter'))}</p>
      </details>
    `;
  }

  private renderGuidePanel(animateSentence = false): void {
    const bell = getCurrentBellStatus(bellData);
    const bellBadge = bell.activePeriod
      ? `${bell.activePeriod.n} · ${bell.minutesRemaining}m`
      : this.isOffline
        ? tr(this.lang, 'offlineTag')
        : tr(this.lang, 'privateTag');

    const crumbs: string[] = [];
    if (this.currentOrigin) {
      crumbs.push(
        `<button type="button" class="crumb-pill origin" id="crumb-origin">${esc(tr(this.lang, 'fromPrefix'))} ${esc(this.currentOrigin.label)} ✎</button>`
      );
    }
    if (this.selectedDest && this.guideStage === 'guiding') {
      crumbs.push(
        `<button type="button" class="crumb-pill dest" id="crumb-dest">${esc(tr(this.lang, 'toPrefix'))} ${esc(this.selectedDest.title)} ✎</button>`
      );
    }

    let stageContent = '';

    if (this.guideStage === 'ask-origin') {
      stageContent = `
        <div class="guide-actions">
          <button id="guide-mic-btn" class="hero-btn primary${voice.isListening ? ' listening' : ''}" type="button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
            ${esc(voice.isListening ? tr(this.lang, 'listening') : tr(this.lang, 'sayWhereIAm'))}
          </button>
          <button id="guide-scan-btn" class="hero-btn gold" type="button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            ${esc(tr(this.lang, 'scanSign'))}
          </button>
        </div>

        <form id="guide-form" class="convo-input-row">
          <input
            id="guide-text-input"
            class="convo-input"
            type="text"
            autocomplete="off"
            placeholder="${esc(tr(this.lang, 'originPlaceholder'))}"
          />
          <button class="convo-submit" type="submit">${esc(tr(this.lang, 'imHere'))}</button>
        </form>

        ${
          this.originChoices.length > 0
            ? `<div class="choice-list">${this.originChoices
                .map(
                  (c, idx) => `
                  <button type="button" class="choice-card" data-orig-choice="${idx}">
                    <div><strong>${esc(c.label)}</strong><small>${esc(c.sub)}</small></div>
                    <span class="choice-badge">${esc(tr(this.lang, 'select'))}</span>
                  </button>`
                )
                .join('')}</div>`
            : ''
        }

        <div class="chip-row" aria-label="Quick starting points">
          <button type="button" class="soft-chip" id="guide-gps-chip">${esc(tr(this.lang, 'useGps'))}</button>
          ${campus.startPoints
            .map(
              (sp) =>
                `<button type="button" class="soft-chip" data-quick-start="${sp.id}">${esc(sp.label)}</button>`
            )
            .join('')}
          <button type="button" class="soft-chip" id="guide-tap-map-chip">${esc(tr(this.lang, 'tapMap'))}</button>
        </div>
        ${this.renderGpsFixAccordion()}
      `;
    } else if (this.guideStage === 'ask-dest') {
      const examplePrompts =
        this.lang === 'es'
          ? ['Ingeniería, período 3, senior', 'Ms. Anderson', 'H-27', 'Baño más cercano', 'Alberca', 'EPAC']
          : ['Engineering, 3rd period, senior', 'Ms. Anderson', 'H-27', 'Nearest restroom', 'Pool', 'Staff lounge'];
      stageContent = `
        <div class="guide-actions">
          <button id="guide-mic-btn" class="hero-btn primary${voice.isListening ? ' listening' : ''}" type="button" style="grid-column:1 / -1;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
            ${esc(voice.isListening ? tr(this.lang, 'listeningDest') : tr(this.lang, 'speakDest'))}
          </button>
        </div>

        <form id="guide-form" class="convo-input-row">
          <input
            id="guide-text-input"
            class="convo-input"
            type="text"
            autocomplete="off"
            placeholder="${esc(tr(this.lang, 'destPlaceholder'))}"
          />
          <button class="convo-submit" type="submit">${esc(tr(this.lang, 'walk'))}</button>
        </form>

        ${
          this.destChoices.length > 0
            ? `<div class="choice-list">${this.destChoices
                .map(
                  (c, idx) => `
                  <button type="button" class="choice-card" data-dest-choice="${idx}">
                    <div><strong>${esc(c.destination.title)}</strong><small>${esc(c.detail || c.destination.subtitle)}</small></div>
                    <span class="choice-badge">${esc(c.destination.badge)}</span>
                  </button>`
                )
                .join('')}</div>`
            : `<div class="chip-row" aria-label="Try asking">
                ${examplePrompts
                  .map(
                    (ex) => `<button type="button" class="soft-chip" data-example-dest="${esc(ex)}">${esc(ex)}</button>`
                  )
                  .join('')}
              </div>`
        }
      `;
    } else if (this.guideStage === 'guiding' && this.activeRoute) {
      const route = this.activeRoute;
      const liveProg =
        this.lastLocState.status === 'active' && this.lastLocState.onCampus && this.currentOrigin?.kind === 'gps'
          ? router.computeLiveProgress(this.lastLocState.point, route)
          : null;

      const walkMins = formatWalkTime(route.distanceMeters).minutes;
      const statPrimary = liveProg
        ? tr(this.lang, 'minLeft', { m: liveProg.remainingMinutes })
        : tr(this.lang, 'minWalk', { m: walkMins });
      const statSub = liveProg
        ? tr(this.lang, 'toGo', { d: formatDistance(liveProg.remainingMeters) })
        : `${formatDistance(route.distanceMeters)} · ${tr(this.lang, 'stepsCount', { n: route.steps.length })}`;

      const nextSched =
        this.activeSchedulePeriod !== null
          ? getNextScheduledStop(this.mySchedule, this.activeSchedulePeriod, catalog)
          : null;

      const stepsHtml = route.steps
        .map((s, idx) => {
          const loc = localizeStep(s, this.lang);
          return `
            <li class="step-row${idx === this.activeStepIdx ? ' active' : ''}" data-guide-step="${idx}">
              <span class="step-num${s.turn === 'start' ? ' start' : s.turn === 'arrive' ? ' arrive' : ''}">
                ${s.turn === 'start' ? '•' : s.turn === 'arrive' ? '★' : s.stepNumber}
              </span>
              <div class="step-body">
                <div class="step-text">${esc(loc.instruction)}</div>
                ${loc.detail ? `<div class="step-meta">${esc(loc.detail)}</div>` : ''}
              </div>
            </li>
          `;
        })
        .join('');

      stageContent = `
        ${
          liveProg?.isOffRoute
            ? `<div class="live-drift-pill">${esc(tr(this.lang, 'driftWarning'))}</div>`
            : ''
        }
        ${
          nextSched
            ? `<button id="guide-next-class-btn" class="next-class-btn" type="button">
                ${esc(tr(this.lang, 'schedNextClass', { p: nextSched.period, label: nextSched.destination.title }))} →
              </button>`
            : ''
        }
        <div class="route-stat-bar">
          <div class="walk-stat">
            <span class="walk-min">${esc(statPrimary)}</span>
            <span class="walk-dist">${esc(statSub)}</span>
          </div>
          <div style="display:flex;gap:6px;flex:none;">
            <button id="guide-share-btn" class="soft-chip" type="button">${esc(tr(this.lang, 'share'))}</button>
            <button id="guide-steps-toggle" class="soft-chip selected" type="button">${esc(this.stepsExpanded ? tr(this.lang, 'hideSteps') : tr(this.lang, 'steps'))}</button>
          </div>
        </div>
        ${this.stepsExpanded ? `<ol class="steps-list">${stepsHtml}</ol>` : ''}
        ${this.renderTeacherScheduleHtml(this.matchedTeachers, this.periodFilter)}
        <div class="privacy-note">${esc(tr(this.lang, 'privacyNote'))}</div>
      `;
    }

    this.guidePanel.innerHTML = `
      <div class="guide-inner">
        <div class="convo-eyebrow">
          <span>Dos Pueblos High School</span>
          <span>${esc(bellBadge)}</span>
        </div>
        ${crumbs.length ? `<div class="convo-crumbs">${crumbs.join('')}</div>` : ''}
        <h1 class="convo-headline">${esc(this.assistantLead)}</h1>
        ${this.lastUserTranscript ? `<div class="user-echo">“${esc(this.lastUserTranscript)}”</div>` : ''}
        <p class="convo-sentence" id="convo-sentence-el">${esc(this.assistantBody)}</p>
        ${stageContent}
      </div>
    `;

    if (animateSentence) {
      this.streamText(document.getElementById('convo-sentence-el'), this.assistantBody);
    }

    this.bindGuidePanelEvents();
  }

  private bindGuidePanelEvents(): void {
    document.getElementById('crumb-origin')?.addEventListener('click', () => {
      this.guideStage = 'ask-origin';
      this.assistantLead = 'Where are you right now?';
      this.assistantBody = 'Say a room or landmark, scan a classroom sign, or pick a campus entrance.';
      this.renderGuidePanel(true);
    });

    document.getElementById('crumb-dest')?.addEventListener('click', () => {
      this.guideStage = 'ask-dest';
      this.selectedDest = null;
      this.activeRoute = null;
      this.map.renderRoute(null);
      this.assistantLead = 'Where are you trying to go?';
      this.assistantBody = 'Tell me a teacher, room number, class & period, or place.';
      this.renderGuidePanel(true);
      this.renderMapSheet();
      if (this.currentOrigin) this.map.focusOriginIsometric(this.currentOrigin);
    });

    document.getElementById('guide-mic-btn')?.addEventListener('click', () => {
      if (voice.isListening) {
        voice.stopListening();
        this.renderGuidePanel();
        return;
      }
      const inputEl = document.getElementById('guide-text-input') as HTMLInputElement | null;
      voice.startListening({
        lang: this.lang,
        onInterim: (text) => {
          this.lastUserTranscript = text;
          if (inputEl) inputEl.value = text;
          const echo = this.guidePanel.querySelector('.user-echo');
          if (echo) echo.textContent = `“${text}”`;
        },
        onFinal: (text, alternatives) => {
          this.handleGuideUtterance(text, alternatives);
        },
        onEnd: () => {
          const btn = document.getElementById('guide-mic-btn');
          if (btn) {
            btn.classList.remove('listening');
            const label =
              this.guideStage === 'ask-origin'
                ? tr(this.lang, 'sayWhereIAm')
                : tr(this.lang, 'speakDest');
            const svg = btn.querySelector('svg');
            btn.innerHTML = `${svg ? svg.outerHTML : ''} ${esc(label)}`;
          }
        },
        onError: (msg) => {
          this.showToast(msg);
          this.renderGuidePanel();
        },
      });
      this.renderGuidePanel();
    });

    document.getElementById('guide-scan-btn')?.addEventListener('click', () => this.openScanner());

    document.getElementById('guide-form')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const inp = document.getElementById('guide-text-input') as HTMLInputElement | null;
      if (inp && inp.value.trim()) {
        this.handleGuideUtterance(inp.value.trim());
      }
    });

    document.getElementById('guide-gps-chip')?.addEventListener('click', () => this.requestGps());

    document.getElementById('guide-tap-map-chip')?.addEventListener('click', () => {
      this.setPickOriginMode(true);
    });

    this.guidePanel.querySelectorAll<HTMLButtonElement>('[data-quick-start]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sp = campus.startPoints.find((s) => s.id === btn.dataset.quickStart);
        if (!sp) return;
        this.lastUserTranscript = sp.label;
        this.setOriginAndAdvance(
          {
            kind: 'start',
            id: sp.id,
            label: sp.label,
            phrase: sp.phrase,
            x: sp.x,
            y: sp.y,
          },
          `Got it — starting from ${sp.phrase}.`,
          true
        );
      });
    });

    this.guidePanel.querySelectorAll<HTMLButtonElement>('[data-orig-choice]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const c = this.originChoices[Number(btn.dataset.origChoice)];
        if (c) this.setOriginAndAdvance(c.origin, `Got it — pinned you at ${c.label}.`, true);
      });
    });

    this.guidePanel.querySelectorAll<HTMLButtonElement>('[data-example-dest]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.handleGuideUtterance(btn.dataset.exampleDest!);
      });
    });

    this.guidePanel.querySelectorAll<HTMLButtonElement>('[data-dest-choice]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const c = this.destChoices[Number(btn.dataset.destChoice)];
        if (c) {
          this.applyDestination(c.destination, {
            reply: `Heading to ${c.destination.title} (${c.destination.badge}).`,
            matchedTeachers: c.destination.teachers,
            speakOut: true,
          });
        }
      });
    });

    document.getElementById('guide-share-btn')?.addEventListener('click', () => this.shareDestination());
    document.getElementById('guide-next-class-btn')?.addEventListener('click', () => this.advanceToNextScheduledClass());
    document.getElementById('guide-steps-toggle')?.addEventListener('click', () => {
      this.stepsExpanded = !this.stepsExpanded;
      this.renderGuidePanel();
    });

    this.guidePanel.querySelectorAll<HTMLLIElement>('[data-guide-step]').forEach((li) => {
      li.addEventListener('click', () => {
        const idx = Number(li.dataset.guideStep);
        this.focusRouteStep(idx);
      });
    });
  }

  // ==================== BACK-TO-SCHOOL NIGHT "MY SCHEDULE" MODE ====================

  private renderSchedulePanel(): void {
    const bell = getCurrentBellStatus(bellData);
    const firstStop = getNextScheduledStop(this.mySchedule, null, catalog);
    const hasAny = firstStop !== null;

    const rowsHtml = SCHEDULE_PERIODS.map((p) => {
      const entry = this.mySchedule[p];
      const dest = entry ? catalog.byKey.get(entry.destKey) : undefined;
      const isLivePeriod = bell.activePeriodNumber === p;
      const courseLabel = entry?.note || dest?.teacher?.periods[p] || '';

      return `
        <div class="sched-card${isLivePeriod ? ' active-bell' : ''}">
          <div class="sched-card-top">
            <span class="sched-period-pill">${esc(tr(this.lang, 'schedPeriodLabel', { p }))}${isLivePeriod ? ' · NOW' : ''}</span>
            ${
              dest
                ? `<button type="button" class="soft-chip" data-sched-remove="${p}" style="height:26px;font-size:11px;">✕</button>`
                : ''
            }
          </div>
          ${
            dest
              ? `<div class="sched-assigned">
                  <div>
                    <strong>${esc(dest.title)}${dest.kind === 'teacher' ? ` (${esc(dest.badge)})` : ''}</strong>
                    <small>${esc(courseLabel ? `${courseLabel} · ${dest.subtitle}` : dest.subtitle)}</small>
                  </div>
                  <button type="button" class="hero-btn primary" data-sched-walk="${p}" style="min-height:38px;padding:0 14px;font-size:13px;">
                    ${esc(tr(this.lang, 'schedWalkHere'))} →
                  </button>
                </div>`
              : `<form class="sched-form" data-sched-form="${p}">
                  <input class="sched-input" type="text" placeholder="${esc(tr(this.lang, 'schedPlaceholder'))}" autocomplete="off" />
                  <button class="convo-submit" type="submit">${esc(tr(this.lang, 'schedSet'))}</button>
                </form>`
          }
        </div>
      `;
    }).join('');

    this.schedulePanel.innerHTML = `
      <div class="sched-inner">
        <div class="convo-eyebrow">
          <span>Dos Pueblos High School</span>
          <span>${esc(bell.scheduleName)}</span>
        </div>
        <h1 class="convo-headline">${esc(tr(this.lang, 'schedTitle'))}</h1>
        <p class="convo-sentence">${esc(tr(this.lang, 'schedSubtitle'))}</p>

        <div class="sched-actions">
          ${
            hasAny
              ? `<button id="sched-start-tour" class="hero-btn gold" type="button" style="flex:1;">
                  ${esc(tr(this.lang, 'schedStartTour'))} (${esc(firstStop.destination.title)})
                </button>
                <button id="sched-share-btn" class="hero-btn" type="button">${esc(tr(this.lang, 'schedShare'))}</button>
                <button id="sched-clear-btn" class="hero-btn" type="button">${esc(tr(this.lang, 'schedClear'))}</button>`
              : `<div style="font-size:13px;color:var(--ink-muted);">${esc(tr(this.lang, 'schedEmptyPrompt'))}</div>`
          }
        </div>

        <div class="sched-list">${rowsHtml}</div>
      </div>
    `;

    document.getElementById('sched-start-tour')?.addEventListener('click', () => {
      if (firstStop) this.walkToScheduledPeriod(firstStop.period, false);
    });

    document.getElementById('sched-share-btn')?.addEventListener('click', async () => {
      const encoded = encodeScheduleParam(this.mySchedule);
      if (!encoded) return;
      const url = new URL(window.location.href);
      url.searchParams.delete('to');
      url.searchParams.set('sched', encoded);
      if (this.lang === 'es') url.searchParams.set('lang', 'es');
      const link = url.toString();
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Dos Pueblos Class Schedule', url: link });
          return;
        } catch {
          // fall through to clipboard
        }
      }
      try {
        await navigator.clipboard.writeText(link);
        this.showToast(tr(this.lang, 'schedCopied'));
      } catch {
        window.history.replaceState(null, '', link);
        this.showToast(tr(this.lang, 'schedCopied'));
      }
    });

    document.getElementById('sched-clear-btn')?.addEventListener('click', () => {
      this.mySchedule = {};
      this.activeSchedulePeriod = null;
      saveMySchedule(this.mySchedule);
      this.renderSchedulePanel();
    });

    this.schedulePanel.querySelectorAll<HTMLFormElement>('[data-sched-form]').forEach((form) => {
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const p = form.dataset.schedForm as SchedulePeriodKey;
        const inp = form.querySelector('input');
        const q = inp?.value.trim() ?? '';
        if (!q) return;
        const parsed = nlu.parseDestination(`${q} period ${p}`);
        let dest: ResolvedDestination | null = null;
        if (parsed.kind === 'resolved') dest = parsed.destination;
        else if (parsed.kind === 'disambiguate' && parsed.options[0]) dest = parsed.options[0].destination;
        else {
          const hits = searchEngine.search(q, { limit: 1 });
          if (hits[0]) dest = hits[0].destination;
        }
        if (!dest) {
          this.showToast(tr(this.lang, 'schedNotFound', { q }));
          return;
        }
        this.mySchedule[p] = {
          period: p,
          destKey: dest.key,
          note: dest.teacher?.periods[p],
        };
        saveMySchedule(this.mySchedule);
        this.renderSchedulePanel();
        this.showToast(tr(this.lang, 'schedSaved', { p, label: dest.title }));
      });
    });

    this.schedulePanel.querySelectorAll<HTMLButtonElement>('[data-sched-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = btn.dataset.schedRemove as SchedulePeriodKey;
        delete this.mySchedule[p];
        if (this.activeSchedulePeriod === p) this.activeSchedulePeriod = null;
        saveMySchedule(this.mySchedule);
        this.renderSchedulePanel();
      });
    });

    this.schedulePanel.querySelectorAll<HTMLButtonElement>('[data-sched-walk]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = btn.dataset.schedWalk as SchedulePeriodKey;
        this.walkToScheduledPeriod(p, false);
      });
    });
  }

  private walkToScheduledPeriod(period: SchedulePeriodKey, chainFromCurrentDest: boolean): void {
    const entry = this.mySchedule[period];
    if (!entry) return;
    const dest = catalog.byKey.get(entry.destKey);
    if (!dest) return;

    if (chainFromCurrentDest && this.selectedDest) {
      this.currentOrigin = destinationAsOrigin(this.selectedDest);
      this.map.setOriginMarker(this.currentOrigin);
    }

    this.activeSchedulePeriod = period;
    this.lastUserTranscript = `${tr(this.lang, 'schedPeriodLabel', { p: period })}: ${dest.title}`;
    this.setAppMode('guide');
    this.applyDestination(dest, {
      reply: `Period ${period} — ${dest.title}.`,
      matchedTeachers: dest.teachers,
      periodFilter: period,
      speakOut: true,
    });
  }

  private advanceToNextScheduledClass(): void {
    const next = getNextScheduledStop(this.mySchedule, this.activeSchedulePeriod, catalog);
    if (!next) return;
    this.walkToScheduledPeriod(next.period, true);
  }

  private focusRouteStep(idx: number): void {
    if (!this.activeRoute || !this.activeRoute.steps[idx]) return;
    this.activeStepIdx = this.activeStepIdx === idx ? -1 : idx;
    this.map.renderRoute(this.activeRoute, this.activeStepIdx);
    if (this.activeStepIdx >= 0) {
      const step = this.activeRoute.steps[idx];
      this.map.focusPoint(step.point, 2.35, this.appMode === 'map' ? 180 : 0);
      voice.speak(localizeStep(step, this.lang).instruction, this.lang);
    } else {
      this.fitCurrentRoute();
    }
    this.renderGuidePanel();
    this.renderMapSheet();
  }

  // ==================== CAMERA ROOM SIGN SCANNER ====================

  private async openScanner(): Promise<void> {
    this.scannerModal.classList.remove('hidden');
    this.scannerResultEl.classList.add('hidden');
    this.scannerPreview.classList.add('hidden');
    this.scannerVideo.classList.remove('hidden');
    this.scanCandidates = [];

    if (navigator.mediaDevices?.getUserMedia) {
      try {
        this.cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        this.scannerVideo.srcObject = this.cameraStream;
        await this.scannerVideo.play();
      } catch {
        this.scannerResultEl.classList.remove('hidden');
        this.scannerResultEl.innerHTML = `<div style="font-size:13.5px;">Live camera unavailable here — tap <strong>Take / Pick Photo</strong> below to scan a room sign photo instead.</div>`;
      }
    } else {
      this.scannerResultEl.classList.remove('hidden');
      this.scannerResultEl.innerHTML = `<div style="font-size:13.5px;">Tap <strong>Take / Pick Photo</strong> below to snap a classroom number sign.</div>`;
    }
  }

  private closeScanner(): void {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach((t) => t.stop());
      this.cameraStream = null;
    }
    this.scannerVideo.srcObject = null;
    this.scannerModal.classList.add('hidden');
  }

  private async captureCameraFrame(): Promise<void> {
    if (!this.scannerVideo.videoWidth) {
      this.scannerFileInput.click();
      return;
    }
    const vw = this.scannerVideo.videoWidth;
    const vh = this.scannerVideo.videoHeight;
    // Crop center reticle plaque region
    const cropW = Math.round(vw * 0.68);
    const cropH = Math.round(vh * 0.34);
    const sx = Math.round((vw - cropW) / 2);
    const sy = Math.round((vh - cropH) / 2);

    this.scannerPreview.width = 320;
    this.scannerPreview.height = 160;
    const ctx = this.scannerPreview.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(this.scannerVideo, sx, sy, cropW, cropH, 0, 0, 320, 160);
    this.scannerVideo.classList.add('hidden');
    this.scannerPreview.classList.remove('hidden');
    await this.runOcrOnPreviewCanvas();
  }

  private async handleUploadedPhoto(): Promise<void> {
    const file = this.scannerFileInput.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      URL.revokeObjectURL(url);
      this.scannerPreview.width = 320;
      this.scannerPreview.height = 160;
      const ctx = this.scannerPreview.getContext('2d');
      if (!ctx) return;
      // Cover-crop center region
      const aspect = img.width / img.height;
      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (aspect > 2) {
        sw = img.height * 2;
        sx = (img.width - sw) / 2;
      } else {
        sh = img.width / 2;
        sy = (img.height - sh) / 2;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 320, 160);
      this.scannerVideo.classList.add('hidden');
      this.scannerPreview.classList.remove('hidden');
      await this.runOcrOnPreviewCanvas();
    };
    img.src = url;
    this.scannerFileInput.value = '';
  }

  private async runOcrOnPreviewCanvas(): Promise<void> {
    this.scannerResultEl.classList.remove('hidden');
    this.scannerResultEl.innerHTML = `<div>Reading sign on device...</div>`;
    this.scanCandidates = await detectRoomSignFromCanvas(this.scannerPreview, catalog);

    if (this.scanCandidates.length > 0) {
      const top = this.scanCandidates[0];
      const others = this.scanCandidates.slice(1);
      this.scannerResultEl.innerHTML = `
        <div style="font-size:14.5px;font-weight:800;">Detected <span style="color:#ffd978;">${esc(top.destination.title)}</span> (${esc(top.destination.subtitle)})</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="hero-btn gold" data-scan-pick="0" style="flex:1;">Yes, I’m at ${esc(top.destination.title)}</button>
          <button type="button" class="hero-btn" id="scanner-retake">Retake</button>
        </div>
        ${
          others.length > 0
            ? `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                <span style="font-size:12px;opacity:.75;">Or did you mean:</span>
                ${others
                  .map(
                    (o, i) =>
                      `<button type="button" class="soft-chip" data-scan-pick="${i + 1}">${esc(o.destination.title)}</button>`
                  )
                  .join('')}
              </div>`
            : ''
        }
      `;
    } else {
      this.scannerResultEl.innerHTML = `
        <div style="font-size:13.5px;">Couldn’t read the room number clearly (glare or angle can make signs tricky). Retake closer or type the number right here:</div>
        <form id="scanner-manual-form" class="convo-input-row" style="background:rgba(255,255,255,0.12);border-color:rgba(255,255,255,0.28);">
          <input id="scanner-manual-input" class="convo-input" style="color:#fff;" placeholder="Type room (e.g. H-27, S-4)..." />
          <button class="convo-submit" type="submit" style="background:#efb834;color:#14223b;">Set</button>
        </form>
        <button type="button" class="hero-btn" id="scanner-retake">Try photo again</button>
      `;
    }

    this.scannerResultEl.querySelectorAll<HTMLButtonElement>('[data-scan-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const picked = this.scanCandidates[Number(btn.dataset.scanPick)];
        if (!picked) return;
        const d = picked.destination;
        this.closeScanner();
        this.lastUserTranscript = `Scanned sign: ${d.title}`;
        this.setOriginAndAdvance(
          {
            kind: 'scanned',
            id: d.key,
            label: d.title,
            phrase: d.title,
            x: d.routeTarget?.x ?? d.x,
            y: d.routeTarget?.y ?? d.y,
            roomId: d.roomId,
          },
          `Okay, I see you're right at ${d.title}.`,
          true
        );
      });
    });

    document.getElementById('scanner-retake')?.addEventListener('click', () => {
      this.scannerPreview.classList.add('hidden');
      this.scannerVideo.classList.remove('hidden');
      this.scannerResultEl.classList.add('hidden');
    });

    document.getElementById('scanner-manual-form')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const val = (document.getElementById('scanner-manual-input') as HTMLInputElement)?.value.trim();
      if (val) {
        this.closeScanner();
        this.handleGuideUtterance(val);
      }
    });
  }

  // ==================== MAP & BROWSE MODE ====================

  private updateBrowseFilterPills(): void {
    this.browseFiltersEl.querySelectorAll<HTMLButtonElement>('[data-cat]').forEach((b) => {
      b.classList.toggle('active', b.dataset.cat === this.browseCat);
    });
    const showWings = this.browseCat === 'room';
    this.wingFiltersEl.classList.toggle('hidden', !showWings);
    this.root.classList.toggle('wings-open', showWings);
    this.wingFiltersEl.querySelectorAll<HTMLButtonElement>('[data-wing]').forEach((b) => {
      b.classList.toggle('active', b.dataset.wing === this.browseWing);
    });
  }

  private refreshMapSearch(forceOpen = false): void {
    const q = this.mapSearchInput.value.trim();
    this.mapSearchClear.classList.toggle('hidden', q.length === 0 && !this.browseCat);

    if (!q && !this.browseCat) {
      if (!forceOpen) {
        this.mapSearchDropdown.classList.add('hidden');
        return;
      }
      // Show helpful top campus spots when focusing empty search
      const defaults = catalog.all.filter((d) => d.kind === 'landmark').slice(0, 10);
      this.mapSearchHits = defaults.map((destination) => ({ destination, score: 500 }));
    } else if (q) {
      let hits = searchEngine.search(q, {
        limit: 25,
        near: this.currentOrigin ? { x: this.currentOrigin.x, y: this.currentOrigin.y } : undefined,
      });
      if (this.browseCat === 'room') {
        hits = hits.filter((h) => h.destination.kind === 'room' && (!this.browseWing || h.destination.buildingId?.toUpperCase() === this.browseWing));
      } else if (this.browseCat === 'teacher') {
        hits = hits.filter((h) => h.destination.kind === 'teacher');
      } else if (this.browseCat === 'restroom') {
        hits = hits.filter((h) => Boolean(h.destination.spotId?.startsWith('rr-')));
      } else if (this.browseCat === 'place') {
        hits = hits.filter((h) => h.destination.kind === 'landmark' || h.destination.kind === 'spot');
      }
      this.mapSearchHits = hits.slice(0, 18);
    } else {
      // Category browsing with no typed text
      let items: ResolvedDestination[] = [];
      if (this.browseCat === 'restroom') {
        items = searchEngine
          .search('restrooms', {
            limit: 12,
            near: this.currentOrigin ? { x: this.currentOrigin.x, y: this.currentOrigin.y } : undefined,
          })
          .map((h) => h.destination)
          .filter((d) => Boolean(d.spotId?.startsWith('rr-')));
      } else if (this.browseCat === 'place') {
        items = catalog.all.filter(
          (d) => (d.kind === 'landmark' || d.kind === 'spot') && !d.spotId?.startsWith('rr-')
        );
      } else if (this.browseCat === 'teacher') {
        items = catalog.all
          .filter((d) => d.kind === 'teacher')
          .sort((a, b) => (a.teacher?.sortName || a.title).localeCompare(b.teacher?.sortName || b.title));
      } else if (this.browseCat === 'room') {
        items = catalog.all
          .filter(
            (d) =>
              d.kind === 'room' &&
              (!this.browseWing || d.buildingId?.toUpperCase() === this.browseWing)
          )
          .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
      }
      this.mapSearchHits = items.slice(0, 60).map((destination) => ({ destination, score: 500 }));
    }

    if (this.mapSearchHits.length === 0) {
      this.mapSearchDropdown.innerHTML = `<div style="padding:14px;text-align:center;color:var(--ink-muted);font-size:13.5px;">No match for “${esc(q)}”. Try a room like H-27, a teacher's last name, or a place.</div>`;
    } else {
      this.mapSearchDropdown.innerHTML = this.mapSearchHits
        .map(
          (h, idx) => `
          <button type="button" class="search-item" data-mhit="${idx}">
            <span class="search-badge kind-${h.destination.kind}">${esc(h.destination.badge)}</span>
            <span class="search-item-body">
              <div class="search-item-title">${esc(h.destination.title)}</div>
              <div class="search-item-sub">${esc(h.destination.subtitle)}</div>
            </span>
          </button>`
        )
        .join('');
    }
    this.mapSearchDropdown.classList.remove('hidden');

    this.mapSearchDropdown.querySelectorAll<HTMLButtonElement>('[data-mhit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const hit = this.mapSearchHits[Number(btn.dataset.mhit)];
        if (hit) {
          this.mapSearchInput.value = hit.destination.title;
          this.mapSearchDropdown.classList.add('hidden');
          this.applyDestination(hit.destination, { speakOut: false });
        }
      });
    });
  }

  private renderMapSheet(): void {
    const origLabel = this.currentOrigin ? this.currentOrigin.label : 'Front office';
    const originPillsHtml = `
      <div class="chip-row">
        <button type="button" class="soft-chip${this.currentOrigin?.kind === 'gps' ? ' selected' : ''}" data-morig="gps">My GPS</button>
        ${campus.startPoints
          .map(
            (sp) =>
              `<button type="button" class="soft-chip${this.currentOrigin?.kind === 'start' && this.currentOrigin.id === sp.id ? ' selected' : ''}" data-morig="start:${sp.id}">${esc(sp.label)}</button>`
          )
          .join('')}
        <button type="button" class="soft-chip${this.currentOrigin?.kind === 'custom' ? ' selected' : ''}" data-morig="pick">Tap map</button>
      </div>
    `;

    if (!this.activeRoute || !this.selectedDest) {
      this.mapSheetEl.innerHTML = `
        <div class="sheet-head">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <div>
              <strong style="font-size:15px;">Dos Pueblos High School</strong>
              <div style="font-size:12px;color:var(--ink-secondary);">From: <strong>${esc(origLabel)}</strong> · Tap any building or room on the 3D map</div>
            </div>
            <button type="button" class="soft-chip selected" id="sheet-open-guide">🎙️ Ask Guide</button>
          </div>
          ${originPillsHtml}
        </div>
      `;
      document.getElementById('sheet-open-guide')?.addEventListener('click', () => this.setAppMode('guide'));
      this.bindMapOriginPills();
      return;
    }

    const route = this.activeRoute;
    const dest = route.destination;
    const { minutes: walkMins } = formatWalkTime(route.distanceMeters);
    const walkLabel = tr(this.lang, 'minWalk', { m: walkMins });
    const distLabel = formatDistance(route.distanceMeters);

    const stepsHtml = route.steps
      .map((s, idx) => {
        const loc = localizeStep(s, this.lang);
        return `
        <li class="step-row${idx === this.activeStepIdx ? ' active' : ''}" data-map-step="${idx}">
          <span class="step-num${s.turn === 'start' ? ' start' : s.turn === 'arrive' ? ' arrive' : ''}">
            ${s.turn === 'start' ? '•' : s.turn === 'arrive' ? '★' : s.stepNumber}
          </span>
          <div class="step-body">
            <div class="step-text">${esc(loc.instruction)}</div>
            ${loc.detail ? `<div class="step-meta">${esc(loc.detail)}</div>` : ''}
          </div>
        </li>`;
      })
      .join('');

    this.mapSheetEl.innerHTML = `
      <div class="sheet-head">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div>
            <strong style="font-size:17px;">${esc(dest.title)}</strong>
            <div style="font-size:12.5px;color:var(--ink-secondary);">${esc(dest.subtitle)}</div>
          </div>
          <div style="display:flex;gap:4px;flex:none;">
            <button type="button" class="soft-chip" id="msheet-share">${esc(tr(this.lang, 'share'))}</button>
            <button type="button" class="soft-chip" id="msheet-clear">✕</button>
          </div>
        </div>
        <div class="route-stat-bar">
          <div class="walk-stat">
            <span class="walk-min">${esc(walkLabel)}</span>
            <span class="walk-dist">${esc(distLabel)} · ${esc(tr(this.lang, 'stepsCount', { n: route.steps.length }))}</span>
          </div>
          <button type="button" class="soft-chip selected" id="msheet-toggle">${esc(this.mapSheetExpanded ? tr(this.lang, 'hideSteps') : tr(this.lang, 'steps'))}</button>
        </div>
        ${originPillsHtml}
      </div>
      <div class="sheet-body${this.mapSheetExpanded ? '' : ' collapsed'}">
        <p class="convo-sentence" style="font-size:13.5px;">${esc(localizeSummary(route.summarySentence, this.lang))}</p>
        <ol class="steps-list">${stepsHtml}</ol>
        ${this.renderTeacherScheduleHtml(this.matchedTeachers, this.periodFilter)}
      </div>
    `;

    this.bindMapOriginPills();
    document.getElementById('msheet-share')?.addEventListener('click', () => this.shareDestination());
    document.getElementById('msheet-clear')?.addEventListener('click', () => {
      this.selectedDest = null;
      this.activeRoute = null;
      this.map.renderRoute(null);
      this.syncUrl();
      this.renderMapSheet();
      this.renderGuidePanel();
    });
    document.getElementById('msheet-toggle')?.addEventListener('click', () => {
      this.mapSheetExpanded = !this.mapSheetExpanded;
      this.renderMapSheet();
      this.fitCurrentRoute();
    });
    this.mapSheetEl.querySelectorAll<HTMLLIElement>('[data-map-step]').forEach((li) => {
      li.addEventListener('click', () => this.focusRouteStep(Number(li.dataset.mapStep)));
    });
  }

  private bindMapOriginPills(): void {
    this.mapSheetEl.querySelectorAll<HTMLButtonElement>('[data-morig]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.morig!;
        if (val === 'gps') {
          this.requestGps();
        } else if (val === 'pick') {
          this.setPickOriginMode(!this.pickOriginMode);
        } else if (val.startsWith('start:')) {
          const sp = campus.startPoints.find((s) => s.id === val.slice(6));
          if (sp) {
            this.currentOrigin = {
              kind: 'start',
              id: sp.id,
              label: sp.label,
              phrase: sp.phrase,
              x: sp.x,
              y: sp.y,
            };
            this.map.setOriginMarker(this.currentOrigin);
            this.syncUrl();
            if (this.selectedDest) this.computeAndShowRoute(undefined, false);
            else this.renderMapSheet();
          }
        }
      });
    });
  }

  // ==================== MAP INTERACTION & GPS / HEADING ====================

  private handleEntityTap(key: string): void {
    const dest = catalog.byKey.get(key);
    if (!dest) return;

    if (this.appMode === 'guide' && this.guideStage === 'ask-origin') {
      this.lastUserTranscript = dest.title;
      this.setOriginAndAdvance(
        {
          kind: dest.kind === 'room' ? 'room' : 'custom',
          id: dest.key,
          label: dest.title,
          phrase: dest.title,
          x: dest.routeTarget?.x ?? dest.x,
          y: dest.routeTarget?.y ?? dest.y,
          roomId: dest.roomId,
        },
        `Got it — I've pinned you at ${dest.title}.`,
        true
      );
      return;
    }

    this.applyDestination(dest, { speakOut: this.appMode === 'guide' });
  }

  private handleMapTap(pt: MapPoint): void {
    if (this.pickOriginMode) {
      const cell = router.snapToWalkable(pt);
      const snapped = router.cellCenter(cell.r, cell.c);
      const origin: RouteOrigin = {
        kind: 'custom',
        id: 'tapped',
        label: 'Tapped spot',
        phrase: 'your tapped spot',
        x: snapped.x,
        y: snapped.y,
      };
      this.setPickOriginMode(false);
      this.setOriginAndAdvance(origin, 'Got it — starting from the spot you tapped.', this.appMode === 'guide');
    }
  }

  private setPickOriginMode(active: boolean): void {
    this.pickOriginMode = active;
    this.map.setPickOriginMode(active);
    if (active) {
      this.showHudBanner('Tap anywhere on the 3D campus map to place yourself', 'Cancel', () =>
        this.setPickOriginMode(false)
      );
    } else if (!this.isOffline) {
      this.mapHudBanner.classList.add('hidden');
    }
  }

  private requestGps(): void {
    if (this.lastLocState.status === 'active' && this.lastLocState.onCampus) {
      this.followUser = true;
      const origin: RouteOrigin = {
        kind: 'gps',
        id: 'gps',
        label: 'My location',
        phrase: 'where you are',
        x: this.lastLocState.point.x,
        y: this.lastLocState.point.y,
      };
      this.setOriginAndAdvance(origin, 'Found you on campus via GPS.', this.appMode === 'guide');
      return;
    }
    this.followUser = true;
    this.gpsBtn.classList.add('active');
    this.location.start();
    this.showToast('Finding your phone on campus...');
  }

  private async toggleHeadingUp(): Promise<void> {
    if (this.headingUp) {
      this.headingUp = false;
      this.headingBtn.classList.remove('active');
      this.map.setRotation(this.map.getStyleMode() === 'iso3d' ? -22 : 0);
      this.showToast('Map orientation fixed');
      return;
    }
    const ok = await this.location.enableCompass();
    if (!ok) {
      this.showToast('Compass sensor not available on this device');
      return;
    }
    this.headingUp = true;
    this.headingBtn.classList.add('active');
    if (this.location.heading !== null) this.handleHeadingUpdate(this.location.heading);
    this.showToast('Heading-up mode enabled');
  }

  private handleLocationUpdate(state: LocationState): void {
    this.lastLocState = state;
    if (state.status === 'active') {
      this.gpsBtn.classList.add('active');
      if (state.onCampus) {
        this.map.renderUserLocation(state.point, state.accuracyMeters, state.headingDeg);
        const gpsOrigin: RouteOrigin = {
          kind: 'gps',
          id: 'gps',
          label: 'My location',
          phrase: 'where you are',
          x: state.point.x,
          y: state.point.y,
        };
        const movedEnough =
          this.currentOrigin?.kind !== 'gps' ||
          Math.hypot(state.point.x - this.currentOrigin.x, state.point.y - this.currentOrigin.y) > 4;

        if (!this.currentOrigin || this.currentOrigin.kind === 'gps' || this.followUser) {
          if (this.guideStage === 'ask-origin') {
            this.setOriginAndAdvance(gpsOrigin, 'Found you on campus via GPS.', true);
          } else {
            this.currentOrigin = gpsOrigin;
            if (this.selectedDest && movedEnough) {
              this.computeAndShowRoute(undefined, false);
            }
            if (this.followUser) this.map.focusPoint(state.point, 2.2, 0);
          }
        }
      } else {
        this.map.renderUserLocation(null);
        this.followUser = false;
        this.showHudBanner(
          'You appear to be off campus — pick a starting point or scan a sign.',
          'OK',
          () => this.mapHudBanner.classList.add('hidden')
        );
      }
    } else if (state.status === 'error') {
      this.gpsBtn.classList.remove('active');
      this.followUser = false;
      this.map.renderUserLocation(null);
      this.renderGuidePanel();
      this.showHudBanner(state.message, 'OK', () => this.mapHudBanner.classList.add('hidden'));
    }
  }

  private handleHeadingUpdate(headingDeg: number): void {
    if (this.lastLocState.status === 'active' && this.lastLocState.onCampus) {
      this.map.renderUserLocation(this.lastLocState.point, this.lastLocState.accuracyMeters, headingDeg);
    }
    if (this.headingUp) {
      const rot = headingToMapRotationDeg(headingDeg, campus.georeference, campus.school.lat);
      this.map.setRotation(rot);
    }
  }

  private async shareDestination(): Promise<void> {
    if (!this.selectedDest) return;
    const shareUrl = window.location.href;
    const title = `${this.selectedDest.title} · Dos Pueblos Wayfinder`;
    if (navigator.share) {
      try {
        await navigator.share({ title, url: shareUrl });
        return;
      } catch {
        // fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      this.showToast('Share link copied');
    } catch {
      this.showToast('Link updated in address bar');
    }
  }

  private showHudBanner(text: string, btnLabel: string, onClick: () => void): void {
    this.mapHudBanner.innerHTML = `<span>${esc(text)}</span><button type="button" id="hud-banner-btn">${esc(btnLabel)}</button>`;
    this.mapHudBanner.classList.remove('hidden');
    document.getElementById('hud-banner-btn')?.addEventListener('click', onClick);
  }

  private showToast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2500);
  }

  private startConnectivityChecks(): void {
    const check = async () => {
      if (navigator.onLine === false) {
        this.isOffline = true;
        this.showHudBanner(
          'No signal — running offline from this phone. Map, search & walking directions still work.',
          'OK',
          () => this.mapHudBanner.classList.add('hidden')
        );
        this.renderGuidePanel();
        return;
      }
      this.isOffline = false;
    };
    window.addEventListener('online', check);
    window.addEventListener('offline', check);
  }

  private registerOfflineWorker(): void {
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }
}

const appRoot = document.getElementById('app');
if (appRoot) {
  new WayfinderV2App(appRoot);
}
