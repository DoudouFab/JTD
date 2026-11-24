import {
  INASEP_LOGO_DATA_URL,
  type Chantier,
  type Journal,
  type Ouvrier,
} from '../types';
import {
  cleanChantierRef,
  escHtml,
  fmtDateFR,
  fmtDateShortDash,
  fmtHourFR,
  todayISO,
  weekKey,
  weekRangeLabel,
} from './dates';
import { downloadBlob } from './storage';

function cleanList(items: string[] | undefined): string[] {
  return (items || []).map((x) => x.trim()).filter(Boolean);
}

function parseMaterielLine(raw: string): { qty: string; text: string } {
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*[x×]?\s+(.+)$/i.exec(raw);
  if (match) {
    return { qty: match[1], text: match[2].trim() };
  }
  return { qty: '', text: raw };
}

interface WorkerRowMeta {
  firme: string;
  metier: string;
  nbre: number | string;
  firmeRowSpan: number; // 0 = covered by previous rowSpan
}

function buildWorkerRows(ouvriers: Ouvrier[]): WorkerRowMeta[] {
  const valid = (ouvriers || []).filter(
    (o) => o.firme?.trim() || o.metier?.trim() || (o.nbre && o.nbre > 0)
  );
  const result: WorkerRowMeta[] = valid.map((o) => ({
    firme: (o.firme || '').trim(),
    metier: (o.metier || '').trim(),
    nbre: o.nbre ?? '',
    firmeRowSpan: 1,
  }));

  let i = 0;
  while (i < result.length) {
    const f = result[i].firme;
    if (!f) {
      i += 1;
      continue;
    }
    let span = 1;
    while (
      i + span < result.length &&
      result[i + span].firme.toLowerCase() === f.toLowerCase()
    ) {
      result[i + span].firmeRowSpan = 0;
      span += 1;
    }
    result[i].firmeRowSpan = span;
    i += span;
  }

  return result;
}

