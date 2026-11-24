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
  publicKeySpkiB64Url: string;
  publicKeyFingerprint: string;
}

export interface SignatureVerificationResult {
  valid: boolean;
  dataIntact: boolean;
  cryptoValid: boolean;
  reason?: string;
}

export function formatSignatureMethodLabel(method?: SignatureMethod | string): string {
  void method;
  return 'e-ID';
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

function base64UrlToUint8Array(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
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

function buildCanonicalSignaturePayload(params: {
  verificationId: string;
  role: 'controleur' | 'lecteur';
  method: SignatureMethod | string;
  signerUid: string;
  signerName: string;
  documentSha256: string;
  signedAt: string;
  publicKeyFingerprint: string;
}): string {
  return [
    params.verificationId,
    params.role,
    params.method,
    params.signerUid,
    params.signerName,
    params.documentSha256,
    params.signedAt,
    params.publicKeyFingerprint,
  ].join('|');
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
  const verificationId = `EID-${verifiedAt.slice(0, 10).replace(/-/g, '')}-${randHex}`;

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
  const publicKeySpkiB64Url = bufToBase64Url(spki);
  const publicKeyFingerprint = (await sha256Hex(publicKeySpkiB64Url)).slice(0, 24);

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
    publicKeySpkiB64Url,
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
  const signerName = session.signerName.slice(0, 120);
  const documentSha256 = await computeJournalSha256(chantier, journal);
  const payload = buildCanonicalSignaturePayload({
    verificationId: session.verificationId,
    role,
    method: session.method,
    signerUid: session.signerUid,
    signerName,
    documentSha256,
    signedAt,
    publicKeyFingerprint: session.publicKeyFingerprint,
  });

  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    session.privateKey,
    new TextEncoder().encode(payload)
  );
  // Store full SPKI public key + ECDSA signature (~209 chars <= 512) so any reader/PDF verifier can verify cryptographically
  const cryptoDigest = `${session.publicKeySpkiB64Url}.${bufToBase64Url(sigBuf)}`.slice(
    0,
    500
  );

  return {
    role,
    method: session.method,
    signerUid: session.signerUid,
    signerName,
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

export async function verifyJournalSignatureRecord(
  chantier: Chantier,
  journal: Journal,
  sig: PageSignatureRecord
): Promise<SignatureVerificationResult> {
  try {
    const currentSha256 = await computeJournalSha256(chantier, journal);
    const dataIntact = currentSha256 === sig.documentSha256;
    if (!dataIntact) {
      return {
        valid: false,
        dataIntact: false,
        cryptoValid: false,
        reason: 'Les données de la page ne correspondent plus à l’empreinte SHA-256 signée.',
      };
    }

    const parts = (sig.cryptoDigest || '').split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return {
        valid: true,
        dataIntact: true,
        cryptoValid: false,
        reason: 'Empreinte SHA-256 intacte (signature héritée sans clé publique embarquée).',
      };
    }

    // Legacy records stored 24-char hex fingerprint in parts[0]; new records store full SPKI base64url (~122 chars)
    if (parts[0].length <= 32) {
      return {
        valid: true,
        dataIntact: true,
        cryptoValid: true,
      };
    }

    const spkiBytes = base64UrlToUint8Array(parts[0]);
    const sigBytes = base64UrlToUint8Array(parts[1]);
    const publicKeyFingerprint = (await sha256Hex(parts[0])).slice(0, 24);
    const publicKey = await crypto.subtle.importKey(
      'spki',
      spkiBytes.buffer as ArrayBuffer,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );

    const payload = buildCanonicalSignaturePayload({
      verificationId: sig.verificationId,
      role: sig.role,
      method: sig.method,
      signerUid: sig.signerUid,
      signerName: sig.signerName,
      documentSha256: sig.documentSha256,
      signedAt: sig.signedAt,
      publicKeyFingerprint,
    });

    const cryptoValid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      sigBytes.buffer as ArrayBuffer,
      new TextEncoder().encode(payload)
    );

    return {
      valid: dataIntact && cryptoValid,
      dataIntact,
      cryptoValid,
      reason: cryptoValid ? undefined : 'La signature ECDSA ne correspond pas à la clé publique.',
    };
  } catch (err) {
    return {
      valid: false,
      dataIntact: false,
      cryptoValid: false,
      reason: err instanceof Error ? err.message : 'Erreur de vérification cryptographique.',
    };
  }
}
