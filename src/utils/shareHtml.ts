import {
  ETATS,
  INASEP_LOGO_DATA_URL,
  SECTION_LABELS,
  type Chantier,
  type Journal,
} from '../types';
import {
  cleanChantierRef,
  dayNameFR,
  escHtml,
  fmtDateFR,
  todayISO,
  weekKey,
  weekRangeLabel,
} from './dates';
import { downloadBlob } from './storage';

function renderSheetHTML(ch: Chantier, j: Journal): string {
  const ouvriers = (j.ouvriers || []).filter(
    (o) => o.firme || o.metier || (o.nbre && o.nbre > 0)
  );
  const totalOuv = ouvriers.reduce((s, o) => s + (Number(o.nbre) || 0), 0);

  const renderList = (arr: string[]) => {
    const items = (arr || []).map((x) => x.trim()).filter(Boolean);
    if (!items.length) return '<div class="empty">Néant</div>';
    return `<ul class="lines-list">${items.map((x) => `<li>${escHtml(x)}</li>`).join('')}</ul>`;
  };

  const etatHtml = ETATS.map((e) => {
    const on = (j.etatAtmo || []).includes(e);
    return `<span style="margin-right:10px;white-space:nowrap">${on ? '☑' : '☐'} ${escHtml(e)}</span>`;
  }).join('');

  return `
  <div class="sheet">
    <table class="header-table">
      <tr>
        <td style="width:185px"><img class="logo" src="${INASEP_LOGO_DATA_URL}" alt="INASEP"></td>
        <td>
          <div style="font-size:10.5pt;font-weight:700">INASEP</div>
          <div style="font-size:8.5pt;color:#333">Intercommunale Namuroise de Services Publics</div>
          <div style="font-size:8.5pt;color:#333">Direction de l'Assainissement / Infrastructures</div>
        </td>
        <td style="width:155px;text-align:right">
          <div style="font-size:8pt;color:#444">JOURNAL N°</div>
          <div style="font-size:15pt;font-weight:700">${escHtml(j.journalNum ?? '')}</div>
          <div style="font-size:8.5pt">${escHtml(dayNameFR(j.date))} ${escHtml(fmtDateFR(j.date))}</div>
        </td>
      </tr>
    </table>
    <div class="doc-title">JOURNAL DES TRAVAUX</div>
    <div class="info-grid">
      <div class="info-box">
        <div class="info-row"><span class="label">N° de chantier :</span><span class="val">${escHtml(ch.numero || '—')}</span></div>
        <div class="info-row"><span class="label">Projet :</span><span class="val">${escHtml(ch.projet || '—')}</span></div>
        <div class="info-row"><span class="label">Références :</span><span class="val">${escHtml(ch.references || '—')}</span></div>
        <div class="info-row"><span class="label">Adresse chantier :</span><span class="val">${escHtml((ch.adresseChantier || '—').replace(/\n/g, ', '))}</span></div>
      </div>
      <div class="info-box">
        <div class="info-row"><span class="label">Entrepreneur :</span><span class="val">${escHtml(ch.entrepriseNom || '—')}</span></div>
        <div class="info-row"><span class="label">Adresse :</span><span class="val">${escHtml((ch.entrepriseAdresse || '—').replace(/\n/g, ', '))}</span></div>
        <div class="info-row"><span class="label">Surveillance :</span><span class="val">${escHtml(ch.preposeSurveillance || '—')}</span></div>
        <div class="info-row"><span class="label">Horaire chantier :</span><span class="val">${escHtml(j.horaireDebut || ch.horaireDebut || '—')} – ${escHtml(j.horaireFin || ch.horaireFin || '—')}</span></div>
      </div>
    </div>
    <table class="meta-table">
      <tr>
        <th style="width:20%">Température 8h00</th><td style="width:30%">${j.tempMatin ? `${escHtml(j.tempMatin)} °C` : '—'}</td>
        <th style="width:20%">Température 16h15</th><td style="width:30%">${j.tempApresMidi ? `${escHtml(j.tempApresMidi)} °C` : '—'}</td>
      </tr>
      <tr><th>État atmosphérique</th><td colspan="3">${etatHtml}</td></tr>
    </table>
    <div class="section">
      <div class="section-title">A. ${SECTION_LABELS.A}</div>
      <div class="section-body">
        ${
          ouvriers.length
            ? `<table class="workers-table">
                <thead><tr><th>Firme</th><th>Métier / Qualification</th><th class="num">Nbre</th></tr></thead>
                <tbody>
                  ${ouvriers.map((o) => `<tr><td>${escHtml(o.firme || '—')}</td><td>${escHtml(o.metier || '—')}</td><td class="num">${escHtml(o.nbre || 0)}</td></tr>`).join('')}
                  <tr class="total"><td colspan="2">Total ouvriers présents</td><td class="num">${totalOuv}</td></tr>
                </tbody>
              </table>`
            : '<div class="empty">Néant</div>'
        }
      </div>
    </div>
    <div class="section"><div class="section-title">B. ${SECTION_LABELS.B}</div><div class="section-body">${renderList(j.travaux)}</div></div>
    <div class="section"><div class="section-title">C. ${SECTION_LABELS.C}</div><div class="section-body">${renderList(j.materiel)}</div></div>
    <div class="section"><div class="section-title">E. ${SECTION_LABELS.E}</div><div class="section-body">${renderList(j.materiaux)}</div></div>
    <div class="section"><div class="section-title">F. ${SECTION_LABELS.F}</div><div class="section-body">${renderList(j.essais)}</div></div>
    <div class="section"><div class="section-title">H. ${SECTION_LABELS.H}</div><div class="section-body">${renderList(j.evenements)}</div></div>
    <div class="section"><div class="section-title">J. ${SECTION_LABELS.J}</div><div class="section-body">${renderList(j.decisions)}</div></div>
    <div class="section"><div class="section-title">K. ${SECTION_LABELS.K}</div><div class="section-body">${renderList(j.visites)}</div></div>
    <div class="sign-box">
      <div class="sign-cell">
        <div class="sign-label">Le préposé à la surveillance</div>
        <div class="sign-text">${escHtml(ch.preposeSurveillance || '')}</div>
      </div>
      <div class="sign-cell">
        <div class="sign-label">L'entrepreneur</div>
        <div class="sign-text">${escHtml(j.sigEntrepreneur || '')}</div>
      </div>
    </div>
  </div>`;
}

