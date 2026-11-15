import {
  ETATS,
  INASEP_LOGO_DATA_URL,
  SECTION_LABELS,
  type Chantier,
  type Journal,
} from '../types';
import { dayNameFR, fmtDateFR } from '../utils/dates';

interface A4JournalSheetProps {
  chantier: Chantier;
  journal: Journal;
  className?: string;
}

function renderLines(items: string[]) {
  const clean = (items || []).map((x) => x.trim()).filter(Boolean);
  if (!clean.length) {
    return <div className="a4-empty">Néant</div>;
  }
  return (
    <ul className="a4-lines-list">
      {clean.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ul>
  );
}

export function A4JournalSheet({
  chantier,
  journal,
  className = '',
}: A4JournalSheetProps) {
  const ouvriers = (journal.ouvriers || []).filter(
    (o) => o.firme || o.metier || (o.nbre && o.nbre > 0)
  );
  const totalOuvriers = ouvriers.reduce((s, o) => s + (Number(o.nbre) || 0), 0);

  return (
    <div className={`a4-sheet ${className}`}>
      <table className="a4-header-table">
        <tbody>
          <tr>
            <td style={{ width: '185px' }}>
              <img
                className="a4-logo"
                src={INASEP_LOGO_DATA_URL}
                alt="INASEP"
              />
            </td>
            <td>
              <div style={{ fontSize: '10.5pt', fontWeight: 700 }}>INASEP</div>
              <div style={{ fontSize: '8.5pt', color: '#333' }}>
                Intercommunale Namuroise de Services Publics
              </div>
              <div style={{ fontSize: '8.5pt', color: '#333' }}>
                Direction de l&apos;Assainissement / Infrastructures
              </div>
            </td>
            <td style={{ width: '155px', textAlign: 'right' }}>
              <div style={{ fontSize: '8pt', color: '#444' }}>JOURNAL N°</div>
              <div style={{ fontSize: '15pt', fontWeight: 700 }}>
                {journal.journalNum ?? ''}
              </div>
              <div style={{ fontSize: '8.5pt' }}>
                {dayNameFR(journal.date)} {fmtDateFR(journal.date)}
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="a4-title">JOURNAL DES TRAVAUX</div>

      <div className="a4-info-grid">
        <div className="a4-info-box">
          <div className="a4-info-row">
            <span className="a4-label">N° de chantier :</span>
            <span className="a4-val">{chantier.numero || '—'}</span>
          </div>
          <div className="a4-info-row">
            <span className="a4-label">Projet :</span>
            <span className="a4-val">{chantier.projet || '—'}</span>
          </div>
          <div className="a4-info-row">
            <span className="a4-label">Références :</span>
            <span className="a4-val">{chantier.references || '—'}</span>
          </div>
          <div className="a4-info-row">
            <span className="a4-label">Adresse chantier :</span>
            <span className="a4-val">
              {(chantier.adresseChantier || '—').replace(/\n/g, ', ')}
            </span>
          </div>
        </div>

        <div className="a4-info-box">
          <div className="a4-info-row">
            <span className="a4-label">Entrepreneur :</span>
            <span className="a4-val">{chantier.entrepriseNom || '—'}</span>
          </div>
          <div className="a4-info-row">
            <span className="a4-label">Adresse :</span>
            <span className="a4-val">
              {(chantier.entrepriseAdresse || '—').replace(/\n/g, ', ')}
            </span>
          </div>
          <div className="a4-info-row">
            <span className="a4-label">Surveillance :</span>
            <span className="a4-val">
              {chantier.preposeSurveillance || '—'}
            </span>
          </div>
          <div className="a4-info-row">
            <span className="a4-label">Horaire chantier :</span>
            <span className="a4-val">
              {journal.horaireDebut || chantier.horaireDebut || '—'} –{' '}
              {journal.horaireFin || chantier.horaireFin || '—'}
            </span>
          </div>
        </div>
      </div>

      <table className="a4-meta-table">
        <tbody>
          <tr>
            <th style={{ width: '20%' }}>Température 8h00</th>
            <td style={{ width: '30%' }}>
              {journal.tempMatin ? `${journal.tempMatin} °C` : '—'}
            </td>
            <th style={{ width: '20%' }}>Température 16h15</th>
            <td style={{ width: '30%' }}>
              {journal.tempApresMidi ? `${journal.tempApresMidi} °C` : '—'}
            </td>
          </tr>
          <tr>
            <th>État atmosphérique</th>
            <td colSpan={3}>
              {ETATS.map((e) => {
                const on = (journal.etatAtmo || []).includes(e);
                return (
                  <span
                    key={e}
                    style={{ marginRight: '10px', whiteSpace: 'nowrap' }}
                  >
                    {on ? '☑' : '☐'} {e}
                  </span>
                );
              })}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="a4-section">
        <div className="a4-section-title">A. {SECTION_LABELS.A}</div>
        <div className="a4-section-body">
          {ouvriers.length ? (
            <table className="a4-workers-table">
              <thead>
                <tr>
                  <th>Firme</th>
                  <th>Métier / Qualification</th>
                  <th className="num">Nbre</th>
                </tr>
              </thead>
              <tbody>
                {ouvriers.map((o, idx) => (
                  <tr key={idx}>
                    <td>{o.firme || '—'}</td>
                    <td>{o.metier || '—'}</td>
                    <td className="num">{o.nbre || 0}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td colSpan={2}>Total ouvriers présents</td>
                  <td className="num">{totalOuvriers}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <div className="a4-empty">Néant</div>
          )}
        </div>
      </div>

      <div className="a4-section">
        <div className="a4-section-title">B. {SECTION_LABELS.B}</div>
        <div className="a4-section-body">{renderLines(journal.travaux)}</div>
      </div>

      <div className="a4-section">
        <div className="a4-section-title">C. {SECTION_LABELS.C}</div>
        <div className="a4-section-body">{renderLines(journal.materiel)}</div>
      </div>

      <div className="a4-section">
        <div className="a4-section-title">E. {SECTION_LABELS.E}</div>
        <div className="a4-section-body">{renderLines(journal.materiaux)}</div>
      </div>

      <div className="a4-section">
        <div className="a4-section-title">F. {SECTION_LABELS.F}</div>
        <div className="a4-section-body">{renderLines(journal.essais)}</div>
      </div>

      <div className="a4-section">
        <div className="a4-section-title">H. {SECTION_LABELS.H}</div>
        <div className="a4-section-body">{renderLines(journal.evenements)}</div>
      </div>

      <div className="a4-section">
        <div className="a4-section-title">J. {SECTION_LABELS.J}</div>
        <div className="a4-section-body">{renderLines(journal.decisions)}</div>
      </div>

      <div className="a4-section">
        <div className="a4-section-title">K. {SECTION_LABELS.K}</div>
        <div className="a4-section-body">{renderLines(journal.visites)}</div>
      </div>

      <div className="a4-sign-box">
        <div className="a4-sign-cell">
          <div className="a4-sign-label">Le préposé à la surveillance</div>
          <div className="a4-sign-text">
            {chantier.preposeSurveillance || ''}
          </div>
        </div>
        <div className="a4-sign-cell">
          <div className="a4-sign-label">L&apos;entrepreneur</div>
          <div className="a4-sign-text">{journal.sigEntrepreneur || ''}</div>
        </div>
      </div>
    </div>
  );
}
