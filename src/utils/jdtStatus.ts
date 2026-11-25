import type { Chantier, ChantierJdtStatus, Journal, StandbyPeriod } from '../types';
import { fmtDateFR, todayISO } from './dates';

export interface ChantierJdtSummary {
  effectiveStatus: ChantierJdtStatus;
  hasOpenJdt: boolean;
  journalCount: number;
  completedCount: number;
  inProgressCount: number;
  missingWorkdaysCount: number;
  remainingToValidateCount: number;
  todayJournal: Journal | null;
  todayCompleted: boolean;
  latestJournal: Journal | null;
}

export function addDaysISO(iso: string, deltaDays: number): string {
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return iso;
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + deltaDays));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function isWeekendISO(iso: string): boolean {
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return false;
  const day = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
  return day === 0 || day === 6;
}

export function isDateInStandbyPeriods(
  iso: string,
  periods?: StandbyPeriod[]
): boolean {
  if (!iso || !periods?.length) return false;
  return periods.some((p) => {
    if (!p.startDate || !p.endDate) return false;
    return iso >= p.startDate && iso <= p.endDate;
  });
}

export function formatStandbyLine(
  startDate: string,
  endDate: string,
  note?: string
): string {
  const base = `Chantier staté du ${fmtDateFR(startDate)} au ${fmtDateFR(endDate)}`;
  const cleanNote = (note || '').trim();
  return cleanNote ? `${base} (${cleanNote})` : base;
}

export function computeChantierJdtSummary(
  chantier: Chantier,
  journals: Journal[],
  today = todayISO()
): ChantierJdtSummary {
  const effectiveStatus: ChantierJdtStatus =
    chantier.jdtStatus === 'archived'
      ? 'archived'
      : chantier.jdtStatus === 'standby'
        ? 'standby'
        : 'active';

  const sortedAsc = [...journals].sort(
    (a, b) =>
      (a.date || '').localeCompare(b.date || '') ||
      (a.journalNum || 0) - (b.journalNum || 0)
  );
  const latestJournal =
    sortedAsc.length > 0 ? sortedAsc[sortedAsc.length - 1] : null;

  const todayMatches = sortedAsc.filter((j) => j.date === today);
  const todayJournal =
    todayMatches.length > 0 ? todayMatches[todayMatches.length - 1] : null;
  const todayCompleted = Boolean(
    todayMatches.length > 0 &&
      todayMatches.every((j) => j.status === 'completed')
  );

  const completedCount = sortedAsc.filter(
    (j) => j.status === 'completed'
  ).length;
  const inProgressCount = sortedAsc.length - completedCount;

  let missingWorkdaysCount = 0;
  if (effectiveStatus === 'active' && sortedAsc.length > 0) {
    const existingDates = new Set(sortedAsc.map((j) => j.date).filter(Boolean));
    const firstMissingStart = latestJournal?.date
      ? addDaysISO(latestJournal.date, 1)
      : today;

    let cursor = firstMissingStart;
    let safety = 0;
    while (cursor <= today && safety < 180) {
      safety += 1;
      if (
        !isWeekendISO(cursor) &&
        !existingDates.has(cursor) &&
        !isDateInStandbyPeriods(cursor, chantier.standbyPeriods)
      ) {
        missingWorkdaysCount += 1;
      }
      cursor = addDaysISO(cursor, 1);
    }
  }

  const remainingToValidateCount =
    effectiveStatus === 'active' && sortedAsc.length > 0
      ? inProgressCount + missingWorkdaysCount
      : 0;

  return {
    effectiveStatus,
    hasOpenJdt: sortedAsc.length > 0 || effectiveStatus === 'standby',
    journalCount: sortedAsc.length,
    completedCount,
    inProgressCount,
    missingWorkdaysCount,
    remainingToValidateCount,
    todayJournal,
    todayCompleted,
    latestJournal,
  };
}
