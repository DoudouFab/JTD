import type { Chantier, Journal } from '../types';

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtDateFR(iso?: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export function fmtDateJJMMAA(iso?: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y.slice(-2)}`;
}

export function fmtDateJJMM(iso?: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}`;
}

export function getChantierDisplayTitle(
  ch?: Pick<Chantier, 'pseudo' | 'projet' | 'numero'> | null
): string {
  if (!ch) return 'Projet sans titre';
  const pseudo = (ch.pseudo || '').trim();
  if (pseudo) return pseudo;
  const projet = (ch.projet || '').trim();
  if (projet) return projet;
  const numero = (ch.numero || '').trim();
  return numero || 'Projet sans titre';
}

export function fmtDateShortDash(iso?: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}-${m}-${y.slice(-2)}`;
}

export function fmtHourFR(time?: string): string {
  if (!time) return '';
  const trimmed = time.trim();
  const match = /^0?(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) return trimmed;
  return `${match[1]}h${match[2]}`;
}

const DAYS_FR = [
  'Dimanche',
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
];

export function dayNameFR(iso?: string): string {
  if (!iso) return '';
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return '';
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d);
  return DAYS_FR[dt.getDay()] ?? '';
}

export function getISOWeek(iso: string): { year: number; week: number } {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: dt.getUTCFullYear(), week };
}

export function weekKey(iso?: string): string {
  if (!iso) return '0000-W00';
  const { year, week } = getISOWeek(iso);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function weekRangeLabel(key: string): string {
  const [yr, wkStr] = key.split('-W');
  const year = Number(yr);
  const week = Number(wkStr);
  if (!year || !week) return key;

  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const mon = new Date(jan4.getTime() + ((week - 1) * 7 - (day - 1)) * 86400000);
  const sun = new Date(mon.getTime() + 6 * 86400000);

  const f = (dt: Date) =>
    `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;

  return `Semaine ${week} (${f(mon)} → ${f(sun)})`;
}

export function cleanChantierRef(ch: Chantier): string {
  return (ch.references || ch.numero || 'Chantier')
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim();
}

export function formatShortDateForFile(iso?: string): string {
  const parts = (iso || todayISO()).split('-');
  const yy = (parts[0] || '2026').slice(-2);
  const mm = parts[1] || '01';
  const dd = parts[2] || '01';
  return `${yy}.${mm}.${dd}`;
}

export function buildDailyFilename(ch: Chantier, j: Journal): string {
  return `${formatShortDateForFile(j.date)}.${cleanChantierRef(ch)}.pdf`;
}

export function buildWeeklyFilename(ch: Chantier, weekJournals: Journal[]): string {
  const sorted = [...weekJournals].sort((a, b) =>
    (a.date || '').localeCompare(b.date || '')
  );
  const lastDate = sorted.length
    ? sorted[sorted.length - 1].date
    : todayISO();
  return `${formatShortDateForFile(lastDate)}.${cleanChantierRef(ch)}_semaine.pdf`;
}

export function escHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
