import type {
  Chantier,
  Journal,
  PageSignatureRecord,
  SignatureMethod,
} from '../types';

export interface VerifiedSigningSession {
  verificationId: string;
  method: SignatureMethod;
  signerName: string;
  signerEmail: string;
  signerUid: string;
  nationalIdHash: string;
  verifiedAt: string;
  webAuthnUsed: boolean;
  privateKey: CryptoKey;
  publicKeyFingerprint: string;
}

function bufToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function bufToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return bufToHex(digest);
}

export async function computeJournalSha256(
  chantier: Chantier,
  journal: Journal
): Promise<string> {
  const canonical = JSON.stringify({
    chantierId: chantier.id,
    numero: chantier.numero || '',
    projet: chantier.projet || '',
    references: chantier.references || '',
    entrepriseNom: chantier.entrepriseNom || '',
    preposeSurveillance: chantier.preposeSurveillance || '',
    journalId: journal.id,
    journalNum: journal.journalNum,
    date: journal.date || '',
    horaireDebut: journal.horaireDebut || '',
    horaireFin: journal.horaireFin || '',
    tempMatin: journal.tempMatin || '',
    tempApresMidi: journal.tempApresMidi || '',
    etatAtmo: [...(journal.etatAtmo || [])],
    ouvriers: (journal.ouvriers || []).map((o) => ({
      firme: o.firme || '',
      metier: o.metier || '',
      nbre: Number(o.nbre) || 0,
    })),
    travaux: (journal.travaux || []).map((x) => x.trim()),
    materiel: (journal.materiel || []).map((x) => x.trim()),
    materiaux: (journal.materiaux || []).map((x) => x.trim()),
    essais: (journal.essais || []).map((x) => x.trim()),
    evenements: (journal.evenements || []).map((x) => x.trim()),
    decisions: (journal.decisions || []).map((x) => x.trim()),
    visites: (journal.visites || []).map((x) => x.trim()),
    sigEntrepreneur: journal.sigEntrepreneur || '',
  });
  return sha256Hex(canonical);
}

export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.credentials?.create)
  );
}

export async function tryLocalWebAuthnVerification(
  signerUid: string,
  signerName: string
): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userIdBytes = new TextEncoder().encode(signerUid.slice(0, 32));
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'Journal des travaux INASEP' },
        user: {
          id: userIdBytes,
          name: signerName,
          displayName: signerName,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          userVerification: 'preferred',
        },
        timeout: 45000,
      },
    });
    return Boolean(cred);
  } catch {
    return false;
  }
}

export async function createVerifiedSigningSession(params: {
  method: SignatureMethod;
  signerUid: string;
  signerName: string;
  signerEmail: string;
  nationalIdRaw?: string;
  useWebAuthn?: boolean;
}): Promise<VerifiedSigningSession> {
  const verifiedAt = new Date().toISOString();
  const randBytes = crypto.getRandomValues(new Uint8Array(6));
  const randHex = Array.from(randBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  const prefix = params.method === 'itsme' ? 'ITSME' : 'EID';
  const verificationId = `${prefix}-${verifiedAt.slice(0, 10).replace(/-/g, '')}-${randHex}`;

  let webAuthnUsed = false;
  if (params.useWebAuthn) {
    webAuthnUsed = await tryLocalWebAuthnVerification(
      params.signerUid,
      params.signerName
    );
  }

  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const publicKeyFingerprint = (await sha256Hex(bufToBase64Url(spki))).slice(0, 24);

  const cleanNationalId = (params.nationalIdRaw || '').replace(/[^a-zA-Z0-9]/g, '');
  const nationalIdHash = cleanNationalId
    ? await sha256Hex(`${params.method}:${cleanNationalId}:${params.signerUid}`)
    : '';

  return {
    verificationId,
    method: params.method,
    signerName: params.signerName.trim(),
    signerEmail: params.signerEmail.trim(),
    signerUid: params.signerUid,
    nationalIdHash,
    verifiedAt,
    webAuthnUsed,
    privateKey: keyPair.privateKey,
    publicKeyFingerprint,
  };
}

export async function signJournalPageWithSession(
  session: VerifiedSigningSession,
  role: 'controleur' | 'lecteur',
  chantier: Chantier,
  journal: Journal
): Promise<PageSignatureRecord> {
  const signedAt = new Date().toISOString();
  const documentSha256 = await computeJournalSha256(chantier, journal);
  const payload = [
    session.verificationId,
    role,
    session.method,
    session.signerUid,
    session.signerName,
    documentSha256,
    signedAt,
    session.publicKeyFingerprint,
  ].join('|');

  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    session.privateKey,
    new TextEncoder().encode(payload)
  );
  const cryptoDigest = `${session.publicKeyFingerprint}.${bufToBase64Url(sigBuf)}`.slice(
    0,
    500
  );

  return {
    role,
    method: session.method,
    signerUid: session.signerUid,
    signerName: session.signerName.slice(0, 120),
    signerEmail: session.signerEmail.slice(0, 200),
    nationalIdHash: session.nationalIdHash.slice(0, 128),
    verificationId: session.verificationId.slice(0, 80),
    verifiedAt: session.verifiedAt,
    signedAt,
    documentSha256,
    cryptoDigest,
    webAuthnUsed: session.webAuthnUsed,
  };
}
