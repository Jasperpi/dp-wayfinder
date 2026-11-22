import type { CampusData, MapPoint, ResolvedDestination } from '../types';
import { CampusCatalog, normalizeRoomCode } from './catalog';

export interface SearchHit {
  destination: ResolvedDestination;
  score: number;
  matchReason?: string;
}

interface SearchDoc {
  dest: ResolvedDestination;
  normTitle: string;
  normRoomCode: string | null;
  titleTokens: string[];
  /** Extra room codes (e.g. for teachers with 1-3 rooms) */
  roomCodes: string[];
  keywords: string[];
  courses: string[];
  departments: string[];
  fullText: string;
}

const STOP_WORDS = new Set([
  'mr',
  'mrs',
  'ms',
  'miss',
  'mx',
  'dr',
  'prof',
  'coach',
  'teacher',
  'room',
  'rm',
  'bldg',
  'building',
  'the',
  'to',
  'find',
  'where',
  'is',
  'are',
  'of',
  'i',
  'im',
  'am',
  'at',
  'in',
  'on',
  'by',
  'near',
  'my',
  'our',
  'we',
  'for',
  'and',
  'from',
  'go',
  'get',
  'me',
  'outside',
  'around',
  'here',
  'right',
  'now',
]);

/**
 * Extra real-world student/parent aliases & speech-to-text variants for Dos Pueblos landmarks & spots.
 */
export const EXTRA_CAMPUS_ALIASES: Record<string, string[]> = {
  'landmark:theater': [
    'epac',
    'e pack',
    'epack',
    'e pac',
    'pac',
    'elings',
    'elings performing arts center',
    'performing arts center',
    'performing arts',
    'theater',
    'theatre',
    'teatro',
    'auditorium',
    'auditorio',
    'drama',
    'stage',
  ],
  'landmark:dpea': [
    'dpea',
    'dp ea',
    'd p e a',
    'deep ya',
    'engineering',
    'ingenieria',
    'engineering academy',
    'engineering building',
    'engineering wing',
    'robotics',
    'robotica',
    'mechatronics',
    'machining',
    'e wing',
    'e building',
  ],
  'landmark:greek': [
    'greek',
    'the greek',
    'greek theater',
    'greek theatre',
    'teatro griego',
    'amphitheater',
    'amphitheatre',
    'anfiteatro',
    'quad',
    'main quad',
    'courtyard',
    'patio central',
    'middle of campus',
    'center of campus',
  ],
  'landmark:pool': [
    'pool',
    'swimming pool',
    'swim pool',
    'alberca',
    'piscina',
    'aquatics',
    'aquatics center',
    'aquatic center',
    'swim',
    'water polo',
  ],
  'landmark:gym': [
    'gym',
    'gymnasium',
    'gimnasio',
    'main gym',
    'sovey gym',
    'big gym',
    'pe gym',
    'basketball court',
    'basketball',
  ],
  'landmark:stadium': [
    'stadium',
    'estadio',
    'football field',
    'football stadium',
    'football',
    'track',
    'track field',
    'scott oleary',
    'oleary stadium',
    'bleachers',
    'gradas',
  ],
  'landmark:admin': [
    'admin',
    'administration',
    'administracion',
    'administration building',
    'front office',
    'main office',
    'oficina',
    'oficina principal',
    'front desk',
    'main entrance',
    'front entrance',
    'office',
    'principal office',
    'principals office',
  ],
  'landmark:library': [
    'library',
    'libary',
    'biblioteca',
    'media center',
    'the library',
    'books',
  ],
  'landmark:cafeteria': [
    'cafeteria',
    'cafiteria',
    'cafe',
    'comedor',
    'lunch',
    'lunchroom',
    'lunch room',
    'dining hall',
    'food',
    'charger inn',
  ],
  'landmark:busloop': [
    'bus loop',
    'bus stop',
    'autobus',
    'camion',
    'bus drop off',
    'drop off',
    'dropoff',
    'pick up',
    'pickup',
    'buses',
  ],
  'landmark:parking': [
    'student parking',
    'parking lot',
    'estacionamiento',
    'student lot',
    'main parking',
    'main lot',
    'alameda lot',
    'parking',
  ],
  'landmark:baseball': ['baseball', 'beisbol', 'baseball field', 'baseball diamond'],
  'landmark:softball': ['softball', 'softbol', 'softball field', 'softball fields'],
  'landmark:tennis': ['tennis', 'tenis', 'tennis court', 'tennis courts', 'canchas de tenis'],
  'landmark:volleyball': ['beach volleyball', 'sand volleyball', 'sand courts', 'volleyball courts'],
  'landmark:studentstore': ['student store', 'tienda estudiantil', 'school store', 'merch', 'spirit store'],
  'landmark:patio': ['charger patio', 'patio', 'lunch tables'],
  'spot:stafflounge': ['staff lounge', 'teacher lounge', 'teachers lounge', 'sala de maestros', 'faculty lounge', 'faculty room', 'staff room', 'break room'],
  'spot:ccc': ['college and career', 'college career', 'college center', 'career center', 'ccc'],
  'spot:counselors': ['counselors', 'counselor', 'counseling', 'consejero', 'consejeros', 'consejeria', 'counseling office', 'guidance', 'guidance office'],
  'spot:attendance': ['attendance', 'asistencia', 'attendance office', 'tardy', 'late pass'],
  'spot:woodshop': ['woodshop', 'wood shop', 'carpinteria', 'woodworking', 'carpentry'],
  'spot:epaclobby': ['epac lobby', 'theater lobby', 'theatre lobby', 'box office', 'ticket window'],
  'spot:chargerinn': ['charger inn', 'charger in', 'snack bar', 'culinary'],
  'building:p': ['p building', 'p wing', 'edificio p', 'band room', 'choir room', 'music building', 'leadership room'],
};

