import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { A4JournalSheet } from '../components/A4JournalSheet';
import type { Chantier, Journal } from '../types';
import { fmtDateFR } from './dates';
import {
  formatSignatureMethodLabel,
  verifyJournalSignatureRecord,
} from './signatureCrypto';
import { deliverFile } from './storage';

export interface PdfProgress {
  current: number;
  total: number;
  label: string;
}

function xmlEscape(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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

    // Verify & embed authentication & signature metadata inside PDF /Info & XMP stream
    const authRecords = await Promise.all(
      journals.map(async (j) => {
        const ctrlVerify = j.signatureControleur
          ? await verifyJournalSignatureRecord(chantier, j, j.signatureControleur)
          : null;
        const lectVerify = j.signatureLecteur
          ? await verifyJournalSignatureRecord(chantier, j, j.signatureLecteur)
          : null;

        return {
          journalId: j.id,
          journalNum: j.journalNum,
          date: j.date,
          status: j.status || 'in_progress',
          controleur: j.signatureControleur
            ? {
                role: 'controleur' as const,
                method: j.signatureControleur.method,
                methodLabel: formatSignatureMethodLabel(j.signatureControleur.method),
                signerUid: j.signatureControleur.signerUid,
                signerName: j.signatureControleur.signerName,
                signerEmail: j.signatureControleur.signerEmail,
                verificationId: j.signatureControleur.verificationId,
                verifiedAt: j.signatureControleur.verifiedAt,
                signedAt: j.signatureControleur.signedAt,
                documentSha256: j.signatureControleur.documentSha256,
                cryptoDigest: j.signatureControleur.cryptoDigest,
                webAuthnUsed: j.signatureControleur.webAuthnUsed,
                nationalIdHash: j.signatureControleur.nationalIdHash,
                integrityVerifiedAtExport: ctrlVerify?.valid ?? false,
              }
            : null,
          lecteur: j.signatureLecteur
            ? {
                role: 'lecteur' as const,
                method: j.signatureLecteur.method,
                methodLabel: formatSignatureMethodLabel(j.signatureLecteur.method),
                signerUid: j.signatureLecteur.signerUid,
                signerName: j.signatureLecteur.signerName,
                signerEmail: j.signatureLecteur.signerEmail,
                verificationId: j.signatureLecteur.verificationId,
                verifiedAt: j.signatureLecteur.verifiedAt,
                signedAt: j.signatureLecteur.signedAt,
                documentSha256: j.signatureLecteur.documentSha256,
                cryptoDigest: j.signatureLecteur.cryptoDigest,
                webAuthnUsed: j.signatureLecteur.webAuthnUsed,
                nationalIdHash: j.signatureLecteur.nationalIdHash,
                integrityVerifiedAtExport: lectVerify?.valid ?? false,
              }
            : null,
        };
      })
    );

    const ctrlSummaries = Array.from(
      new Set(
        authRecords
          .filter((r) => r.controleur)
          .map(
            (r) =>
              `Contrôleur: ${r.controleur!.signerName} [${r.controleur!.methodLabel}] (${r.controleur!.verificationId})`
          )
      )
    );
    const lectSummaries = Array.from(
      new Set(
        authRecords
          .filter((r) => r.lecteur)
          .map(
            (r) =>
              `Entrepreneur/Lecteur: ${r.lecteur!.signerName} [${r.lecteur!.methodLabel}] (${r.lecteur!.verificationId})`
          )
      )
    );

    const uniqueSigners = [...ctrlSummaries, ...lectSummaries];

    const uniqueVerifIds = Array.from(
      new Set(
        authRecords.flatMap((r) => [
          r.controleur
            ? `${r.controleur.methodLabel}:${r.controleur.verificationId}`
            : '',
          r.lecteur
            ? `${r.lecteur.methodLabel}:${r.lecteur.verificationId}`
            : '',
        ])
      )
    ).filter(Boolean);

    const shaList = Array.from(
      new Set(
        authRecords.flatMap((r) => [
          r.controleur ? `SHA256-Controleur(${r.controleur.methodLabel}):${r.controleur.documentSha256}` : '',
          r.lecteur ? `SHA256-Lecteur(${r.lecteur.methodLabel}):${r.lecteur.documentSha256}` : '',
        ])
      )
    ).filter(Boolean);

    const primaryCtrl = authRecords.find((r) => r.controleur)?.controleur || null;
    const primaryLect = authRecords.find((r) => r.lecteur)?.lecteur || null;

    const authManifestJson = JSON.stringify({
      schema: 'INASEP-JDT-AUTH-V2',
      chantierId: chantier.id,
      chantierNumero: chantier.numero,
      chantierProjet: chantier.projet,
      exportedAt: new Date().toISOString(),
      pages: authRecords,
    });

    pdf.setProperties({
      title: `Journal des travaux - ${chantier.numero || ''} ${chantier.projet || ''}`.trim(),
      author: uniqueSigners.join(' | ') || chantier.preposeSurveillance || 'INASEP',
      subject: `Journaux N° ${journals.map((j) => j.journalNum).join(', ')} | ${
        uniqueSigners.length > 0
          ? `Signatures certifiées: ${uniqueSigners.join(' ; ')}`
          : 'Non signé'
      }`,
      keywords: [
        'INASEP',
        'Journal des travaux',
        ...authRecords.flatMap((r) => [
          r.controleur
            ? `SignatureControleur=${r.controleur.methodLabel}`
            : '',
          r.lecteur
            ? `SignatureLecteur=${r.lecteur.methodLabel}`
            : '',
        ]).filter(Boolean),
        ...uniqueVerifIds,
        ...shaList,
      ].join(', '),
      creator: 'Mes JDT (INASEP) — Signatures certifiées itsme® / e-ID (SHA-256 + ECDSA P-256)',
    });

    const xmpBody = [
      `<ChantierId>${xmlEscape(chantier.id)}</ChantierId>`,
      `<ChantierNumero>${xmlEscape(chantier.numero || '')}</ChantierNumero>`,
      `<SignatureControleurPresent>${primaryCtrl ? 'true' : 'false'}</SignatureControleurPresent>`,
      `<SignatureControleurMethode>${xmlEscape(primaryCtrl?.methodLabel || 'Aucune')}</SignatureControleurMethode>`,
      `<SignatureControleurIdentite>${xmlEscape(primaryCtrl ? `${primaryCtrl.signerName} (${primaryCtrl.signerEmail || primaryCtrl.signerUid})` : '')}</SignatureControleurIdentite>`,
      `<SignatureControleurReference>${xmlEscape(primaryCtrl?.verificationId || '')}</SignatureControleurReference>`,
      `<SignatureControleurHorodatage>${xmlEscape(primaryCtrl?.signedAt || '')}</SignatureControleurHorodatage>`,
      `<SignatureControleurEmpreinteDonneesSHA256>${xmlEscape(primaryCtrl?.documentSha256 || '')}</SignatureControleurEmpreinteDonneesSHA256>`,
      `<SignatureControleurPreuveECDSA>${xmlEscape(primaryCtrl?.cryptoDigest || '')}</SignatureControleurPreuveECDSA>`,
      `<SignatureLecteurPresent>${primaryLect ? 'true' : 'false'}</SignatureLecteurPresent>`,
      `<SignatureLecteurMethode>${xmlEscape(primaryLect?.methodLabel || 'Aucune')}</SignatureLecteurMethode>`,
      `<SignatureLecteurIdentite>${xmlEscape(primaryLect ? `${primaryLect.signerName} (${primaryLect.signerEmail || primaryLect.signerUid})` : '')}</SignatureLecteurIdentite>`,
      `<SignatureLecteurReference>${xmlEscape(primaryLect?.verificationId || '')}</SignatureLecteurReference>`,
      `<SignatureLecteurHorodatage>${xmlEscape(primaryLect?.signedAt || '')}</SignatureLecteurHorodatage>`,
      `<SignatureLecteurEmpreinteDonneesSHA256>${xmlEscape(primaryLect?.documentSha256 || '')}</SignatureLecteurEmpreinteDonneesSHA256>`,
      `<SignatureLecteurPreuveECDSA>${xmlEscape(primaryLect?.cryptoDigest || '')}</SignatureLecteurPreuveECDSA>`,
      `<VerificationIds>${xmlEscape(uniqueVerifIds.join(', '))}</VerificationIds>`,
      `<Signers>${xmlEscape(uniqueSigners.join(' | '))}</Signers>`,
      `<SignaturesAuthJSON>${xmlEscape(authManifestJson)}</SignaturesAuthJSON>`,
    ].join('');

    pdf.addMetadata(xmpBody, 'http://inasep.be/ns/jdt-signatures/1.0/');

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
