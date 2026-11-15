import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { A4JournalSheet } from '../components/A4JournalSheet';
import type { Chantier, Journal } from '../types';
import { fmtDateFR } from './dates';
import { deliverFile } from './storage';

export interface PdfProgress {
  current: number;
  total: number;
  label: string;
}

export async function generateAndDeliverPdf(
  chantier: Chantier,
  journals: Journal[],
  filename: string,
  folderKey: string,
  onProgress?: (progress: PdfProgress) => void,
  fallbackFolderKey?: string
): Promise<{ mode: 'folder' | 'download'; folderName?: string }> {
  if (!journals.length) {
    throw new Error('Aucun journal à exporter.');
  }

  const stage = document.createElement('div');
  stage.style.position = 'fixed';
  stage.style.left = '-10000px';
  stage.style.top = '0';
  stage.style.width = '794px';
  stage.style.background = '#ffffff';
  stage.style.zIndex = '-1';
  document.body.appendChild(stage);

  const root = createRoot(stage);

  try {
    flushSync(() => {
      root.render(
        createElement(
          'div',
          null,
          journals.map((j) =>
            createElement(A4JournalSheet, {
              key: j.id,
              chantier,
              journal: j,
            })
          )
        )
      );
    });

    // Wait a tick for images/layout to settle cleanly
    await new Promise((r) => setTimeout(r, 80));

    const sheets = Array.from(stage.querySelectorAll('.a4-sheet')) as HTMLElement[];
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const pageW = 210;
    const pageH = 297;

    for (let i = 0; i < sheets.length; i++) {
      const j = journals[i];
      onProgress?.({
        current: i + 1,
        total: sheets.length,
        label: `Rendu Journal N° ${j.journalNum} (${fmtDateFR(j.date)})…`,
      });

      const canvas = await html2canvas(sheets[i], {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      });

      const img = canvas.toDataURL('image/jpeg', 0.92);
      if (i > 0) pdf.addPage();

      let w = pageW;
      let h = (canvas.height * w) / canvas.width;
      if (h > pageH) {
        h = pageH;
        w = (canvas.width * h) / canvas.height;
      }
      pdf.addImage(img, 'JPEG', 0, 0, w, h, undefined, 'FAST');
    }

    onProgress?.({
      current: sheets.length,
      total: sheets.length,
      label: 'Enregistrement du fichier PDF…',
    });

    const blob = pdf.output('blob');
    return await deliverFile(blob, filename, folderKey, fallbackFolderKey);
  } finally {
    root.unmount();
    stage.remove();
  }
}
