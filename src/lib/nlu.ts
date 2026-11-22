import type {
  CampusData,
  MapPoint,
  ResolvedDestination,
  RouteOrigin,
  TeacherData,
} from '../types';
import type { CampusCatalog } from './catalog';
import {
  CampusSearch,
  EXTRA_CAMPUS_ALIASES,
  damerauLevenshtein,
  expandContractions,
  normalizeText,
} from './search';

export type LocationParseResult =
  | {
      kind: 'resolved';
      origin: RouteOrigin;
      destination?: ResolvedDestination;
      /** Populated when the user spoke BOTH origin & destination in one sentence ("I'm at the EPAC, take me to H-27") */
      routeToDest?: ResolvedDestination;
      routeReply?: string;
      matchedTeachers?: TeacherData[];
      periodFilter?: string;
      reply: string;
    }
  | {
      kind: 'disambiguate';
      prompt: string;
      options: Array<{ label: string; sub: string; origin: RouteOrigin; destination?: ResolvedDestination }>;
    }
  | {
      kind: 'unclear';
      reply: string;
    };

export type DestinationParseResult =
  | {
      kind: 'resolved';
      destination: ResolvedDestination;
      reply: string;
      matchedTeachers?: TeacherData[];
      periodFilter?: string;
    }
  | {
      kind: 'disambiguate';
      reply: string;
      options: Array<{ destination: ResolvedDestination; detail?: string }>;
    }
  | {
      kind: 'unclear';
      reply: string;
    };

const PERIOD_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:period\s*(?:1|one)|periodo\s*(?:1|uno)|1st\s*(?:period|per)?|first\s*(?:period|per)?|primer(?:o)?\s*periodo|p\s*1)\b/i, '1'],
  [/\b(?:period\s*(?:2|two)|periodo\s*(?:2|dos)|2nd\s*(?:period|per)?|second\s*(?:period|per)?|segundo\s*periodo|p\s*2)\b/i, '2'],
  [/\b(?:period\s*(?:3|three)|periodo\s*(?:3|tres)|3rd\s*(?:period|per)?|third\s*(?:period|per)?|tercer(?:o)?\s*periodo|p\s*3)\b/i, '3'],
  [/\b(?:period\s*(?:4|four)|periodo\s*(?:4|cuatro)|4th\s*(?:period|per)?|fourth\s*(?:period|per)?|cuarto\s*periodo|p\s*4)\b/i, '4'],
  [/\b(?:period\s*(?:5|five)|periodo\s*(?:5|cinco)|5th\s*(?:period|per)?|fifth\s*(?:period|per)?|quinto\s*periodo|p\s*5)\b/i, '5'],
];

const GRADE_PATTERNS: Array<[RegExp, '9' | '10' | '11' | '12']> = [
  [/\b(?:freshman|freshmen|9th|ninth)\b/i, '9'],
  [/\b(?:sophomore|sophomores|10th|tenth)\b/i, '10'],
  [/\b(?:junior|juniors|11th|eleventh)\b/i, '11'],
  [/\b(?:senior|seniors|12th|twelfth)\b/i, '12'],
];

/**
 * Common Android/iOS SpeechRecognition phonetic mishearings for Dos Pueblos campus names.
 */
const STT_REWRITES: Array<[RegExp, string]> = [
  [/\b(?:e[\s\-]?pack|ee[\s\-]?pac|e[\s\-]?pac|epack|ee[\s\-]?pack|elings\s+performing\s+arts(?:\s+center)?)\b/gi, 'epac'],
  [/\b(?:d\s*p\s*e\s*a|dp\s*ea|deep\s*ya|d[\s\-]?pea)\b/gi, 'dpea'],
  [/\bcharger\s+in\b/gi, 'charger inn'],
  [/\b(?:greek\s+theat(?:er|re)|amphitheat(?:er|re))\b/gi, 'the greek'],
  [/\bc\s+c\s+c\b/gi, 'ccc'],
  [/\bwood\s+shop\b/gi, 'woodshop'],
  [/\b(?:rest\s+room|bath\s+room|wash\s+room)s?\b/gi, 'restrooms'],
  [/\b(?:o'?leary|scott\s+o'?leary)\b/gi, 'stadium'],
  [/\b(?:sovey\s+gym|main\s+gym|big\s+gym|gymnasium)\b/gi, 'gym'],
  [/\b(?:swimming\s+pool|swim\s+pool|aquatics?\s*(?:center)?|alberca|piscina)\b/gi, 'pool'],
  [/\b(?:football\s+field|football\s+stadium|estadio)\b/gi, 'stadium'],
  [/\b(?:banos?|sanitarios?|servicios?)\b/gi, 'restrooms'],
  [/\b(?:ingenieria)\b/gi, 'engineering'],
  [/\b(?:salones?|salon|aula)\b/gi, 'room'],
  [/\b(?:edificio)\s+([abcehmpqst])\b/gi, '$1 building'],
];

const SPOKEN_ONES: Record<string, number> = {
  zero: 0,
  oh: 0,
  o: 0,
  one: 1,
  won: 1,
  two: 2,
  to: 2,
  too: 2,
  three: 3,
  four: 4,
  for: 4,
  fore: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  ate: 8,
  nine: 9,
};

const SPOKEN_TEENS: Record<string, number> = {
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const SPOKEN_TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
};