export function exportShareableHTML(ch: Chantier, journaux: Journal[]): string {
  const list = journaux
    .filter((j) => j.chantierId === ch.id)
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.journalNum - b.journalNum);

  const byWeek: Record<string, Journal[]> = {};
  for (const j of list) {
    const wk = weekKey(j.date);
    if (!byWeek[wk]) byWeek[wk] = [];
    byWeek[wk].push(j);
  }
  const weeks = Object.keys(byWeek).sort();

  const weekBlocks = weeks
    .map(
      (wk) => `
      <div class="week-block" id="wk-${escHtml(wk)}">
        <div class="week-banner">${escHtml(weekRangeLabel(wk))} — ${byWeek[wk].length} journal(aux)</div>
        ${byWeek[wk].map((j) => renderSheetHTML(ch, j)).join('')}
      </div>`
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Journal des travaux — ${escHtml(ch.numero || '')} ${escHtml(ch.projet || '')}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; margin: 0; background: #eef2f6; color: #000; }
  .nav { background: #0a5b9c; color: #fff; padding: 12px 18px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 10; box-shadow: 0 2px 6px rgba(0,0,0,.18); }
  .nav-title { font-weight: 700; font-size: 14px; }
  .nav-sub { font-size: 12px; opacity: .85; }
  .nav-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .printbtn { background: #d9d61f; color: #000; border: 0; padding: 8px 14px; border-radius: 7px; font-weight: 700; cursor: pointer; font-size: 13px; }
  .week-banner { max-width: 210mm; margin: 18px auto 8px; padding: 9px 14px; background: #0a5b9c; color: #fff; font-weight: 700; font-size: 13px; border-radius: 6px; }
  .sheet { width: 210mm; min-height: 297mm; margin: 0 auto 18px; background: #fff; padding: 9mm; box-sizing: border-box; box-shadow: 0 2px 10px rgba(0,0,0,.12); font-size: 9pt; line-height: 1.25; }
  .header-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  .header-table td { border: 1px solid #000; padding: 5px 8px; vertical-align: middle; }
  .logo { max-width: 155px; max-height: 52px; }
  .doc-title { font-size: 16pt; font-weight: 700; text-align: center; margin: 4px 0 8px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; font-size: 8.5pt; }
  .info-box { border: 1px solid #000; padding: 5px 8px; }
  .info-row { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 2px; }
  .info-row .label { font-weight: 700; white-space: nowrap; }
  .info-row .val { text-align: right; word-break: break-word; }
  .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 8.5pt; }
  .meta-table td, .meta-table th { border: 1px solid #000; padding: 3px 6px; }
  .meta-table th { background: #e9eef5; text-align: left; }
  .section { border: 1px solid #000; margin-bottom: 6px; }
  .section-title { background: #e9eef5; border-bottom: 1px solid #000; padding: 3px 7px; font-weight: 700; font-size: 8.5pt; }
  .section-body { padding: 4px 7px; min-height: 18px; }
  .workers-table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  .workers-table th, .workers-table td { border-bottom: 1px solid #ccc; padding: 2px 5px; text-align: left; }
  .workers-table th { border-bottom: 1px solid #000; background: #f5f7fa; }
  .workers-table td.num, .workers-table th.num { text-align: right; width: 55px; }
  .workers-table tr.total td { border-top: 1px solid #000; border-bottom: none; font-weight: 700; background: #f5f7fa; }
  .lines-list { margin: 0; padding-left: 14px; }
  .empty { color: #888; font-style: italic; }
  .sign-box { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px; }
  .sign-cell { border: 1px solid #000; padding: 5px 8px; min-height: 54px; font-size: 8.5pt; }
  .sign-label { font-weight: 700; margin-bottom: 6px; }
  .sign-text { font-size: 10pt; font-weight: 600; padding: 4px 2px; }
  @media (max-width: 820px) {
    .sheet { width: 100%; min-height: auto; padding: 12px; margin: 0 0 12px; }
    .week-banner { margin: 12px 8px 6px; }
    .info-grid, .sign-box { grid-template-columns: 1fr; }
  }
  @media print {
    @page { size: A4 portrait; margin: 9mm; }
    body { background: #fff; }
    .nav, .week-banner { display: none; }
    .sheet { width: auto; min-height: 0; padding: 0; margin: 0; box-shadow: none; page-break-after: always; }
    .sheet:last-child { page-break-after: auto; }
  }
</style>
</head>
<body>
<div class="nav">
  <div>
    <div class="nav-title">${escHtml(ch.numero || 'Chantier')} — ${escHtml(ch.projet || '')}</div>
    <div class="nav-sub">Consultation seule · ${list.length} journal(aux) · généré le ${fmtDateFR(todayISO())} · F. Pirquin</div>
  </div>
  <div class="nav-actions">
    <button class="printbtn" onclick="window.print()">Imprimer / PDF</button>
  </div>
</div>
${weekBlocks || '<p style="text-align:center;padding:40px">Aucun journal enregistré pour ce chantier.</p>'}
</body>
</html>`;

  const filename = `Fiche-${cleanChantierRef(ch)}_${todayISO().replace(/-/g, '')}.html`;
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), filename);
  return filename;
}
