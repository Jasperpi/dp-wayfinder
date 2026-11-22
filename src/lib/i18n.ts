import type { RouteStep } from '../types';

export type AppLang = 'en' | 'es';

export function getSavedLang(): AppLang {
  try {
    const saved = localStorage.getItem('dp-wayfinder-lang');
    if (saved === 'en' || saved === 'es') return saved;
  } catch {
    // ignore storage errors in tests/private mode
  }
  return 'en';
}

export function saveLang(lang: AppLang): void {
  try {
    localStorage.setItem('dp-wayfinder-lang', lang);
  } catch {
    // ignore
  }
}

const STRINGS: Record<AppLang, Record<string, string>> = {
  en: {
    tabGuide: 'Guide',
    tabMap: 'Map',
    tabSchedule: 'Schedule',
    askOriginLead: 'Where are you right now?',
    askOriginBody: 'Tell me a classroom or building you see, snap a photo of a room sign, or use GPS.',
    askDestLead: 'And where are you trying to go?',
    askDestPrompt: 'Tell me a teacher, room number, class & period, or place.',
    sayWhereIAm: 'Say where I am',
    listening: 'Listening...',
    scanSign: 'Scan room sign',
    speakDest: 'Speak where you’re going',
    listeningDest: 'Listening — say teacher, room, or class...',
    originPlaceholder: 'Type a room (S-4, H-27) or spot...',
    destPlaceholder: 'Teacher, room (H-27), or class...',
    imHere: "I'm here",
    walk: 'Walk',
    useGps: '📍 Use my GPS',
    tapMap: '📌 Tap map',
    whichClosest: 'Which of these are you closest to?',
    whichMean: 'Which one did you mean?',
    select: 'Select',
    share: 'Share',
    steps: 'Steps',
    hideSteps: 'Hide steps',
    fromPrefix: 'From:',
    toPrefix: 'To:',
    privacyNote: 'Location stays on your phone — this page has nowhere to send it.',
    gpsFixSummary: "Location isn't working — here's the fix",
    gpsFixFooter: 'You never need GPS — scan a classroom sign, speak a room number, or tap the map.',
    driftWarning: 'You’ve drifted off the path — head back toward the blue line',
    offlineTag: 'Offline mode · On-device',
    privateTag: 'On-device · Private',
    mapSearchPlaceholder: 'Room (H-27), teacher, class, or place...',
    places: 'Places',
    restrooms: 'Restrooms',
    teachers: 'Teachers',
    rooms: 'Rooms',
    styleIso: '3D Iso',
    style2d: '2D',
    stylePrinted: 'Printed',
    askGuideBtn: '🎙️ Ask Guide',
    mapEmptyHint: 'Tap any building or room on the 3D map',
    schedTitle: 'My Class Schedule',
    schedSubtitle: 'Add Periods 1–5 once for Back-to-School Night or first day of school — tap Next Class to walk room to room.',
    schedPlaceholder: 'Room (H-27), teacher, or DPEA...',
    schedClear: 'Clear all',
    schedShare: 'Share schedule',
    schedStartTour: 'Walk to Period 1',
    schedNextClass: 'Next: Period {p} → {label}',
    schedWalkHere: 'Walk',
    schedSet: 'Save',
    schedEmptyPrompt: 'Add at least one period below to start your room-to-room walking tour.',
    schedPeriodLabel: 'Period {p}',
    schedCopied: 'Schedule link copied — text it to a parent or friend!',
    schedSaved: 'Saved Period {p}: {label}',
    schedNotFound: 'Could not match "{q}" — try a room like H-27 or teacher name.',
    scannerTitle: 'Scan a Classroom Sign',
    scannerClose: 'Close',
    scannerReticle: 'Center sign (e.g. H-27, S-4, GYM)',
    scannerSnap: 'Snap & Detect',
    scannerUpload: 'Take / Pick Photo',
    tapMapBanner: 'Tap anywhere on the 3D campus map to place yourself',
    cancel: 'Cancel',
    minWalk: '{m} min walk',
    minLeft: '{m} min left',
    toGo: '{d} to go',
    stepsCount: '{n} steps',
  },
  es: {
    tabGuide: 'Guía',
    tabMap: 'Mapa',
    tabSchedule: 'Horario',
    askOriginLead: '¿Dónde estás ahora mismo?',
    askOriginBody: 'Dime un salón o edificio que veas, escanea el letrero del salón o usa el GPS.',
    askDestLead: '¿Y adónde quieres ir?',
    askDestPrompt: 'Dime un maestro, número de salón, clase y período, o lugar.',
    sayWhereIAm: 'Di dónde estoy',
    listening: 'Escuchando...',
    scanSign: 'Escanear letrero',
    speakDest: 'Di adónde vas',
    listeningDest: 'Escuchando — di maestro, salón o clase...',
    originPlaceholder: 'Escribe un salón (S-4, H-27) o lugar...',
    destPlaceholder: 'Maestro, salón (H-27) o clase...',
    imHere: 'Estoy aquí',
    walk: 'Ir',
    useGps: '📍 Usar mi GPS',
    tapMap: '📌 Tocar mapa',
    whichClosest: '¿De cuál estás más cerca?',
    whichMean: '¿A cuál te refieres?',
    select: 'Elegir',
    share: 'Compartir',
    steps: 'Pasos',
    hideSteps: 'Ocultar',
    fromPrefix: 'Desde:',
    toPrefix: 'Hacia:',
    privacyNote: 'Tu ubicación se queda en tu teléfono — esta página no envía datos.',
    gpsFixSummary: 'La ubicación no funciona — cómo arreglarlo',
    gpsFixFooter: 'No necesitas GPS — escanea un letrero, di un salón o toca el mapa.',
    driftWarning: 'Te desviaste del camino — regresa hacia la línea azul',
    offlineTag: 'Sin señal · En tu teléfono',
    privateTag: 'En tu teléfono · Privado',
    mapSearchPlaceholder: 'Salón (H-27), maestro, clase o lugar...',
    places: 'Lugares',
    restrooms: 'Baños',
    teachers: 'Maestros',
    rooms: 'Salones',
    styleIso: '3D Iso',
    style2d: '2D',
    stylePrinted: 'Impreso',
    askGuideBtn: '🎙️ Guía de voz',
    mapEmptyHint: 'Toca cualquier edificio o salón en el mapa 3D',
    schedTitle: 'Mi Horario de Clases',
    schedSubtitle: 'Agrega los Períodos 1–5 para la Noche de Regreso a Clases — toca Siguiente Clase para caminar salón por salón.',
    schedPlaceholder: 'Salón (H-27), maestro o DPEA...',
    schedClear: 'Borrar todo',
    schedShare: 'Compartir horario',
    schedStartTour: 'Caminar al Período 1',
    schedNextClass: 'Siguiente: Período {p} → {label}',
    schedWalkHere: 'Ir',
    schedSet: 'Guardar',
    schedEmptyPrompt: 'Agrega al menos un período abajo para empezar tu recorrido salón por salón.',
    schedPeriodLabel: 'Período {p}',
    schedCopied: 'Enlace del horario copiado — ¡compártelo por mensaje!',
    schedSaved: 'Período {p} guardado: {label}',
    schedNotFound: 'No encontré "{q}" — prueba un salón como H-27 o apellido de maestro.',
    scannerTitle: 'Escanear letrero de salón',
    scannerClose: 'Cerrar',
    scannerReticle: 'Centra el letrero (ej. H-27, S-4, GYM)',
    scannerSnap: 'Tomar foto',
    scannerUpload: 'Subir / Tomar foto',
    tapMapBanner: 'Toca cualquier punto del mapa 3D para marcar tu ubicación',
    cancel: 'Cancelar',
    minWalk: '{m} min a pie',
    minLeft: 'Faltan {m} min',
    toGo: 'Faltan {d}',
    stepsCount: '{n} pasos',
  },
};

