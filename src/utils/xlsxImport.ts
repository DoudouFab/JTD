import * as XLSX from 'xlsx';

export interface InfosChantier3P {
  numeroChantier: string;          // ex. "2026-042"
  references: string;              // ex. "25279-11-3"
  nomProjet: string;               // ex. "Égouttage Rue de la Station"
  entrepriseAdjudicataire: string; // ex. "Nom de la firme"
  preposeSurveillance: string;     // ex. "F. Pirquin"
  adresseEntreprise: string;       // ex. "Rue..., 5000 Namur"
  adresseChantier: string;         // ex. "Rue de la Station, ..."
  // Bonus souvent présents dans les 3P :
  maitreOuvrage?: string;
  auteurProjet?: string;
}

export interface XlsxImportResult {
  numero: string;
  projet: string;
  entrepriseNom: string;
  entrepriseAdresse: string;
  references: string;
  adresseChantier: string;
  preposeSurveillance: string;
  postes: string[];
  filledCount: number;
}

const norm = (v: unknown): string =>
  String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`]/g, ' ')
    .replace(/[:\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const cleanVal = (v: unknown): string =>
  String(v ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

/**
 * Extrait les métadonnées d'un fichier Excel 3P (ArrayBuffer ou File.arrayBuffer())
 */
export function extraireInfos3P(buffer: ArrayBuffer): InfosChantier3P {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });

  // Priorité aux onglets de garde / infos / aperçu, puis les autres onglets en secours
  const orderedSheets = [
    ...wb.SheetNames.filter((n) =>
      /aper|vua|info|synt|garde|admin|entete|general|chantier/i.test(n)
    ),
    ...wb.SheetNames.filter(
      (n) =>
        !/aper|vua|info|synt|garde|admin|entete|general|chantier/i.test(n)
    ),
  ];

  const res: InfosChantier3P = {
    numeroChantier: '',
    references: '',
    nomProjet: '',
    entrepriseAdjudicataire: '',
    preposeSurveillance: '',
    adresseEntreprise: '',
    adresseChantier: '',
    maitreOuvrage: '',
    auteurProjet: '',
  };

  for (const sheetName of orderedSheets) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    // On ne scanne que les 80 premières lignes de chaque feuille
    const rows = XLSX.utils
      .sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })
      .slice(0, 80);

    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const row = rows[rIdx] || [];

      // Parcourir chaque cellule non vide de la ligne (gère les colonnes décalées / fusionnées)
      for (let cIdx = 0; cIdx < row.length; cIdx++) {
        const rawCell = cleanVal(row[cIdx]);
        if (!rawCell) continue;

        // Cas 1 : "Libellé : Valeur" dans la même cellule
        let rawLabel = rawCell;
        let inlineValue = '';
        const colonIdx = rawCell.indexOf(':');
        if (colonIdx > 0 && colonIdx < rawCell.length - 1) {
          rawLabel = rawCell.slice(0, colonIdx).trim();
          inlineValue = rawCell.slice(colonIdx + 1).trim();
        }

        const k = norm(rawLabel);
        if (!k || k.length > 70) continue;

        // Chercher la valeur : soit inline après ":", soit 1ère cellule non vide à droite sur la même ligne
        let val = inlineValue;
        if (!val) {
          for (let j = cIdx + 1; j < row.length; j++) {
            const candidate = cleanVal(row[j]);
            if (candidate) {
              val = candidate;
              break;
            }
          }
        }
        if (!val) continue;

        // 1. N° de chantier (ex. 2026-042)
        if (
          !res.numeroChantier &&
          (/^(n|no|num|numero)\s*(de\s*)?chantier/.test(k) ||
            k === 'chantier n' ||
            k === 'code chantier' ||
            k === 'id chantier')
        ) {
          res.numeroChantier = val;
          break;
        }

        // 2. Références (ex. 25279-11-3)
        if (
          !res.references &&
          (k === 'reference' ||
            k === 'references' ||
            k.startsWith('reference ') ||
            k.startsWith('references ') ||
            k.includes('n dossier') ||
            k.includes('numero dossier') ||
            k === 'ref' ||
            k === 'refs')
        ) {
          res.references = val;
          break;
        }

        // 3. Nom du projet (ex. Égouttage Rue de la Station)
        if (
          !res.nomProjet &&
          (k === 'nom du projet' ||
            k === 'projet' ||
            k === 'intitule' ||
            k === 'intitule du projet' ||
            k === 'objet' ||
            k === 'objet des travaux' ||
            k === 'objet du marche' ||
            k === 'marche' ||
            k.startsWith('marche ') ||
            k === 'designation des travaux') &&
          !k.includes('reference') &&
          !k.includes('auteur')
        ) {
          res.nomProjet = val;
          break;
        }

        // 4. Adresse de l'entreprise (à tester AVANT "entreprise" pour ne pas la confondre avec le nom)
        if (
          !res.adresseEntreprise &&
          (k.includes('adresse de l entreprise') ||
            k.includes('adresse entreprise') ||
            k.includes('adresse adjudicataire') ||
            k.includes('adresse entrepreneur') ||
            k.includes('siege social'))
        ) {
          res.adresseEntreprise = val.replace(/\n+/g, ', ');
          break;
        }

        // 5. Entreprise adjudicataire (+ extraction éventuelle d'adresse sur les lignes suivantes de la cellule)
        if (
          !res.entrepriseAdjudicataire &&
          (k === 'entreprise adjudicataire' ||
            k === 'adjudicataire' ||
            k.startsWith('adjudicataire ') ||
            k === 'entreprise' ||
            k === 'entrepreneur' ||
            k.includes('soumissionnaire') ||
            k.includes('titulaire du marche'))
        ) {
          const lines = val
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
          res.entrepriseAdjudicataire = lines[0] || val;
          if (!res.adresseEntreprise && lines.length > 1) {
            res.adresseEntreprise = lines.slice(1).join(', ');
          }
          // Si la ligne Excel juste en dessous contient une adresse sans libellé en col A (ex: CP + localité)
          if (!res.adresseEntreprise && rIdx + 1 < rows.length) {
            const nextRow = rows[rIdx + 1] || [];
            const nextLabel = norm(nextRow[0]);
            const nextVal = cleanVal(nextRow[cIdx + 1] ?? nextRow[1]);
            if (!nextLabel && nextVal && /\b\d{4}\b/.test(nextVal)) {
              res.adresseEntreprise = nextVal.replace(/\n+/g, ', ');
            }
          }
          break;
        }

        // 6. Préposé à la surveillance (ex. F. Pirquin)
        if (
          !res.preposeSurveillance &&
          (k.includes('prepose a la surveillance') ||
            k.includes('prepose surveillance') ||
            k === 'prepose' ||
            k === 'surveillant' ||
            k === 'surveillance' ||
            k.includes('controleur'))
        ) {
          res.preposeSurveillance = val;
          break;
        }

        // 7. Adresse du chantier
        if (
          !res.adresseChantier &&
          (k.includes('adresse du chantier') ||
            k.includes('adresse chantier') ||
            k.includes('adresse des travaux') ||
            k === 'lieu' ||
            k === 'lieu des travaux' ||
            k === 'localisation')
        ) {
          res.adresseChantier = val.replace(/\n+/g, ', ');
          break;
        }

        // Bonus utiles
        if (
          !res.maitreOuvrage &&
          (k.includes('pouvoir adjudicateur') || k.includes('maitre d ouvrage'))
        ) {
          res.maitreOuvrage = val;
          break;
        }
        if (
          !res.auteurProjet &&
          (k.includes('auteur de projet') || k.includes('fonctionnaire dirigeant'))
        ) {
          res.auteurProjet = val;
          break;
        }
      }
    }
  }

  return res;
}

function extractPostes3P(buffer: ArrayBuffer): string[] {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const postesSet = new Set<string>();

  const postesSheetName = wb.SheetNames.find((n) => {
    const s = norm(n);
    return (
      s.includes('poste') || s.includes('bordereau') || s.includes('metre')
    );
  });
  const sheetP = postesSheetName ? wb.Sheets[postesSheetName] : undefined;

  if (!sheetP) return [];

  const pRows = XLSX.utils.sheet_to_json<unknown[]>(sheetP, {
    header: 1,
    defval: '',
  });
  let numCol = -1;
  let descCol = -1;
  let startRow = -1;

  for (let i = 0; i < Math.min(25, pRows.length); i++) {
    const r = (pRows[i] || []).map((v) => norm(v));
    const ni = r.findIndex((x) =>
      /^(n°|n|no|num|numero|poste|code|art|article)\b/.test(x)
    );
    const di = r.findIndex((x) =>
      /libell|design|descrip|intitul|travaux|objet/.test(x)
    );
    if (di >= 0) {
      descCol = di;
      numCol = ni >= 0 && ni !== di ? ni : di > 0 ? 0 : -1;
      startRow = i + 1;
      break;
    }
  }

  if (startRow >= 0 && descCol >= 0) {
    for (let i = startRow; i < pRows.length; i++) {
      const r = pRows[i] || [];
      const n = numCol >= 0 ? String(r[numCol] ?? '').trim() : '';
      const d = String(r[descCol] ?? '').trim();
      if (!d) continue;
      if (/^\s*(total|sous-total|somme|report|tva|tvac|htva)\b/i.test(d)) {
        continue;
      }
      const line = n && n !== d ? `${n} — ${d}` : d;
      postesSet.add(line);
    }
  }

  return Array.from(postesSet);
}

export async function parseChantierXlsx(file: File): Promise<XlsxImportResult> {
  const buf = await file.arrayBuffer();
  const infos = extraireInfos3P(buf);
  const postes = extractPostes3P(buf);

  const filledCount = [
    infos.numeroChantier,
    infos.references,
    infos.nomProjet,
    infos.entrepriseAdjudicataire,
    infos.adresseEntreprise,
    infos.adresseChantier,
    infos.preposeSurveillance,
  ].filter(Boolean).length;

  return {
    numero: infos.numeroChantier,
    references: infos.references,
    projet: infos.nomProjet,
    entrepriseNom: infos.entrepriseAdjudicataire,
    entrepriseAdresse: infos.adresseEntreprise,
    adresseChantier: infos.adresseChantier,
    preposeSurveillance: infos.preposeSurveillance,
    postes,
    filledCount,
  };
}