function renderSheetHTML(ch: Chantier, j: Journal): string {
  const workerRows = buildWorkerRows(j.ouvriers || []);
  const totalOuvriers = (j.ouvriers || []).reduce(
    (s, o) => s + (Number(o.nbre) || 0),
    0
  );

  const travauxLines = cleanList(j.travaux);
  const materielLines = cleanList(j.materiel).map(parseMaterielLine);
  const materiauxLines = cleanList(j.materiaux);
  const essaisLines = cleanList(j.essais);
  const evenementsLines = cleanList(j.evenements);
  const decisionsLines = cleanList(j.decisions);
  const visitesLines = cleanList(j.visites);

  const abMiddleRows = Math.max(
    18,
    workerRows.length + 1,
    travauxLines.length - 1
  );
  const ceRows = Math.max(8, materielLines.length, materiauxLines.length);
  const fRows = Math.max(5, essaisLines.length);
  const hRows = Math.max(5, evenementsLines.length);
  const jkRows = Math.max(4, decisionsLines.length, visitesLines.length);

  const etatText = (j.etatAtmo || [])
    .map((x) => x.trim())
    .filter(Boolean)
    .join(', ');

  const hDebut = fmtHourFR(j.horaireDebut || ch.horaireDebut);
  const hFin = fmtHourFR(j.horaireFin || ch.horaireFin);

  const supervisorName =
    j.signatureControleur?.signerName || ch.preposeSurveillance || '';

  const abRowsHtml = Array.from({ length: abMiddleRows - 1 })
    .map((_, idx) => {
      const worker = workerRows[idx];
      const bLine = travauxLines[idx + 1] || '';

      let aCellsHtml = '';
      if (worker) {
        const firmeCell =
          worker.firmeRowSpan > 0
            ? `<td colspan="1" rowspan="${worker.firmeRowSpan}" style="text-align:center;font-size:6.8pt">${escHtml(worker.firme)}</td>`
            : '';
        aCellsHtml = `${firmeCell}<td colspan="2">${escHtml(worker.metier)}</td><td colspan="1" class="a4-divider-ab" style="text-align:center">${escHtml(worker.nbre)}</td>`;
      } else {
        aCellsHtml = `<td colspan="1"></td><td colspan="2"></td><td colspan="1" class="a4-divider-ab"></td>`;
      }

      return `<tr class="a4-grid-row">${aCellsHtml}<td colspan="5">${escHtml(bLine)}</td></tr>`;
    })
    .join('');

  const ceRowsHtml = Array.from({ length: ceRows })
    .map((_, idx) => {
      const mat = materielLines[idx];
      const matx = materiauxLines[idx] || '';
      return `<tr class="a4-grid-row">
        <td colspan="2" style="text-align:right;padding-right:5px">${escHtml(mat?.qty || '')}</td>
        <td colspan="5" class="a4-divider-ce">${escHtml(mat?.text || '')}</td>
        <td colspan="2">${escHtml(matx)}</td>
      </tr>`;
    })
    .join('');

  const fRowsHtml = Array.from({ length: fRows })
    .map(
      (_, idx) => `<tr class="a4-grid-row">
        <td colspan="7" class="a4-divider-ce">${escHtml(essaisLines[idx] || '')}</td>
        <td colspan="2"></td>
      </tr>`
    )
    .join('');

  const hRowsHtml = Array.from({ length: hRows })
    .map(
      (_, idx) => `<tr class="a4-grid-row">
        <td colspan="7" class="a4-divider-ce">${escHtml(evenementsLines[idx] || '')}</td>
        <td colspan="2"></td>
      </tr>`
    )
    .join('');

  const jkRowsHtml = Array.from({ length: jkRows })
    .map(
      (_, idx) => `<tr class="a4-grid-row">
        <td colspan="5" class="a4-divider-ce">${escHtml(decisionsLines[idx] || '')}</td>
        <td colspan="4">${escHtml(visitesLines[idx] || '')}</td>
      </tr>`
    )
    .join('');

  const sigControleurMetaHtml = j.signatureControleur
    ? `<div class="a4-sign-meta">
        <div>Le ${escHtml(new Date(j.signatureControleur.signedAt).toLocaleString('fr-BE'))}</div>
        <div class="a4-sign-mono">Réf. ${escHtml(j.signatureControleur.verificationId)}</div>
        <div class="a4-sign-hash">SHA-256 : ${escHtml(j.signatureControleur.documentSha256)}</div>
      </div>`
    : '';

  const sigLecteurHtml = j.signatureLecteur
    ? `<div class="a4-sign-name">${escHtml(j.signatureLecteur.signerName)}</div>
      <div class="a4-sign-meta">
        <div>Le ${escHtml(new Date(j.signatureLecteur.signedAt).toLocaleString('fr-BE'))}</div>
        <div class="a4-sign-mono">Réf. ${escHtml(j.signatureLecteur.verificationId)}</div>
        <div class="a4-sign-hash">SHA-256 : ${escHtml(j.signatureLecteur.documentSha256)}</div>
      </div>`
    : `<div class="a4-sign-name">${escHtml(j.sigEntrepreneur || '')}</div>`;

  return `
  <div class="a4-sheet">
    <table class="a4-master-table">
      <colgroup>
        <col style="width:9%">
        <col style="width:3.5%">
        <col style="width:9.5%">
        <col style="width:5.5%">
        <col style="width:11%">
        <col style="width:5.5%">
        <col style="width:19%">
        <col style="width:7.5%">
        <col style="width:29.5%">
      </colgroup>
      <tbody>
        <tr>
          <td colspan="4" class="a4-left-header-wrap">
            <table class="a4-inner-table">
              <tbody>
                <tr>
                  <td class="a4-logo-box"><img class="a4-logo" src="${INASEP_LOGO_DATA_URL}" alt="INASEP"></td>
                </tr>
                <tr>
                  <td class="a4-project-box">${escHtml(ch.projet || '—')}</td>
                </tr>
                <tr>
                  <td class="a4-company-box">
                    <div style="margin-bottom:7px">${escHtml(ch.entrepriseNom || '')}</div>
                    <div style="white-space:pre-line">${escHtml(ch.entrepriseAdresse || '')}</div>
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
          <td colspan="5" class="a4-right-header-wrap">
            <table class="a4-inner-table a4-inner-right">
              <colgroup>
                <col style="width:15.2%">
                <col style="width:27.6%">
                <col style="width:21.5%">
                <col style="width:9.5%">
                <col style="width:9.2%">
                <col style="width:17%">
              </colgroup>
              <tbody>
                <tr style="height:19px">
                  <td class="a4-hdr-lbl">N° de chantier</td>
                  <td class="a4-hdr-val">${escHtml(ch.numero || '')}</td>
                  <td class="a4-hdr-lbl">Journal n° :</td>
                  <td class="a4-hdr-val">${escHtml(j.journalNum ?? '')}</td>
                  <td class="a4-hdr-lbl">Date:</td>
                  <td class="a4-hdr-val">${escHtml(fmtDateShortDash(j.date))}</td>
                </tr>
                <tr style="height:19px">
                  <td class="a4-hdr-lbl"></td>
                  <td class="a4-hdr-val"></td>
                  <td class="a4-hdr-lbl" style="text-align:right">Horaires de travail de:</td>
                  <td class="a4-hdr-val">${escHtml(hDebut)}</td>
                  <td class="a4-hdr-lbl">à:</td>
                  <td class="a4-hdr-val">${escHtml(hFin)}</td>
                </tr>
                <tr style="height:19px">
                  <td class="a4-hdr-lbl">Références :</td>
                  <td class="a4-hdr-val">${escHtml(ch.references || '')}</td>
                  <td class="a4-hdr-lbl">Température (en°C) à 8h00:</td>
                  <td class="a4-hdr-val">${escHtml(j.tempMatin || '')}</td>
                  <td class="a4-hdr-lbl">à 16h15 :</td>
                  <td class="a4-hdr-val">${escHtml(j.tempApresMidi || '')}</td>
                </tr>
                <tr style="height:19px">
                  <td class="a4-hdr-lbl">Adresse chantier:</td>
                  <td colspan="5" class="a4-hdr-val">${escHtml((ch.adresseChantier || '').replace(/\n/g, ', '))}</td>
                </tr>
                <tr>
                  <td colspan="6" style="vertical-align:top;padding:5px 8px;height:78px;font-size:7.5pt;line-height:1.35">
                    <span>Etat atmosphérique :</span>
                    ${etatText ? `<span style="margin-left:4px">${escHtml(etatText)}</span>` : ''}
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>

        <tr class="a4-sec-bar">
          <td colspan="1" class="a4-sec-letter">A</td>
          <td colspan="3" class="a4-divider-ab">OUVRIERS</td>
          <td colspan="1" class="a4-sec-letter">B</td>
          <td colspan="4" class="a4-sec-title-left">TRAVAUX EXECUTES</td>
        </tr>

        <tr class="a4-grid-row">
          <td colspan="1" class="a4-subhead-cell">Firme</td>
          <td colspan="2" class="a4-subhead-cell">Métiers</td>
          <td colspan="1" class="a4-subhead-cell a4-divider-ab">Nbre</td>
          <td colspan="5">${escHtml(travauxLines[0] || '')}</td>
        </tr>

        ${abRowsHtml}

        <tr class="a4-grid-row">
          <td colspan="1"></td>
          <td colspan="2" class="a4-total-cell">TOTAL</td>
          <td colspan="1" class="a4-total-cell a4-divider-ab">${totalOuvriers || ''}</td>
          <td colspan="5">${escHtml(travauxLines[abMiddleRows] || '')}</td>
        </tr>

        <tr class="a4-sec-bar">
          <td colspan="2" class="a4-sec-letter">C</td>
          <td colspan="5" class="a4-divider-ce">MATERIEL EN SERVICE</td>
          <td colspan="1" class="a4-sec-letter">E</td>
          <td colspan="1">MATERIAUX ENTRES CE JOUR</td>
        </tr>

        ${ceRowsHtml}

        <tr class="a4-sec-bar">
          <td colspan="2" class="a4-sec-letter">F</td>
          <td colspan="5" class="a4-divider-ce">ESSAIS SUR CHANTIER</td>
          <td colspan="2"></td>
        </tr>

        ${fRowsHtml}

        <tr class="a4-sec-bar">
          <td colspan="2" class="a4-sec-letter">H</td>
          <td colspan="5" class="a4-divider-ce">EVENEMENTS IMPREVUS</td>
          <td colspan="2"></td>
        </tr>

        ${hRowsHtml}

        <tr class="a4-sec-bar">
          <td colspan="2" class="a4-sec-letter">J</td>
          <td colspan="3" class="a4-divider-ce">DECISION PRISES</td>
          <td colspan="1" class="a4-sec-letter">K</td>
          <td colspan="3">VISITE DIVERS</td>
        </tr>

        ${jkRowsHtml}

        <tr class="a4-sign-head">
          <td colspan="6" class="a4-divider-ce">Le préposé à la surveillance :</td>
          <td colspan="3">L'entrepreneur ou son délégué :</td>
        </tr>
        <tr class="a4-sign-body">
          <td colspan="6" class="a4-divider-ce">
            <div class="a4-stamp-row">
              <div class="a4-stamp-card">
                <div style="font-weight:700;color:#0a5b9c">${escHtml(supervisorName || 'INASEP')}</div>
                <div style="color:#0a5b9c;font-style:italic">// Contrôleur de chantier</div>
                <div>Bureau d'études Distribution</div>
                <div>Et assainissement des eaux</div>
                <img class="a4-stamp-logo" src="${INASEP_LOGO_DATA_URL}" alt="INASEP">
              </div>
              <div class="a4-sign-display">
                <div class="a4-sign-name">${escHtml(j.signatureControleur?.signerName || supervisorName)}</div>
                ${sigControleurMetaHtml}
              </div>
            </div>
          </td>
          <td colspan="3">
            <div class="a4-sign-display">${sigLecteurHtml}</div>
          </td>
        </tr>
      </tbody>
    </table>
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
        <div class="sheet-scroll">${byWeek[wk].map((j) => renderSheetHTML(ch, j)).join('')}</div>
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
  .sheet-scroll { overflow-x: auto; padding-bottom: 8px; }
  .a4-sheet { width: 210mm; min-height: 297mm; margin: 0 auto 18px; background: #fff; padding: 7mm 8mm; box-sizing: border-box; box-shadow: 0 2px 10px rgba(0,0,0,.12); font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; line-height: 1.2; color: #000; }
  .a4-master-table { width: 100%; border-collapse: collapse; table-layout: fixed; border: 1.5px solid #000; }
  .a4-master-table td, .a4-master-table th { border: 1px solid #000; padding: 1.5px 4px; vertical-align: middle; word-break: break-word; overflow-wrap: anywhere; color: #000; }
  .a4-left-header-wrap { padding: 0 !important; vertical-align: top !important; border-right: 1.5px solid #000 !important; }
  .a4-right-header-wrap { padding: 0 !important; vertical-align: top !important; }
  .a4-inner-table { width: 100%; height: 100%; border-collapse: collapse; table-layout: fixed; }
  .a4-inner-table td { border: none; border-bottom: 1px solid #000; padding: 2px 5px; vertical-align: middle; }
  .a4-inner-table tr:last-child td { border-bottom: none; }
  .a4-inner-right td { border-right: 1px solid #000; }
  .a4-inner-right td:last-child { border-right: none; }
  .a4-logo-box { height: 76px; text-align: center; padding: 4px 6px !important; }
  .a4-logo { max-width: 175px; max-height: 64px; width: auto; height: auto; display: inline-block; vertical-align: middle; }
  .a4-project-box { min-height: 30px; text-align: center; font-weight: 700; font-size: 8.5pt; line-height: 1.15; text-transform: uppercase; padding: 4px 5px !important; }
  .a4-company-box { min-height: 48px; text-align: center; font-size: 8pt; line-height: 1.2; padding: 4px 5px !important; }
  .a4-hdr-lbl { font-size: 6.8pt; text-align: right; color: #000; white-space: nowrap; padding-right: 4px !important; }
  .a4-hdr-val { font-size: 8.2pt; text-align: left; color: #000; padding-left: 5px !important; }
  .a4-sec-bar td { border-top: 1.5px solid #000 !important; border-bottom: 1.5px solid #000 !important; font-weight: 700; font-size: 8pt; text-align: center; padding: 2px 4px; background: #fff; height: 17px; }
  .a4-sec-letter { text-align: center !important; font-weight: 700; }
  .a4-sec-title-left { text-align: left !important; padding-left: 6px !important; }
  .a4-grid-row td { height: 15.5px; font-size: 7.1pt; line-height: 1.15; padding: 1.5px 4px; }
  .a4-subhead-cell { font-weight: 700; font-size: 7.3pt !important; text-align: center; }
  .a4-total-cell { font-weight: 700; font-size: 7.8pt !important; text-align: center; }
  .a4-divider-ab, .a4-divider-ce { border-right: 1.5px solid #000 !important; }
  .a4-sign-head td { border-top: 1.5px solid #000 !important; border-bottom: 1px solid #000 !important; font-weight: 700; font-size: 8pt; text-align: center; padding: 2.5px 6px; }
  .a4-sign-body td { vertical-align: top; padding: 5px 8px; min-height: 82px; height: 82px; }
  .a4-stamp-row { display: flex; align-items: flex-start; gap: 8px; }
  .a4-stamp-card { width: 98px; flex-shrink: 0; text-align: left; font-size: 5.5pt; line-height: 1.25; color: #1e293b; }
  .a4-stamp-logo { width: 90px; height: auto; margin-top: 3px; display: block; }
  .a4-sign-display { flex: 1; min-width: 0; font-size: 9pt; font-weight: 400; line-height: 1.25; color: #000; }
  .a4-sign-name { font-size: 9.5pt; font-weight: 700; line-height: 1.2; color: #000; }
  .a4-sign-meta { margin-top: 3px; font-size: 6.4pt; line-height: 1.25; color: #000; }
  .a4-sign-mono { font-family: "Courier New", Courier, monospace; font-size: 6.2pt; color: #000; }
  .a4-sign-hash { font-family: "Courier New", Courier, monospace; font-size: 5.3pt; line-height: 1.2; color: #1e293b; word-break: break-all; }
  @media (max-width: 820px) {
    .week-banner { margin: 12px 8px 6px; }
  }
  @media print {
    @page { size: A4 portrait; margin: 9mm; }
    body { background: #fff; }
    .nav, .week-banner { display: none; }
    .sheet-scroll { overflow: visible; padding: 0; }
    .a4-sheet { width: auto; min-height: 0; padding: 0; margin: 0; box-shadow: none; page-break-after: always; break-after: page; }
    .a4-sheet:last-child { page-break-after: auto; break-after: auto; }
  }
</style>
</head>
<body>
<div class="nav">
  <div>
    <div class="nav-title">${escHtml(ch.numero || 'Chantier')} — ${escHtml(ch.projet || '')}</div>
    <div class="nav-sub">Consultation seule · ${list.length} journal(aux) · généré le ${fmtDateFR(todayISO())} · ${escHtml(ch.preposeSurveillance || 'F. Pirquin')}</div>
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