export function tr(lang: AppLang, key: string, vars?: Record<string, string | number>): string {
  let out = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return out;
}

const ES_PLACE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bthe front office\b/gi, 'la oficina principal'],
  [/\bstudent parking\b/gi, 'el estacionamiento de estudiantes'],
  [/\bthe Greek Theater\b/gi, 'el Teatro Griego (The Greek)'],
  [/\bthe Greek\b/gi, 'el Teatro Griego (The Greek)'],
  [/\bthe Cafeteria Rd lot\b/gi, 'el estacionamiento de Cafeteria Rd'],
  [/\bthe Library\b/gi, 'la Biblioteca'],
  [/\bthe Cafeteria\b/gi, 'la Cafetería'],
  [/\bthe Gym\b/gi, 'el Gimnasio'],
  [/\bthe Pool\b/gi, 'la Alberca'],
  [/\bthe Stadium\b/gi, 'el Estadio'],
  [/\bthe Engineering Academy\b/gi, 'la Academia de Ingeniería (DPEA)'],
  [/\bAdministration\b/gi, 'Administración'],
  [/\bEPAC Theater\b/gi, 'el Teatro EPAC'],
  [/\bthe Bus Loop\b/gi, 'la zona de autobuses (Bus Loop)'],
  [/\bthe Flagpole\b/gi, 'el asta bandera'],
  [/\bthe Front Desk\b/gi, 'la recepción'],
  [/\bthe Athletics Office\b/gi, 'la oficina de deportes'],
  [/\bthe ([A-Z]) building\b/gi, 'el edificio $1'],
  [/\b([A-Z]) building\b/gi, 'edificio $1'],
  [/\bwhere you are\b/gi, 'donde estás'],
  [/\byour tapped spot\b/gi, 'el punto que marcaste'],
];

