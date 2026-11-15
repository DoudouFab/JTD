import * as XLSX from 'xlsx';

export interface XlsxImportResult {
  numero: string;
  projet: string;
  entrepriseNom: string;
  entrepriseAdresse: string;
  references: string;
  adresseChantier: string;
  preposeSurveillance: string;
  postes: string[];
}

export async function parseChantierXlsx(file: File): Promise<XlsxImportResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });

  const sheetA = wb.Sheets['Aperçu'] || wb.Sheets[wb.SheetNames[0]];
  if (!sheetA) {
    throw new Error('Feuille "Aperçu" introuvable dans le classeur.');
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheetA, {
    header: 1,
    defval: '',
  });

  const cell = (r: number, c: number) =>
    rows[r] && rows[r][c] !== undefined ? String(rows[r][c]).trim() : '';

  const ent = [cell(3, 1), cell(4, 1), cell(5, 1)].filter(Boolean);
  const adr = [cell(8, 2), cell(9, 2), cell(10, 2)].filter(Boolean);

  const postesSet = new Set<string>();
  const sheetP = wb.Sheets['Postes'];
  if (sheetP) {
    const pRows = XLSX.utils.sheet_to_json<unknown[]>(sheetP, {
      header: 1,
      defval: '',
    });
    let numCol = 0;
    let descCol = 1;
    let startRow = 1;

    for (let i = 0; i < Math.min(5, pRows.length); i++) {
      const r = (pRows[i] || []).map((v) => String(v || '').toLowerCase());
      const ni = r.findIndex((x) => /n°|num|poste|code|art/.test(x));
      const di = r.findIndex((x) =>
        /libell|désign|design|descrip|intitul|travaux|objet/.test(x)
      );
      if (di >= 0) {
        descCol = di;
        if (ni >= 0 && ni !== di) numCol = ni;
        startRow = i + 1;
        break;
      }
    }

    for (let i = startRow; i < pRows.length; i++) {
      const r = pRows[i] || [];
      const n = String(r[numCol] || '').trim();
      const d = String(r[descCol] || '').trim();
      if (!d && !n) continue;
      if (d && !/^\s*(total|sous-total|somme)\b/i.test(d)) {
        const line = n && n !== d ? `${n} — ${d}` : d;
        postesSet.add(line);
      }
    }
  }

  return {
    numero: cell(1, 3) || cell(1, 2) || '',
    projet: cell(1, 5) || cell(1, 4) || '',
    entrepriseNom: ent[0] || '',
    entrepriseAdresse: ent.slice(1).join('\n'),
    references: cell(6, 2) || '',
    adresseChantier: adr.join('\n'),
    preposeSurveillance: cell(12, 2) || '',
    postes: Array.from(postesSet),
  };
}
