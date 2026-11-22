import type { BellPeriod, BellSchedule, BellScheduleFile } from '../types';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface BellStatus {
  scheduleName: string;
  activePeriod: BellPeriod | null;
  activePeriodNumber: string | null; // "1".."5" if in a numbered period
  nextPeriod: BellPeriod | null;
  minutesRemaining: number | null;
  isSchoolDay: boolean;
}

export function formatMinutesOfDay(mins: number): string {
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function extractPeriodNumber(periodName: string): string | null {
  const m = periodName.match(/Period\s+(\d+)/i);
  return m ? m[1] : null;
}

export function getCurrentBellStatus(
  bellData: BellScheduleFile,
  now: Date = new Date()
): BellStatus {
  const dayName = WEEKDAYS[now.getDay()];
  const scheduleKey = bellData.dayToSchedule[dayName];
  if (!scheduleKey || !bellData.schedules[scheduleKey]) {
    return {
      scheduleName: dayName,
      activePeriod: null,
      activePeriodNumber: null,
      nextPeriod: null,
      minutesRemaining: null,
      isSchoolDay: false,
    };
  }

  const schedule: BellSchedule = bellData.schedules[scheduleKey];
  const mins = now.getHours() * 60 + now.getMinutes();

  for (let i = 0; i < schedule.periods.length; i++) {
    const p = schedule.periods[i];
    if (mins >= p.s && mins < p.e) {
      return {
        scheduleName: schedule.name,
        activePeriod: p,
        activePeriodNumber: extractPeriodNumber(p.n),
        nextPeriod: schedule.periods[i + 1] ?? null,
        minutesRemaining: p.e - mins,
        isSchoolDay: true,
      };
    }
    if (mins < p.s) {
      return {
        scheduleName: schedule.name,
        activePeriod: null,
        activePeriodNumber: null,
        nextPeriod: p,
        minutesRemaining: p.s - mins,
        isSchoolDay: true,
      };
    }
  }

  return {
    scheduleName: schedule.name,
    activePeriod: null,
    activePeriodNumber: null,
    nextPeriod: null,
    minutesRemaining: null,
    isSchoolDay: true,
  };
}