function localizePlaceNames(text: string): string {
  let out = text;
  for (const [re, rep] of ES_PLACE_REPLACEMENTS) {
    out = out.replace(re, rep);
  }
  return out;
}

/**
 * Translate a generated English walking direction step cleanly into natural Spanish
 * while keeping all DP room codes & real-world left/right geometry untouched.
 */
export function localizeStep(step: RouteStep, lang: AppLang): { instruction: string; detail?: string } {
  if (lang === 'en') {
    return { instruction: step.instruction, detail: step.detail };
  }

  let inst = step.instruction;
  inst = inst
    .replace(/^You are right at /i, 'Ya estás justo en ')
    .replace(/^Head out from /i, 'Sal desde ')
    .replace(/^Turn left\b/i, 'Gira a la izquierda')
    .replace(/^Bear left\b/i, 'Mantente ligeramente a la izquierda')
    .replace(/^Turn right\b/i, 'Gira a la derecha')
    .replace(/^Bear right\b/i, 'Mantente ligeramente a la derecha')
    .replace(/^Turn around\b/i, 'Da la vuelta')
    .replace(/^Continue straight\b/i, 'Sigue derecho')
    .replace(/^Arrive at /i, 'Llegas a ')
    .replace(/, passing /g, ', pasando ')
    .replace(/, then pass /g, ' y luego pasa ')
    .replace(/ and walk past /g, ' y camina pasando ')
    .replace(/ toward /g, ' hacia ')
    .replace(/ by /g, ' junto a ')
    .replace(/ on your left/g, ' a tu izquierda')
    .replace(/ on your right/g, ' a tu derecha')
    .replace(/ ahead$/g, ' al frente');
  inst = localizePlaceNames(inst);

  let detail = step.detail;
  if (detail) {
    detail = detail
      .replace(/^Walk /i, 'Camina ')
      .replace(/^Continue /i, 'Continúa ')
      .replace(/\bft\b/g, 'pies');
  }

  return { instruction: inst, detail };
}

export function localizeSummary(summary: string, lang: AppLang): string {
  if (lang === 'en') return summary;
  let out = summary
    .replace(/^You're right at /i, 'Ya estás justo en ')
    .replace(/^You're right next to /i, 'Estás justo al lado de ')
    .replace(/^From (.+?), it's about a (\d+)-minute walk/i, 'Desde $1, son unos $2 minutos caminando')
    .replace(/, past /g, ', pasando ')
    .replace(/, then /g, ' y luego ')
    .replace(/ on your left/g, ' a tu izquierda')
    .replace(/ on your right/g, ' a tu derecha')
    .replace(/ is in the /g, ' está en ');
  return localizePlaceNames(out);
}
