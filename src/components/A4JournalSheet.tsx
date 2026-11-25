import {
  INASEP_LOGO_DATA_URL,
  type Chantier,
  type Journal,
  type Ouvrier,
} from '../types';
import { fmtDateShortDash, fmtHourFR } from '../utils/dates';

interface A4JournalSheetProps {
  chantier: Chantier;
  journal: Journal;
  className?: string;
}

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
  firmeRowSpan: number; // 0 means covered by previous rowSpan
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

export function A4JournalSheet({
  chantier,
  journal,
  className = '',
}: A4JournalSheetProps) {
  const workerRows = buildWorkerRows(journal.ouvriers || []);
  const totalOuvriers = (journal.ouvriers || []).reduce(
    (s, o) => s + (Number(o.nbre) || 0),
    0
  );

  const travauxLines = cleanList(journal.travaux);
  const materielLines = cleanList(journal.materiel).map(parseMaterielLine);
  const materiauxLines = cleanList(journal.materiaux);
  const essaisLines = cleanList(journal.essais);
  const evenementsLines = cleanList(journal.evenements);
  const decisionsLines = cleanList(journal.decisions);
  const visitesLines = cleanList(journal.visites);

  // Row 0 of A is subheader "Firme | Métiers | Nbre", Row 0..abBodyRows-1 of B are travaux
  // Plus 1 final row for "TOTAL" in A alongside one more travaux slot in B
  const abMiddleRows = Math.max(
    18,
    workerRows.length + 1,
    travauxLines.length - 1
  );
  const ceRows = Math.max(8, materielLines.length, materiauxLines.length);
  const fRows = Math.max(5, essaisLines.length);
  const hRows = Math.max(5, evenementsLines.length);
  const jkRows = Math.max(4, decisionsLines.length, visitesLines.length);

  const etatText = (journal.etatAtmo || [])
    .map((x) => x.trim())
    .filter(Boolean)
    .join(', ');

  const hDebut = fmtHourFR(journal.horaireDebut || chantier.horaireDebut);
  const hFin = fmtHourFR(journal.horaireFin || chantier.horaireFin);

  const supervisorName =
    journal.signatureControleur?.signerName ||
    journal.preposeSurveillance ||
    chantier.preposeSurveillance ||
    '';

  return (
    <div className={`a4-sheet ${className}`}>
      <table className="a4-master-table">
        <colgroup>
          <col style={{ width: '9%' }} />
          <col style={{ width: '3.5%' }} />
          <col style={{ width: '9.5%' }} />
          <col style={{ width: '5.5%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '5.5%' }} />
          <col style={{ width: '19%' }} />
          <col style={{ width: '7.5%' }} />
          <col style={{ width: '29.5%' }} />
        </colgroup>

        <tbody>
          {/* TOP HEADER BLOCK */}
          <tr>
            <td colSpan={4} className="a4-left-header-wrap">
              <table className="a4-inner-table">
                <tbody>
                  <tr>
                    <td className="a4-logo-box">
                      <img
                        className="a4-logo"
                        src={INASEP_LOGO_DATA_URL}
                        alt="INASEP"
                      />
                    </td>
                  </tr>
                  <tr>
                    <td className="a4-project-box">
                      {chantier.projet || '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="a4-company-box">
                      <div style={{ marginBottom: '7px' }}>
                        {chantier.entrepriseNom || ''}
                      </div>
                      <div style={{ whiteSpace: 'pre-line' }}>
                        {chantier.entrepriseAdresse || ''}
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>

            <td colSpan={5} className="a4-right-header-wrap">
              <table className="a4-inner-table a4-inner-right">
                <colgroup>
                  <col style={{ width: '15.2%' }} />
                  <col style={{ width: '27.6%' }} />
                  <col style={{ width: '21.5%' }} />
                  <col style={{ width: '9.5%' }} />
                  <col style={{ width: '9.2%' }} />
                  <col style={{ width: '17%' }} />
                </colgroup>
                <tbody>
                  <tr style={{ height: '19px' }}>
                    <td className="a4-hdr-lbl">N° de chantier</td>
                    <td className="a4-hdr-val">{chantier.numero || ''}</td>
                    <td className="a4-hdr-lbl">Journal n° :</td>
                    <td className="a4-hdr-val">{journal.journalNum ?? ''}</td>
                    <td className="a4-hdr-lbl">Date:</td>
                    <td className="a4-hdr-val">
                      {fmtDateShortDash(journal.date)}
                    </td>
                  </tr>
                  <tr style={{ height: '19px' }}>
                    <td className="a4-hdr-lbl" />
                    <td className="a4-hdr-val" />
                    <td
                      className="a4-hdr-lbl"
                      style={{ textAlign: 'right' }}
                    >
                      Horaires de travail de:
                    </td>
                    <td className="a4-hdr-val">{hDebut}</td>
                    <td className="a4-hdr-lbl">à:</td>
                    <td className="a4-hdr-val">{hFin}</td>
                  </tr>
                  <tr style={{ height: '19px' }}>
                    <td className="a4-hdr-lbl">Références :</td>
                    <td className="a4-hdr-val">{chantier.references || ''}</td>
                    <td className="a4-hdr-lbl">Température (en°C) à 8h00:</td>
                    <td className="a4-hdr-val">{journal.tempMatin || ''}</td>
                    <td className="a4-hdr-lbl">à 16h15 :</td>
                    <td className="a4-hdr-val">
                      {journal.tempApresMidi || ''}
                    </td>
                  </tr>
                  <tr style={{ height: '19px' }}>
                    <td className="a4-hdr-lbl">Adresse chantier:</td>
                    <td colSpan={5} className="a4-hdr-val">
                      {(chantier.adresseChantier || '').replace(/\n/g, ', ')}
                    </td>
                  </tr>
                  <tr>
                    <td
                      colSpan={6}
                      style={{
                        verticalAlign: 'top',
                        padding: '5px 8px',
                        height: '78px',
                        fontSize: '7.5pt',
                        lineHeight: 1.35,
                      }}
                    >
                      <span>Etat atmosphérique :</span>
                      {etatText ? (
                        <span style={{ marginLeft: '4px' }}>{etatText}</span>
                      ) : null}
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>

          {/* SECTION A (OUVRIERS) & SECTION B (TRAVAUX EXECUTES) HEADER */}
          <tr className="a4-sec-bar">
            <td colSpan={1} className="a4-sec-letter">
              A
            </td>
            <td colSpan={3} className="a4-divider-ab">
              OUVRIERS
            </td>
            <td colSpan={1} className="a4-sec-letter">
              B
            </td>
            <td colSpan={4} className="a4-sec-title-left">
              TRAVAUX EXECUTES
            </td>
          </tr>

          {/* ROW 0: A subheader ("Firme | Métiers | Nbre") + B line 0 */}
          <tr className="a4-grid-row">
            <td colSpan={1} className="a4-subhead-cell">
              Firme
            </td>
            <td colSpan={2} className="a4-subhead-cell">
              Métiers
            </td>
            <td colSpan={1} className="a4-subhead-cell a4-divider-ab">
              Nbre
            </td>
            <td colSpan={5}>{travauxLines[0] || ''}</td>
          </tr>

          {/* ROWS 1..abMiddleRows-1: Worker rows + B lines */}
          {Array.from({ length: abMiddleRows - 1 }).map((_, idx) => {
            const worker = workerRows[idx];
            const bLine = travauxLines[idx + 1] || '';

            return (
              <tr key={`ab-${idx}`} className="a4-grid-row">
                {worker ? (
                  <>
                    {worker.firmeRowSpan > 0 && (
                      <td
                        colSpan={1}
                        rowSpan={worker.firmeRowSpan}
                        style={{ textAlign: 'center', fontSize: '6.8pt' }}
                      >
                        {worker.firme}
                      </td>
                    )}
                    <td colSpan={2}>{worker.metier}</td>
                    <td
                      colSpan={1}
                      className="a4-divider-ab"
                      style={{ textAlign: 'center' }}
                    >
                      {worker.nbre}
                    </td>
                  </>
                ) : (
                  <>
                    <td colSpan={1} />
                    <td colSpan={2} />
                    <td colSpan={1} className="a4-divider-ab" />
                  </>
                )}
                <td colSpan={5}>{bLine}</td>
              </tr>
            );
          })}

          {/* TOTAL ROW of A + final line of B */}
          <tr className="a4-grid-row">
            <td colSpan={1} />
            <td colSpan={2} className="a4-total-cell">
              TOTAL
            </td>
            <td colSpan={1} className="a4-total-cell a4-divider-ab">
              {totalOuvriers || ''}
            </td>
            <td colSpan={5}>{travauxLines[abMiddleRows] || ''}</td>
          </tr>

          {/* SECTION C (MATERIEL EN SERVICE) & SECTION E (MATERIAUX ENTRES CE JOUR) */}
          <tr className="a4-sec-bar">
            <td colSpan={2} className="a4-sec-letter">
              C
            </td>
            <td colSpan={5} className="a4-divider-ce">
              MATERIEL EN SERVICE
            </td>
            <td colSpan={1} className="a4-sec-letter">
              E
            </td>
            <td colSpan={1}>MATERIAUX ENTRES CE JOUR</td>
          </tr>

          {Array.from({ length: ceRows }).map((_, idx) => {
            const mat = materielLines[idx];
            const matx = materiauxLines[idx] || '';
            return (
              <tr key={`ce-${idx}`} className="a4-grid-row">
                <td
                  colSpan={2}
                  style={{ textAlign: 'right', paddingRight: '5px' }}
                >
                  {mat?.qty || ''}
                </td>
                <td colSpan={5} className="a4-divider-ce">
                  {mat?.text || ''}
                </td>
                <td colSpan={2}>{matx}</td>
              </tr>
            );
          })}

          {/* SECTION F (ESSAIS SUR CHANTIER) */}
          <tr className="a4-sec-bar">
            <td colSpan={2} className="a4-sec-letter">
              F
            </td>
            <td colSpan={5} className="a4-divider-ce">
              ESSAIS SUR CHANTIER
            </td>
            <td colSpan={2} />
          </tr>

          {Array.from({ length: fRows }).map((_, idx) => (
            <tr key={`f-${idx}`} className="a4-grid-row">
              <td colSpan={7} className="a4-divider-ce">
                {essaisLines[idx] || ''}
              </td>
              <td colSpan={2} />
            </tr>
          ))}

          {/* SECTION H (EVENEMENTS IMPREVUS) */}
          <tr className="a4-sec-bar">
            <td colSpan={2} className="a4-sec-letter">
              H
            </td>
            <td colSpan={5} className="a4-divider-ce">
              EVENEMENTS IMPREVUS
            </td>
            <td colSpan={2} />
          </tr>

          {Array.from({ length: hRows }).map((_, idx) => (
            <tr key={`h-${idx}`} className="a4-grid-row">
              <td colSpan={7} className="a4-divider-ce">
                {evenementsLines[idx] || ''}
              </td>
              <td colSpan={2} />
            </tr>
          ))}

          {/* SECTION J (DECISION PRISES) & SECTION K (VISITE DIVERS) */}
          <tr className="a4-sec-bar">
            <td colSpan={2} className="a4-sec-letter">
              J
            </td>
            <td colSpan={3} className="a4-divider-ce">
              DECISION PRISES
            </td>
            <td colSpan={1} className="a4-sec-letter">
              K
            </td>
            <td colSpan={3}>VISITE DIVERS</td>
          </tr>

          {Array.from({ length: jkRows }).map((_, idx) => (
            <tr key={`jk-${idx}`} className="a4-grid-row">
              <td colSpan={5} className="a4-divider-ce">
                {decisionsLines[idx] || ''}
              </td>
              <td colSpan={4}>{visitesLines[idx] || ''}</td>
            </tr>
          ))}

          {/* SIGNATURE BLOCK */}
          <tr className="a4-sign-head">
            <td colSpan={6} className="a4-divider-ce">
              Le préposé à la surveillance :
            </td>
            <td colSpan={3}>L&apos;entrepreneur ou son délégué :</td>
          </tr>
          <tr className="a4-sign-body">
            <td colSpan={6} className="a4-divider-ce">
              <div className="a4-stamp-row">
                <div className="a4-stamp-card">
                  <div style={{ fontWeight: 700, color: '#0a5b9c' }}>
                    {supervisorName || 'INASEP'}
                  </div>
                  <div style={{ color: '#0a5b9c', fontStyle: 'italic' }}>
                    // Contrôleur de chantier
                  </div>
                  <div>Bureau d&apos;études Distribution</div>
                  <div>Et assainissement des eaux</div>
                  <img
                    className="a4-stamp-logo"
                    src={INASEP_LOGO_DATA_URL}
                    alt="INASEP"
                  />
                </div>
                <div className="a4-sign-display">
                  <div className="a4-sign-name">
                    {journal.signatureControleur?.signerName || supervisorName}
                  </div>
                  {journal.signatureControleur && (
                    <div className="a4-sign-meta">
                      {journal.signatureControleur.hardwareVerified && (
                        <div>
                          Certifié puce eID
                          {journal.signatureControleur.certSerial
                            ? ` · Cert. ${journal.signatureControleur.certSerial.slice(0, 16)}`
                            : ''}
                        </div>
                      )}
                      <div>
                        Le{' '}
                        {new Date(
                          journal.signatureControleur.signedAt
                        ).toLocaleString('fr-BE')}
                      </div>
                      <div className="a4-sign-mono">
                        Réf. {journal.signatureControleur.verificationId}
                      </div>
                      <div className="a4-sign-hash">
                        SHA-256 : {journal.signatureControleur.documentSha256}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </td>
            <td colSpan={3}>
              <div className="a4-sign-display">
                {journal.signatureLecteur ? (
                  <>
                    <div className="a4-sign-name">
                      {journal.signatureLecteur.signerName}
                    </div>
                    <div className="a4-sign-meta">
                      {journal.signatureLecteur.hardwareVerified && (
                        <div>
                          Certifié puce eID
                          {journal.signatureLecteur.certSerial
                            ? ` · Cert. ${journal.signatureLecteur.certSerial.slice(0, 16)}`
                            : ''}
                        </div>
                      )}
                      <div>
                        Le{' '}
                        {new Date(
                          journal.signatureLecteur.signedAt
                        ).toLocaleString('fr-BE')}
                      </div>
                      <div className="a4-sign-mono">
                        Réf. {journal.signatureLecteur.verificationId}
                      </div>
                      <div className="a4-sign-hash">
                        SHA-256 : {journal.signatureLecteur.documentSha256}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="a4-sign-name">
                    {journal.sigEntrepreneur || ''}
                  </div>
                )}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