export function expandContractions(s: string): string {
  return s
    .replace(/['’]/g, "'")
    .replace(/\bi'm\b/gi, 'i am')
    .replace(/\bi've\b/gi, 'i have')
    .replace(/\bi'd\b/gi, 'i would')
    .replace(/\bi'll\b/gi, 'i will')
    .replace(/\bwe're\b/gi, 'we are')
    .replace(/\bthey're\b/gi, 'they are')
    .replace(/\byou're\b/gi, 'you are')
    .replace(/\bhe's\b/gi, 'he is')
    .replace(/\bshe's\b/gi, 'she is')
    .replace(/\bit's\b/gi, 'it is')
    .replace(/\bthat's\b/gi, 'that is')
    .replace(/\bthere's\b/gi, 'there is')
    .replace(/\bwhere's\b/gi, 'where is')
    .replace(/\bwhat's\b/gi, 'what is')
    .replace(/\bwho's\b/gi, 'who is')
    .replace(/\bdon't\b/gi, 'do not')
    .replace(/\bcan't\b/gi, 'cannot')
    .replace(/\bwon't\b/gi, 'will not')
    .replace(/\bdidn't\b/gi, 'did not')
    .replace(/\bisn't\b/gi, 'is not')
    .replace(/\baren't\b/gi, 'are not')
    .replace(/([a-z])'s\b/gi, '$1');
}

export function normalizeText(s: string): string {
  return expandContractions(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenize(s: string): string[] {
  const raw = normalizeText(s).split(' ').filter(Boolean);
  const filtered = raw.filter((t) => !STOP_WORDS.has(t));
  return filtered.length > 0 ? filtered : raw;
}

/**
 * Optimal String Alignment (Damerau-Levenshtein) distance with early-exit threshold.
 * Forgives substitutions, insertions, deletions, AND adjacent character swaps ("andreson" -> "anderson").
 */
export function damerauLevenshtein(a: string, b: string, maxDist = 3): number {
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > maxDist) return maxDist + 1;
  if (a === b) return 0;
  if (al === 0) return bl;
  if (bl === 0) return al;

  const d: number[][] = Array.from({ length: al + 1 }, () => new Array<number>(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) d[i][0] = i;
  for (let j = 0; j <= bl; j++) d[0][j] = j;

  for (let i = 1; i <= al; i++) {
    let rowMin = maxDist + 1;
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, d[i - 2][j - 2] + 1);
      }
      d[i][j] = val;
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > maxDist) return maxDist + 1;
  }
  return d[al][bl];
}

function looksLikeRoomQuery(q: string): string | null {
  const stripped = q
    .trim()
    .replace(/^(?:room|rm|classroom)\s+/i, '')
    .trim();
  if (/^[a-z]{1,2}[\s\-]?0?\d{1,3}[a-z]?$/i.test(stripped)) {
    return normalizeRoomCode(stripped);
  }
  return null;
}

export class CampusSearch {
  private docs: SearchDoc[] = [];

  constructor(catalog: CampusCatalog, campus: CampusData) {
    const landmarkKw = new Map(campus.landmarks.map((l) => [l.id, l.keywords]));
    const spotKw = new Map(campus.spots.map((s) => [s.id, s.keywords]));
    const bldgNotes = campus.buildings;

    for (const dest of catalog.all) {
      const keywords: string[] = [];
      const courses: string[] = [];
      const departments: string[] = [];
      const roomCodes: string[] = [];

      if (dest.roomId) {
        roomCodes.push(normalizeRoomCode(dest.roomId));
      }
      if (dest.landmarkId && landmarkKw.has(dest.landmarkId)) {
        keywords.push(...landmarkKw.get(dest.landmarkId)!);
      }
      if (dest.spotId && spotKw.has(dest.spotId)) {
        keywords.push(...spotKw.get(dest.spotId)!);
      }
      if (EXTRA_CAMPUS_ALIASES[dest.key]) {
        keywords.push(...EXTRA_CAMPUS_ALIASES[dest.key]);
      }
      if (dest.kind === 'building' && dest.buildingId) {
        keywords.push(`${dest.buildingId} wing`, `${dest.buildingId} building`, `${dest.buildingId} hall`);
      }
      if (dest.buildingId && bldgNotes[dest.buildingId]) {
        keywords.push(bldgNotes[dest.buildingId].name, bldgNotes[dest.buildingId].note);
      }
      if (dest.teacher) {
        for (const r of dest.teacher.rooms) {
          roomCodes.push(normalizeRoomCode(r));
          keywords.push(r);
        }
        departments.push(...dest.teacher.departments);
        courses.push(...Object.values(dest.teacher.periods));
      } else if (dest.teachers && dest.teachers.length > 0) {
        for (const t of dest.teachers) {
          keywords.push(t.name);
        }
      }

      const normTitle = normalizeText(dest.title);
      const titleTokens = tokenize(dest.title);
      const normRoomCode = dest.kind === 'room' ? normalizeRoomCode(dest.title) : null;

      const fullText = normalizeText(
        [dest.title, dest.subtitle, ...keywords, ...departments, ...courses].join(' ')
      );

      this.docs.push({
        dest,
        normTitle,
        normRoomCode,
        titleTokens,
        roomCodes: Array.from(new Set(roomCodes)),
        keywords: Array.from(new Set(keywords.map(normalizeText).filter(Boolean))),
        courses: courses.map(normalizeText).filter(Boolean),
        departments: departments.map(normalizeText).filter(Boolean),
        fullText,
      });
    }
  }

  search(rawQuery: string, options?: { limit?: number; near?: MapPoint }): SearchHit[] {
    const limit = options?.limit ?? 15;
    const near = options?.near;
    const trimmed = rawQuery.trim();
    if (!trimmed) return [];

    const normQuery = normalizeText(trimmed);
    const queryTokens = tokenize(trimmed);
    const roomQuery = looksLikeRoomQuery(trimmed);
    const collapsedQuery = normQuery.replace(/\s+/g, '');

    const scored: SearchHit[] = [];

    for (const doc of this.docs) {
      let score = 0;
      let matchReason: string | undefined;

      // 1. Exact room code match ("h27", "H 27", "H-27", "b08", "e9")
      if (roomQuery) {
        if (doc.normRoomCode === roomQuery) {
          score = Math.max(score, 1000);
          matchReason = 'Exact room';
        } else if (doc.dest.kind === 'teacher' && doc.roomCodes.includes(roomQuery)) {
          score = Math.max(score, 760);
          matchReason = `Teaches in ${doc.dest.badge}`;
        } else if (doc.normRoomCode && doc.normRoomCode.startsWith(roomQuery)) {
          score = Math.max(score, 540);
        } else if (doc.normRoomCode && roomQuery.length >= 2) {
          const d = damerauLevenshtein(roomQuery, doc.normRoomCode, 1);
          if (d === 1) score = Math.max(score, 420);
        }
      }

      // 2. Direct title match (exact / prefix / substring)
      const strippedQuery = queryTokens.join(' ');
      if (strippedQuery.length > 0) {
        if (doc.normTitle === strippedQuery || doc.normTitle === normQuery) {
          score = Math.max(score, doc.dest.kind === 'building' ? 900 : 965);
        } else if (doc.normTitle.startsWith(strippedQuery)) {
          score = Math.max(score, doc.dest.kind === 'building' ? 810 : 845);
        } else if (doc.normTitle.includes(strippedQuery) && strippedQuery.length >= 3) {
          score = Math.max(score, 720);
        }
      }

      // 3. Keyword exact / prefix match (spots & landmarks: "staff lounge", "bathroom", "pool", "epac")
      for (const kw of doc.keywords) {
        if (kw === strippedQuery || kw === normQuery) {
          score = Math.max(score, doc.dest.kind === 'spot' || doc.dest.kind === 'landmark' ? 950 : 680);
        } else if (strippedQuery.length >= 3 && kw.startsWith(strippedQuery)) {
          score = Math.max(score, doc.dest.kind === 'spot' || doc.dest.kind === 'landmark' ? 790 : 590);
        } else if (strippedQuery.length >= 3 && kw.includes(strippedQuery)) {
          score = Math.max(score, 620);
        } else if (collapsedQuery.length >= 4 && kw.replace(/\s+/g, '') === collapsedQuery) {
          score = Math.max(score, 890);
        }
      }

      // 4. Token-by-token scoring with typo forgiveness (Damerau-Levenshtein)
      if (queryTokens.length > 0) {
        let matchedTokens = 0;
        let tokenScoreSum = 0;
        let maxExactPrimaryTok = 0;
        let courseOrDeptHit: string | undefined;

        const allDocTokens = Array.from(
          new Set([
            ...doc.titleTokens,
            ...doc.keywords.flatMap((k) => k.split(' ')),
            ...doc.departments.flatMap((d) => d.split(' ')),
            ...doc.courses.flatMap((c) => c.split(' ')),
          ])
        ).filter(Boolean);

        for (const qt of queryTokens) {
          let bestTok = 0;

          // Check title tokens (highest weight — teacher last/first name, landmark/spot title)
          for (const tt of doc.titleTokens) {
            if (tt === qt) {
              bestTok = Math.max(bestTok, 300);
              if (qt.length >= 3) maxExactPrimaryTok = Math.max(maxExactPrimaryTok, 300);
            } else if (tt.startsWith(qt) && qt.length >= 2) {
              bestTok = Math.max(bestTok, 240);
            } else if (qt.length >= 4) {
              const maxErr = qt.length >= 7 ? 2 : 1;
              const dist = damerauLevenshtein(qt, tt, maxErr);
              if (dist <= maxErr) {
                bestTok = Math.max(bestTok, dist === 1 ? 205 : 155);
              }
            }
          }

          // Check keywords
          if (bestTok < 240) {
            for (const kw of doc.keywords) {
              for (const kt of kw.split(' ')) {
                if (kt === qt) {
                  bestTok = Math.max(bestTok, 235);
                  if (qt.length >= 3 && (doc.dest.kind === 'landmark' || doc.dest.kind === 'spot')) {
                    maxExactPrimaryTok = Math.max(maxExactPrimaryTok, 235);
                  }
                } else if (kt.startsWith(qt) && qt.length >= 3) {
                  bestTok = Math.max(bestTok, 195);
                } else if (qt.length >= 4) {
                  const maxErr = qt.length >= 7 ? 2 : 1;
                  const dist = damerauLevenshtein(qt, kt, maxErr);
                  if (dist <= maxErr) {
                    bestTok = Math.max(bestTok, dist === 1 ? 165 : 120);
                  }
                }
              }
            }
          }

          // Check departments & courses (for teachers)
          if (bestTok < 210 && doc.dest.kind === 'teacher') {
            for (const dept of doc.departments) {
              const dToks = dept.split(' ');
              for (const dt of dToks) {
                if (dt === qt) {
                  bestTok = Math.max(bestTok, 200);
                  courseOrDeptHit = doc.dest.teacher?.departments.find((x) => normalizeText(x) === dept);
                } else if (dt.startsWith(qt) && qt.length >= 3) {
                  bestTok = Math.max(bestTok, 170);
                  courseOrDeptHit = doc.dest.teacher?.departments.find((x) => normalizeText(x) === dept);
                } else if (qt.length >= 4 && damerauLevenshtein(qt, dt, 1) <= 1) {
                  bestTok = Math.max(bestTok, 145);
                  courseOrDeptHit = doc.dest.teacher?.departments.find((x) => normalizeText(x) === dept);
                }
              }
            }
            for (const course of doc.courses) {
              for (const ct of course.split(' ')) {
                if (ct === qt) {
                  bestTok = Math.max(bestTok, 210);
                  const orig = Object.values(doc.dest.teacher?.periods ?? {}).find(
                    (x) => normalizeText(x) === course
                  );
                  if (orig) courseOrDeptHit = orig;
                } else if (ct.startsWith(qt) && qt.length >= 3) {
                  bestTok = Math.max(bestTok, 175);
                  const orig = Object.values(doc.dest.teacher?.periods ?? {}).find(
                    (x) => normalizeText(x) === course
                  );
                  if (orig) courseOrDeptHit = orig;
                } else if (qt.length >= 5) {
                  const maxErr = qt.length >= 7 ? 2 : 1;
                  const dist = damerauLevenshtein(qt, ct, maxErr);
                  if (dist <= maxErr) {
                    bestTok = Math.max(bestTok, dist === 1 ? 150 : 115);
                    const orig = Object.values(doc.dest.teacher?.periods ?? {}).find(
                      (x) => normalizeText(x) === course
                    );
                    if (orig) courseOrDeptHit = orig;
                  }
                }
              }
            }
          }

          // Fallback fuzzy check across collapsed full tokens if nothing hit yet
          if (bestTok === 0 && qt.length >= 5) {
            for (const dt of allDocTokens) {
              if (dt.length >= 4 && damerauLevenshtein(qt, dt, 1) === 1) {
                bestTok = 110;
                break;
              }
            }
          }

          if (bestTok > 0) {
            matchedTokens++;
            tokenScoreSum += bestTok;
          }
        }

        if (matchedTokens === queryTokens.length) {
          const avg = tokenScoreSum / queryTokens.length;
          const multiBonus = queryTokens.length > 1 ? 85 : 0;
          const combined = avg * 2.4 + multiBonus;
          if (combined > score) {
            score = combined;
            if (courseOrDeptHit && !matchReason) {
              matchReason = courseOrDeptHit;
            }
          }
        } else if (queryTokens.length > 1 && matchedTokens > 0) {
          const ratio = matchedTokens / queryTokens.length;
          let partial = (tokenScoreSum / queryTokens.length) * 1.4 * ratio;
          // Don't crush an exact hit on a distinctive landmark/title token just because extra conversational words came along
          if (maxExactPrimaryTok >= 235) {
            partial = Math.max(partial, maxExactPrimaryTok * 1.25 + ratio * 90);
          }
          if (partial >= 140 && partial > score) {
            score = partial;
            if (courseOrDeptHit && !matchReason) {
              matchReason = courseOrDeptHit;
            }
          }
        }
      }

      // 5. Whole-phrase fuzzy match for smashed/misspelled phrases ("staf loung", "cafiteria", "libary")
      if (score < 320 && strippedQuery.length >= 5) {
        const maxErr = strippedQuery.length >= 8 ? 2 : 1;
        const dTitle = damerauLevenshtein(strippedQuery, doc.normTitle, maxErr);
        if (dTitle <= maxErr) {
          score = Math.max(score, dTitle === 1 ? 560 : 410);
        }
        for (const kw of doc.keywords) {
          if (Math.abs(kw.length - strippedQuery.length) <= maxErr) {
            const dKw = damerauLevenshtein(strippedQuery, kw, maxErr);
            if (dKw <= maxErr) {
              score = Math.max(score, dKw === 1 ? 520 : 380);
            }
          }
        }
      }

      if (score >= 220) {
        if (near) {
          const distMap = Math.hypot(doc.dest.x - near.x, doc.dest.y - near.y);
          const proxBoost = Math.max(0, 18 - distMap / 45);
          score += proxBoost;
        }
        if (doc.dest.kind === 'landmark') score += 8;
        else if (doc.dest.kind === 'spot') score += 5;
        else if (doc.dest.kind === 'room') score += 4;

        scored.push({
          destination: doc.dest,
          score,
          matchReason,
        });
      }
    }

    scored.sort((a, b) => {
      if (Math.abs(b.score - a.score) > 0.5) return b.score - a.score;
      return a.destination.title.localeCompare(b.destination.title);
    });

    return scored.slice(0, limit);
  }
}