const SPOKEN_SUFFIX_LETTER: Record<string, string> = {
  a: 'A',
  ay: 'A',
  b: 'B',
  bee: 'B',
  be: 'B',
  c: 'C',
  see: 'C',
  sea: 'C',
};

const VALID_WING_LETTERS = new Set(['a', 'b', 'c', 'e', 'h', 'l', 'm', 'p', 'q', 's', 't']);

export function preprocessSpokenText(raw: string): string {
  let s = expandContractions(raw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  for (const [re, rep] of STT_REWRITES) {
    s = s.replace(re, rep);
  }
  return s.replace(/[?!¿¡.,;:()[\]"]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractPeriod(text: string): string | null {
  for (const [re, num] of PERIOD_PATTERNS) {
    if (re.test(text)) return num;
  }
  return null;
}

function extractGrade(text: string): '9' | '10' | '11' | '12' | null {
  for (const [re, g] of GRADE_PATTERNS) {
    if (re.test(text)) return g;
  }
  return null;
}

/**
 * Strip natural spoken conversational filler AFTER contractions are expanded!
 * "I'm at the epac" -> "i am at the epac" -> "epac"
 */
function stripSpokenFiller(raw: string): string {
  const expanded = preprocessSpokenText(raw);
  return expanded
    .replace(
      /\b(?:uh+|um+|oh+|well|okay|ok|hey|hi|hello|please|thanks|thank you|actually|basically|literally|like|you know|right now|currently|presently|just|over|somewhere|my son|my daughter|my kid|my student|he is|she is|they are|i am|i have|i would|we are|you are|it is|that is|there is|where is|what is|trying to go to|trying to find|trying to get to|looking for|heading to|headed to|going to|want to go to|need to go to|need to find|want to find|take me to|walk me to|direct me to|navigate to|directions to|how do i get to|can you take me to|standing near|standing by|standing in front of|standing outside|standing at|sitting near|sitting by|sitting at|sitting in|parked at|parked in|parked by|dropped off at|dropped off by|right near|right by|right outside|right at|right in front of|next to|in front of|outside of|outside|near|around|across from|behind|beside|by the|at the|in the|on the|to the|from the)\b/gi,
      ' '
    )
    .replace(
      /\b(?:i|me|my|we|our|you|your|a|an|the|is|are|was|were|be|been|at|in|on|by|for|to|of|from|with|his|her|their|this|that|here|there|need|want|find|see|meet|get|go|going|class|classroom|room|teacher|period|estoy|estamos|en|el|la|los|las|un|una|del|al|de|por|para|cerca|afuera|frente|donde|esta|estan|busco|buscando|quiero|necesito|ir|encontrar|llevame|mi|hijo|hija|clase|maestro|maestra|profesor|profesora|senor|senora|senorita)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function courseMatchesGradeHint(course: string, grade: '9' | '10' | '11' | '12'): number {
  const c = course.toLowerCase();
  if (grade === '12') {
    if (/\b12\b|gov|econ|prdmfg|prddev2|mech 2|adv\b|ap\s|ib\s|calculus|multivar|stats|physics|avid 12/.test(c)) {
      return 3;
    }
    if (/stem 101|engr 101|9\b|health|avid 9|math 1\b|english 9|spanish 1\b/.test(c)) {
      return -2;
    }
  } else if (grade === '11') {
    if (/\b11\b|us history|apush|ap\s|ib\s|prddev|adv|math 3|chem|physics|avid 11/.test(c)) return 2;
    if (/stem 101|9\b|english 9/.test(c)) return -1;
  } else if (grade === '10') {
    if (/\b10\b|world|mechatronics 1|math 2|chem|bio|english 10|avid 10/.test(c)) return 2;
  } else if (grade === '9') {
    if (/\b9\b|stem 101|engr 101|health|english 9|math 1|bio|avid 9/.test(c)) return 3;
    if (/prdmfg|prddev2|mech 2|12\b/.test(c)) return -2;
  }
  return 0;
}

interface PhraseEntry {
  phrase: string;
  tokens: string[];
  dest: ResolvedDestination;
  weight: number;
}

interface SpottedEntity {
  dest: ResolvedDestination;
  score: number;
  spanLen: number;
  exact: boolean;
}

export class CampusNLU {
  private phraseIndex: PhraseEntry[] = [];
  private buildingByLetter = new Map<string, ResolvedDestination>();

  constructor(
    private catalog: CampusCatalog,
    private search: CampusSearch,
    private campus: CampusData
  ) {
    this.buildPhraseIndex();
  }

  private buildPhraseIndex(): void {
    const seen = new Set<string>();
    const add = (rawPhrase: string, dest: ResolvedDestination, weight: number) => {
      const phrase = normalizeText(rawPhrase);
      if (!phrase || phrase.length < 2) return;
      const dedupKey = `${dest.key}|${phrase}`;
      if (seen.has(dedupKey)) return;
      seen.add(dedupKey);
      this.phraseIndex.push({
        phrase,
        tokens: phrase.split(' '),
        dest,
        weight,
      });
    };

    const landmarkKw = new Map(this.campus.landmarks.map((l) => [l.id, l.keywords]));
    const spotKw = new Map(this.campus.spots.map((s) => [s.id, s.keywords]));

    for (const dest of this.catalog.all) {
      if (dest.kind === 'building' && dest.buildingId) {
        this.buildingByLetter.set(dest.buildingId.toLowerCase(), dest);
        add(dest.title, dest, 880);
        if (dest.buildingId.length === 1) {
          add(`${dest.buildingId} wing`, dest, 910);
          add(`${dest.buildingId} building`, dest, 910);
          add(`${dest.buildingId} hall`, dest, 890);
        }
      } else if (dest.kind === 'landmark') {
        add(dest.title, dest, 980);
        if (dest.landmarkId && landmarkKw.has(dest.landmarkId)) {
          for (const kw of landmarkKw.get(dest.landmarkId)!) add(kw, dest, 950);
        }
      } else if (dest.kind === 'spot') {
        // Don't index generic "restroom"/"bathroom" under 11 separate restroom spots — handled by nearest-restroom logic
        const isRestroom = Boolean(dest.spotId?.startsWith('rr-'));
        add(dest.title, dest, isRestroom ? 820 : 970);
        if (!isRestroom && dest.spotId && spotKw.has(dest.spotId)) {
          for (const kw of spotKw.get(dest.spotId)!) add(kw, dest, 915);
        }
      } else if (dest.kind === 'teacher' && dest.teacher) {
        add(dest.title, dest, 930);
        const parts = normalizeText(dest.title).split(' ');
        const last = parts[parts.length - 1];
        if (last && last.length >= 3) add(last, dest, 860);
      }

      if (EXTRA_CAMPUS_ALIASES[dest.key]) {
        for (const alias of EXTRA_CAMPUS_ALIASES[dest.key]) {
          add(alias, dest, dest.kind === 'landmark' ? 960 : 920);
        }
      }
    }
  }

  /**
   * Extract real Dos Pueblos room codes from BOTH digits ("H-27", "s 4", "T9B") AND spoken words
   * ("room S four", "S for", "H twenty seven", "P one twenty six", "B zero eight", "T nine bee").
   * Every candidate is strictly validated against Dos Pueblos' 106 real classrooms.
   */
  private extractRoomHits(normalized: string): ResolvedDestination[] {
    const found = new Map<string, ResolvedDestination>();
    const tryCode = (rawCode: string) => {
      const hit = this.catalog.resolveParam(rawCode);
      if (hit && hit.kind === 'room') {
        found.set(hit.key, hit);
      }
    };

    // 1. Standard alphanumeric patterns: "H-27", "h 27", "s4", "b08", "t9b", "p 126"
    const re = /\b([a-z]{1,2})[\s\-]?(\d{1,3}[a-z]?)\b/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(normalized)) !== null) {
      if (/^(?:p|per)\s*[1-5]$/i.test(m[0]) && /\bperiod\b/i.test(normalized)) continue;
      // Avoid confusing "p3" as room P-3 ONLY when spoken right after "period" or clearly grade/period context?
      // Note: P-3 IS a real room at DP, whereas "period 3" is stripped before this or caught by extractPeriod!
      if (/^p\s*[1-5]$/i.test(m[0]) && !/\b(?:room|rm|classroom|outside|at|in|to)\s+p[\s\-]?[1-5]\b/i.test(normalized)) {
        // Still allow exact standalone "P-3" / "P3" if there are no other words
        if (normalized.trim().toLowerCase() !== m[0].trim().toLowerCase()) continue;
      }
      tryCode(`${m[1]}${m[2]}`);
    }

    // 2. Spoken wing letter + spoken number words ("room s four", "s for", "h twenty seven", "p one twenty six", "t nine b")
    const tokens = normalized.toLowerCase().split(' ').filter(Boolean);
    for (let i = 0; i < tokens.length - 1; i++) {
      const letter = tokens[i];
      if (!VALID_WING_LETTERS.has(letter)) continue;
      // Guard English article "a" so "a one minute walk" doesn't fire unless clearly a room reference
      if (letter === 'a') {
        const prev = i > 0 ? tokens[i - 1] : '';
        if (i > 0 && !['room', 'rm', 'classroom', 'at', 'in', 'to', 'outside', 'by', 'near', 'from'].includes(prev)) {
          continue;
        }
      }

      const t1 = tokens[i + 1];
      const t2 = tokens[i + 2];
      const t3 = tokens[i + 3];
      const t4 = tokens[i + 4];

      // Pattern A: "p one twenty six" or "p one hundred twenty six" or "p one two six" -> P126 / P117
      if (t1 === 'one' && t2 === 'hundred' && t3 && t3 in SPOKEN_TENS && t4 && t4 in SPOKEN_ONES) {
        tryCode(`${letter}${100 + SPOKEN_TENS[t3] + SPOKEN_ONES[t4]}`);
        continue;
      }
      if (t1 === 'one' && t2 === 'hundred' && t3 && t3 in SPOKEN_TEENS) {
        tryCode(`${letter}${100 + SPOKEN_TEENS[t3]}`);
        continue;
      }
      if (t1 === 'one' && t2 && t2 in SPOKEN_TENS && t3 && t3 in SPOKEN_ONES) {
        tryCode(`${letter}${100 + SPOKEN_TENS[t2] + SPOKEN_ONES[t3]}`);
        continue;
      }
      if (t1 === 'one' && t2 && t2 in SPOKEN_TEENS) {
        tryCode(`${letter}${100 + SPOKEN_TEENS[t2]}`);
        continue;
      }
      if (t1 === 'one' && t2 && t2 in SPOKEN_ONES && t3 && t3 in SPOKEN_ONES) {
        tryCode(`${letter}1${SPOKEN_ONES[t2]}${SPOKEN_ONES[t3]}`);
        continue;
      }

      // Pattern B: "h twenty seven" / "h thirty four"
      if (t1 in SPOKEN_TENS) {
        const base = SPOKEN_TENS[t1];
        if (t2 && t2 in SPOKEN_ONES && SPOKEN_ONES[t2] > 0) {
          tryCode(`${letter}${base + SPOKEN_ONES[t2]}`);
        } else {
          tryCode(`${letter}${base}`);
        }
        continue;
      }

      // Pattern C: "b zero eight" / "e oh nine"
      if ((t1 === 'zero' || t1 === 'oh' || t1 === 'o') && t2 && t2 in SPOKEN_ONES) {
        tryCode(`${letter}0${SPOKEN_ONES[t2]}`);
        continue;
      }

      // Pattern D: teens ("b twelve", "e fourteen", "q thirteen")
      if (t1 in SPOKEN_TEENS) {
        tryCode(`${letter}${SPOKEN_TEENS[t1]}`);
        continue;
      }

      // Pattern E: single spoken digit + optional suffix letter ("s four", "s for", "t nine b", "t nine bee", "t seven a")
      if (t1 in SPOKEN_ONES) {
        const num = SPOKEN_ONES[t1];
        if (t2 && t2 in SPOKEN_SUFFIX_LETTER) {
          tryCode(`${letter}${num}${SPOKEN_SUFFIX_LETTER[t2]}`);
        }
        if (t2 && t2 in SPOKEN_ONES && num >= 1 && num <= 3) {
          // "h two seven" -> H27
          tryCode(`${letter}${num}${SPOKEN_ONES[t2]}`);
        }
        tryCode(`${letter}${num}`);
        continue;
      }

      // Pattern F: digit + spoken suffix letter ("t 9 b" / "t 7 a")
      if (/^\d{1,3}$/.test(t1) && t2 && t2 in SPOKEN_SUFFIX_LETTER) {
        tryCode(`${letter}${t1}${SPOKEN_SUFFIX_LETTER[t2]}`);
      }
    }

    return Array.from(found.values());
  }

  /**
   * Spot ANY Dos Pueblos landmark, spot, building, or teacher mentioned anywhere inside
   * an arbitrary natural sentence — immune to surrounding conversational fluff!
   */
  private spotEntitiesInSentence(
    normalized: string,
    opts: { allowTeachers: boolean; near?: MapPoint }
  ): SpottedEntity[] {
    const tokens = normalized.toLowerCase().split(' ').filter(Boolean);
    if (tokens.length === 0) return [];

    // Generate all contiguous 1..4 word spans from the utterance
    const spans: Array<{ text: string; len: number }> = [];
    for (let len = Math.min(4, tokens.length); len >= 1; len--) {
      for (let i = 0; i <= tokens.length - len; i++) {
        const text = tokens.slice(i, i + len).join(' ');
        if (text.length >= 2) spans.push({ text, len });
      }
    }

    const bestByKey = new Map<string, SpottedEntity>();
    const record = (dest: ResolvedDestination, score: number, spanLen: number, exact: boolean) => {
      const prev = bestByKey.get(dest.key);
      if (!prev || score > prev.score) {
        bestByKey.set(dest.key, { dest, score, spanLen, exact });
      }
    };

    for (const entry of this.phraseIndex) {
      if (!opts.allowTeachers && entry.dest.kind === 'teacher') continue;
      const pLen = entry.tokens.length;

      for (const sp of spans) {
        if (sp.text === entry.phrase) {
          // Exact phrase match inside the sentence! Longer multi-word matches get a specificity bonus.
          const specificityBonus = (pLen - 1) * 55 + Math.min(25, entry.phrase.length * 1.5);
          record(entry.dest, entry.weight + specificityBonus, sp.len, true);
          break;
        }
      }
    }

    // Fuzzy fallback across spans if no high-confidence exact phrase hit (handles typos/STT drift like "epack", "libary", "cafiteria", "andreson")
    const topExact = Array.from(bestByKey.values()).reduce((m, e) => Math.max(m, e.score), 0);
    if (topExact < 880) {
      for (const entry of this.phraseIndex) {
        if (!opts.allowTeachers && entry.dest.kind === 'teacher') continue;
        if (entry.phrase.length < 4) continue;
        const pLen = entry.tokens.length;
        for (const sp of spans) {
          if (Math.abs(sp.len - pLen) > 1) continue;
          if (sp.text.length < 4) continue;
          const maxErr = entry.phrase.length >= 7 ? 2 : 1;
          if (Math.abs(sp.text.length - entry.phrase.length) > maxErr) continue;
          const dist = damerauLevenshtein(sp.text, entry.phrase, maxErr);
          if (dist <= maxErr) {
            const penalty = dist === 1 ? 150 : 260;
            const specificityBonus = (pLen - 1) * 40;
            record(entry.dest, entry.weight - penalty + specificityBonus, sp.len, false);
          }
        }
      }
    }

    const list = Array.from(bestByKey.values());
    if (opts.near) {
      for (const item of list) {
        const distMap = Math.hypot(item.dest.x - opts.near.x, item.dest.y - opts.near.y);
        item.score += Math.max(0, 18 - distMap / 45);
      }
    }

    list.sort((a, b) => b.score - a.score || b.spanLen - a.spanLen);
    return list;
  }

  /**
   * Check whether two places represent the exact same physical building/landmark
   * (e.g., "EPAC Theater" landmark + "EPAC" building + "EPAC Lobby" spot) so we don't
   * nag the user to disambiguate duplicates of the same spot.
   */
  private areSamePhysicalPlace(a: ResolvedDestination, b: ResolvedDestination): boolean {
    if (a.key === b.key) return true;
    const lmA = a.landmarkId || (a.buildingId ? this.campus.buildings[a.buildingId]?.at : undefined);
    const lmB = b.landmarkId || (b.buildingId ? this.campus.buildings[b.buildingId]?.at : undefined);
    if (lmA && lmB && lmA === lmB) return true;
    const dist = Math.hypot(
      (a.routeTarget?.x ?? a.x) - (b.routeTarget?.x ?? b.x),
      (a.routeTarget?.y ?? a.y) - (b.routeTarget?.y ?? b.y)
    );
    return dist < 75 && a.kind !== 'room' && b.kind !== 'room';
  }

  private destToOrigin(d: ResolvedDestination): RouteOrigin {
    return {
      kind: d.kind === 'room' ? 'room' : 'custom',
      id: d.key,
      label: d.title,
      phrase: d.kind === 'room' ? d.title : `the ${d.title.replace(/^the\s+/i, '')}`,
      x: d.routeTarget?.x ?? d.x,
      y: d.routeTarget?.y ?? d.y,
      roomId: d.roomId,
    };
  }

  /**
   * Try parsing an answer to "Where are you right now?" across primary transcript + STT alternatives.
   */
  parseOrigin(rawInput: string, alternatives: string[] = []): LocationParseResult {
    const candidates = [rawInput, ...alternatives].map((s) => s.trim()).filter(Boolean);
    const seen = new Set<string>();
    const unique = candidates.filter((c) => {
      const k = c.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    if (unique.length === 0) {
      return {
        kind: 'unclear',
        reply: 'Tell me a room number like S-4, a building like EPAC or Library, or tap one of the campus entrances below.',
      };
    }

    let fallbackDisambig: LocationParseResult | null = null;
    for (const candidate of unique) {
      const res = this.parseSingleOrigin(candidate);
      if (res.kind === 'resolved') return res;
      if (res.kind === 'disambiguate' && !fallbackDisambig) fallbackDisambig = res;
    }

    if (fallbackDisambig) return fallbackDisambig;
    return {
      kind: 'unclear',
      reply: `I didn't recognize "${unique[0]}" on campus. Try a room (like H-27 or S-4), a landmark (EPAC, Library, Gym, Pool), or scan a room sign.`,
    };
  }

  private parseSingleOrigin(trimmed: string): LocationParseResult {
    const pre = preprocessSpokenText(trimmed);
    const lower = pre.toLowerCase();

    // 0. Detect one-shot combined Origin + Destination ("I'm at the EPAC and need to go to H-27" / "from library to pool")
    const combinedMatch =
      pre.match(/^from\s+(.+?)\s+(?:to|toward|towards)\s+(.+)$/i) ||
      pre.match(
        /^(.+?)\s+(?:and\s+)?(?:i\s+(?:am\s+)?(?:trying|need|want)\s+to\s+(?:go|get|walk|head)\s+to|(?:trying|need|want)\s+to\s+(?:go|get)\s+to|take\s+me\s+to|walk\s+me\s+to|directions\s+to|how\s+do\s+i\s+get\s+to|heading\s+to|going\s+to|looking\s+for)\s+(.+)$/i
      );
    if (combinedMatch) {
      const origPart = combinedMatch[1].trim();
      const destPart = combinedMatch[2].trim();
      if (origPart.length >= 2 && destPart.length >= 2) {
        const origRes = this.parseSingleOrigin(origPart);
        if (origRes.kind === 'resolved') {
          const destRes = this.parseSingleDestination(destPart, {
            x: origRes.origin.x,
            y: origRes.origin.y,
          });
          if (destRes.kind === 'resolved') {
            return {
              kind: 'resolved',
              origin: origRes.origin,
              destination: origRes.destination,
              routeToDest: destRes.destination,
              routeReply: destRes.reply,
              matchedTeachers: destRes.matchedTeachers,
              periodFilter: destRes.periodFilter,
              reply: `${origRes.reply} ${destRes.reply}`,
            };
          }
        }
      }
    }

    // 1. Direct room code extraction (digits OR spoken numbers like "I'm outside room S four" / "H twenty seven")
    const roomHits = this.extractRoomHits(pre);
    if (roomHits.length > 0) {
      const hit = roomHits[0];
      const bldg = hit.buildingId ? this.campus.buildings[hit.buildingId] : null;
      return {
        kind: 'resolved',
        origin: this.destToOrigin(hit),
        destination: hit,
        reply: `Got it — I have you right by ${hit.title}${bldg ? ` in the ${bldg.name}` : ''}.`,
      };
    }

    // 2. Explicit start points ("front office", "student parking", "the greek", "cafeteria rd")
    for (const sp of this.campus.startPoints) {
      if (
        lower.includes(sp.label.toLowerCase()) ||
        (sp.id === 'front' &&
          /\b(?:front\s*(?:office|desk|entrance)|main\s*(?:office|entrance)|admin(?:istration)?)\b/i.test(lower)) ||
        (sp.id === 'parking' && /\b(?:student\s*lot|parking\s*lot|student\s*parking|main\s*lot)\b/i.test(lower)) ||
        (sp.id === 'greek' && /\b(?:greek|amphitheater|middle of campus|main quad|\bquad\b)\b/i.test(lower)) ||
        (sp.id === 'east' && /\b(?:cafeteria\s*(?:rd|road)|east\s*lot)\b/i.test(lower))
      ) {
        return {
          kind: 'resolved',
          origin: {
            kind: 'start',
            id: sp.id,
            label: sp.label,
            phrase: sp.phrase,
            x: sp.x,
            y: sp.y,
          },
          reply: `Got it — starting from ${sp.phrase}.`,
        };
      }
    }

    // 3. Explicit wing / building mention ("I'm in the H building", "by T wing", "at the S wing")
    const wingMatch = lower.match(/\b([abcehmpqst])\s*(?:building|wing|hall|cluster|block)\b/i);
    if (wingMatch) {
      const bDest = this.buildingByLetter.get(wingMatch[1].toLowerCase());
      if (bDest) {
        return {
          kind: 'resolved',
          origin: this.destToOrigin(bDest),
          destination: bDest,
          reply: `Got it — I've pinned you at the ${bDest.title}.`,
        };
      }
    }

    // 4. Entity spotter across arbitrary natural speech (handles "I'm at the epac", "standing over by the pool", etc.)
    const spotted = this.spotEntitiesInSentence(pre, { allowTeachers: false });
    if (spotted.length > 0 && spotted[0].score >= 700) {
      const top = spotted[0];
      // Filter out duplicate representations of the exact same physical place (e.g. EPAC Theater vs EPAC building vs EPAC Lobby)
      const distinctPeers = spotted.filter(
        (s) =>
          !this.areSamePhysicalPlace(top.dest, s.dest) &&
          top.score - s.score < 35 &&
          top.score < 940
      );
      if (distinctPeers.length > 0) {
        const opts = [top, ...distinctPeers].slice(0, 4);
        return {
          kind: 'disambiguate',
          prompt: 'Which of these are you closest to?',
          options: opts.map((s) => ({
            label: s.dest.title,
            sub: s.dest.subtitle,
            destination: s.dest,
            origin: this.destToOrigin(s.dest),
          })),
        };
      }
      return {
        kind: 'resolved',
        origin: this.destToOrigin(top.dest),
        destination: top.dest,
        reply: `Got it — I've pinned you right by ${top.dest.title}.`,
      };
    }

    // 5. Fallback: filler-stripped forgiving CampusSearch
    const cleaned = stripSpokenFiller(pre) || pre;
    const hits = this.search.search(cleaned, { limit: 6 });
    const placeHits = hits.filter((h) => h.destination.kind !== 'teacher');
    const bestList = placeHits.length > 0 ? placeHits : hits;

    if (bestList.length === 0) {
      return {
        kind: 'unclear',
        reply: `I didn't recognize "${trimmed}" on campus. Try a room (like H-27 or S-4), a landmark (EPAC, Library, Gym, Pool), or scan a room sign.`,
      };
    }

    const top = bestList[0];
    const distinctPeers = bestList
      .slice(1)
      .filter(
        (h) =>
          !this.areSamePhysicalPlace(top.destination, h.destination) &&
          top.score - h.score < 35 &&
          top.score < 900
      );

    if (distinctPeers.length > 0) {
      const choices = [top, ...distinctPeers].slice(0, 4);
      return {
        kind: 'disambiguate',
        prompt: 'Which of these are you closest to?',
        options: choices.map((h) => ({
          label: h.destination.title,
          sub: h.destination.subtitle,
          destination: h.destination,
          origin: this.destToOrigin(h.destination),
        })),
      };
    }

    const d = top.destination;
    return {
      kind: 'resolved',
      origin: this.destToOrigin(d),
      destination: d,
      reply: `Got it — I've pinned you right by ${d.title}.`,
    };
  }

  /**
   * Parse an answer to "Where are you trying to go?" across primary transcript + STT alternatives.
   */
  parseDestination(
    rawInput: string,
    near?: MapPoint,
    pendingOptions?: ResolvedDestination[],
    alternatives: string[] = []
  ): DestinationParseResult {
    const candidates = [rawInput, ...alternatives].map((s) => s.trim()).filter(Boolean);
    const seen = new Set<string>();
    const unique = candidates.filter((c) => {
      const k = c.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    if (unique.length === 0) {
      return {
        kind: 'unclear',
        reply: 'Tell me a teacher, room number, class, or place like "Engineering, period 3" or "restroom".',
      };
    }

    let fallbackDisambig: DestinationParseResult | null = null;
    for (const candidate of unique) {
      const res = this.parseSingleDestination(candidate, near, pendingOptions);
      if (res.kind === 'resolved') return res;
      if (res.kind === 'disambiguate' && !fallbackDisambig) fallbackDisambig = res;
    }

    if (fallbackDisambig) return fallbackDisambig;
    return {
      kind: 'unclear',
      reply: `I couldn't find "${unique[0]}" in Dos Pueblos' directory. Try a teacher's last name, a room like H-27, or a spot like EPAC, Pool, or Staff Lounge.`,
    };
  }

  private parseSingleDestination(
    trimmed: string,
    near?: MapPoint,
    pendingOptions?: ResolvedDestination[]
  ): DestinationParseResult {
    const pre = preprocessSpokenText(trimmed);
    const lower = pre.toLowerCase();

    // 0. Resolve follow-up to a previous disambiguation prompt (e.g., two Ms. Andersons)
    if (pendingOptions && pendingOptions.length > 0) {
      const toks = normalizeText(pre).split(' ').filter((t) => t.length >= 2);
      const matchedOpt = pendingOptions.find((opt) => {
        const hay = `${opt.title} ${opt.subtitle} ${opt.badge} ${
          opt.teacher ? `${opt.teacher.departments.join(' ')} ${Object.values(opt.teacher.periods).join(' ')}` : ''
        }`.toLowerCase();
        return toks.some((tok) => hay.includes(tok));
      });
      if (matchedOpt) {
        return {
          kind: 'resolved',
          destination: matchedOpt,
          reply: `Heading to ${matchedOpt.title} (${matchedOpt.badge}).`,
          matchedTeachers: matchedOpt.teachers,
        };
      }
      if (/\b(?:first|1st|one)\b/i.test(lower) && pendingOptions[0]) {
        const opt = pendingOptions[0];
        return { kind: 'resolved', destination: opt, reply: `Heading to ${opt.title}.`, matchedTeachers: opt.teachers };
      }
      if (/\b(?:second|2nd|two)\b/i.test(lower) && pendingOptions[1]) {
        const opt = pendingOptions[1];
        return { kind: 'resolved', destination: opt, reply: `Heading to ${opt.title}.`, matchedTeachers: opt.teachers };
      }
      if (/\b(?:third|3rd|three)\b/i.test(lower) && pendingOptions[2]) {
        const opt = pendingOptions[2];
        return { kind: 'resolved', destination: opt, reply: `Heading to ${opt.title}.`, matchedTeachers: opt.teachers };
      }
    }

    const period = extractPeriod(pre);
    const grade = extractGrade(pre);

    // 1. Explicit nearest restroom intent
    if (/\b(?:restrooms?|bathrooms?|washrooms?|toilet|wc|pee|potty|mens\s*room|womens\s*room|ladies\s*room)\b/i.test(lower)) {
      const rrHits = this.search.search('restrooms', { limit: 11, near });
      if (rrHits.length > 0) {
        const closest = rrHits[0].destination;
        return {
          kind: 'resolved',
          destination: closest,
          reply: `The closest restrooms are ${closest.title}.`,
        };
      }
    }

    // 2. Engineering / DPEA smart intent ("I'm trying to go to engineering, third period, he's a senior")
    if (/\b(?:engineering|engineer|dpea|mechatronics|robotics|machining|prdmfg|prddev)\b/i.test(lower)) {
      const dpeaLandmark = this.catalog.byKey.get('landmark:dpea')!;
      const allDpeaTeachers = this.catalog.all
        .filter((d) => d.kind === 'teacher' && d.teacher?.departments.some((dep) => dep.toLowerCase() === 'dpea'))
        .map((d) => d.teacher!)
        .filter(Boolean);

      let matched = allDpeaTeachers;
      if (period) {
        const inPeriod = allDpeaTeachers.filter((t) => Boolean(t.periods[period]));
        if (inPeriod.length > 0) matched = inPeriod;
      }
      if (grade && matched.length > 1) {
        const scored = matched
          .map((t) => {
            const cls = period ? t.periods[period] ?? '' : Object.values(t.periods).join(' ');
            return { t, s: courseMatchesGradeHint(cls, grade) };
          })
          .sort((a, b) => b.s - a.s);
        const topScore = scored[0].s;
        if (topScore > 0) {
          matched = scored.filter((x) => x.s === topScore).map((x) => x.t);
        }
      }

      const periodPhrase = period ? ` for Period ${period}` : '';
      const gradePhrase = grade === '12' ? ' (senior-level classes)' : grade === '9' ? ' (9th grade intro)' : '';
      const sampleCourse = period && matched[0]?.periods[period] ? matched[0].periods[period] : null;
      const teacherNames = matched.slice(0, 4).map((t) => t.name).join(', ');
      const extra = matched.length > 4 ? ` and ${matched.length - 4} more` : '';

      const reply = sampleCourse
        ? `Engineering Academy (DPEA)${periodPhrase}${gradePhrase} — ${sampleCourse} meets in the E building wing (${teacherNames}${extra}).`
        : `Taking you to the Engineering Academy (DPEA) in the E building wing${periodPhrase}.`;

      return {
        kind: 'resolved',
        destination: {
          ...dpeaLandmark,
          teachers: matched,
        },
        reply,
        matchedTeachers: matched,
        periodFilter: period ?? undefined,
      };
    }

    // Strip period/grade phrases before room & entity extraction so "period 3" never triggers room P-3
    let strippedPeriod = pre;
    for (const [re] of PERIOD_PATTERNS) strippedPeriod = strippedPeriod.replace(re, ' ');
    for (const [re] of GRADE_PATTERNS) strippedPeriod = strippedPeriod.replace(re, ' ');
    strippedPeriod = strippedPeriod.replace(/\s+/g, ' ').trim();

    // 3. Direct room code extraction (digits OR spoken numbers like "room H twenty seven" / "S four")
    const roomHits = this.extractRoomHits(strippedPeriod);
    if (roomHits.length > 0) {
      const hit = roomHits[0];
      const tNames = hit.teachers?.map((t) => t.name).join(' & ');
      return {
        kind: 'resolved',
        destination: hit,
        reply: tNames
          ? `Taking you to ${hit.title} (${tNames}).`
          : `Taking you to ${hit.title} in the ${hit.badge}.`,
        matchedTeachers: hit.teachers,
        periodFilter: period ?? undefined,
      };
    }

    // 4. Clean conversational query + forgiving CampusSearch
    const cleaned = stripSpokenFiller(strippedPeriod) || strippedPeriod || pre;
    let hits = this.search.search(cleaned, { limit: 12, near });

    // Also run phrase entity spotter in case extra unstripped conversational words reduced CampusSearch scores
    const spotted = this.spotEntitiesInSentence(strippedPeriod || pre, { allowTeachers: true, near });
    if (spotted.length > 0) {
      const existingByKey = new Map(hits.map((h) => [h.destination.key, h]));
      for (const s of spotted.slice(0, 8)) {
        const cur = existingByKey.get(s.dest.key);
        if (!cur || s.score > cur.score) {
          existingByKey.set(s.dest.key, { destination: s.dest, score: s.score });
        }
      }
      hits = Array.from(existingByKey.values()).sort((a, b) => b.score - a.score);
    }

    // 5. If period or grade was mentioned, boost teachers who actually teach that period & grade
    if ((period || grade) && hits.some((h) => h.destination.kind === 'teacher')) {
      const teacherHits = hits
        .filter((h) => h.destination.kind === 'teacher' && h.destination.teacher)
        .map((h) => {
          let boost = 0;
          const t = h.destination.teacher!;
          if (period) {
            if (t.periods[period]) boost += 180;
            else boost -= 90;
          }
          if (grade) {
            const cls = period ? t.periods[period] ?? '' : Object.values(t.periods).join(' ');
            boost += courseMatchesGradeHint(cls, grade) * 45;
          }
          return { ...h, score: h.score + boost };
        })
        .sort((a, b) => b.score - a.score);

      if (teacherHits.length > 0 && teacherHits[0].score > 260) {
        hits = teacherHits;
      }
    }

    // 6. Teacher honorific + department/subject boost ("Ms. Anderson for performing arts", "Coach Choi")
    if (hits.some((h) => h.destination.kind === 'teacher')) {
      const hasHonorific = /\b(?:mr|mrs|ms|miss|mx|dr|coach|prof|teacher)\b/i.test(pre);
      const qToks = normalizeText(strippedPeriod).split(' ').filter((t) => t.length >= 3);
      hits = hits
        .map((h) => {
          if (h.destination.kind !== 'teacher' || !h.destination.teacher) return h;
          const meta = normalizeText(
            `${h.destination.teacher.departments.join(' ')} ${Object.values(h.destination.teacher.periods).join(' ')}`
          );
          const extraHits = qToks.filter((tok) => meta.includes(tok)).length;
          return { ...h, score: h.score + (hasHonorific ? 190 : 0) + extraHits * 110 };
        })
        .sort((a, b) => b.score - a.score);
    }

    if (hits.length === 0) {
      return {
        kind: 'unclear',
        reply: `I couldn't find "${trimmed}" in Dos Pueblos' directory. Try a teacher's last name, a room like H-27, or a spot like EPAC, Pool, or Staff Lounge.`,
      };
    }

    const top = hits[0];
    const closePeers = hits.filter(
      (h) =>
        h.destination.key !== top.destination.key &&
        h.destination.kind === top.destination.kind &&
        top.score - h.score < 32
    );

    if (closePeers.length > 0 && top.destination.kind === 'teacher') {
      const choices = [top, ...closePeers].slice(0, 4);
      const summary = choices
        .map((c) => {
          const pClass =
            period && c.destination.teacher?.periods[period]
              ? ` · P${period}: ${c.destination.teacher.periods[period]}`
              : '';
          return `${c.destination.title} (${c.destination.badge}${pClass})`;
        })
        .join(' or ');
      return {
        kind: 'disambiguate',
        reply: `I found a few matches${period ? ` for Period ${period}` : ''}: ${summary}. Which one?`,
        options: choices.map((c) => ({
          destination: c.destination,
          detail:
            period && c.destination.teacher?.periods[period]
              ? `Period ${period}: ${c.destination.teacher.periods[period]}`
              : c.destination.subtitle,
        })),
      };
    }

    const dest = top.destination;
    const pCourse = period && dest.teacher?.periods[period] ? dest.teacher.periods[period] : null;
    const reply =
      dest.kind === 'teacher'
        ? pCourse
          ? `Found ${dest.title} — Period ${period} (${pCourse}) is in ${dest.badge}.`
          : `Found ${dest.title} in ${dest.badge} (${dest.teacher?.departments.join(', ') ?? ''}).`
        : `Taking you to ${dest.title}.`;

    return {
      kind: 'resolved',
      destination: dest,
      reply,
      matchedTeachers: dest.teachers,
      periodFilter: period ?? undefined,
    };
  }
}
