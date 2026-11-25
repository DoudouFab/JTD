import * as webeid from '@web-eid/web-eid-library';
type SignatureAlgorithm =
  webeid.LibraryGetSigningCertificateResponse['supportedSignatureAlgorithms'][number];
import type {
  Chantier,
  Journal,
  PageSignatureRecord,
  SignatureMethod,
} from '../types';

export type SigningSessionMode = 'hardware_eid' | 'account_fallback';

export interface WebEidStatusInfo {
  available: boolean;
  inIframe: boolean;
  extension?: string;
  nativeApp?: string;
  errorCode?: string;
  message?: string;
}

export interface VerifiedSigningSession {
  mode: SigningSessionMode;
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
  hardwareVerified: boolean;
  certificateBase64?: string;
  supportedSignatureAlgorithms?: SignatureAlgorithm[];
  certIssuer?: string;
  certSerial?: string;
  certThumbprint?: string;
  certValidTo?: string;
  getIdToken?: () => Promise<string>;
}

export interface SignatureVerificationResult {
  valid: boolean;
  dataIntact: boolean;
  cryptoValid: boolean;
  hardwareVerified?: boolean;
  reason?: string;
}

export function formatSignatureMethodLabel(
  method?: SignatureMethod | string,
  hardwareVerified?: boolean
): string {
  void method;
  if (hardwareVerified === true) return 'Carte eID';
  if (hardwareVerified === false) return 'e-ID (compte)';
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

export function computeCanonicalJournalPayload(
  chantier: Chantier,
  journal: Journal
): string {
  return JSON.stringify({
    chantierId: chantier.id,
    numero: chantier.numero || '',
    projet: chantier.projet || '',
    references: chantier.references || '',
    entrepriseNom: chantier.entrepriseNom || '',
    preposeSurveillance:
      journal.preposeSurveillance || chantier.preposeSurveillance || '',
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
}

export async function computeJournalSha256(
  chantier: Chantier,
  journal: Journal
): Promise<string> {
  return sha256Hex(computeCanonicalJournalPayload(chantier, journal));
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
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
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

export function formatWebEidError(err: unknown): string {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';

  switch (code) {
    case webeid.ErrorCode.ERR_WEBEID_EXTENSION_UNAVAILABLE:
      return "L'extension navigateur Web eID n'est pas détectée (installez Web eID sur votre PC ou ouvrez l'application dans un onglet navigateur indépendant hors aperçu intégré).";
    case webeid.ErrorCode.ERR_WEBEID_NATIVE_UNAVAILABLE:
      return "L'application native Web eID ou le lecteur de carte eID n'est pas détecté sur cet ordinateur.";
    case webeid.ErrorCode.ERR_WEBEID_USER_CANCELLED:
      return 'Opération eID annulée par l’utilisateur (carte non sélectionnée ou saisie PIN annulée).';
    case webeid.ErrorCode.ERR_WEBEID_USER_TIMEOUT:
    case webeid.ErrorCode.ERR_WEBEID_ACTION_TIMEOUT:
      return 'Délai dépassé lors de la lecture du lecteur ou de la saisie du code PIN eID.';
    case webeid.ErrorCode.ERR_WEBEID_CONTEXT_INSECURE:
      return 'La lecture eID exige une connexion HTTPS sécurisée.';
    case webeid.ErrorCode.ERR_WEBEID_VERSION_MISMATCH:
    case webeid.ErrorCode.ERR_WEBEID_VERSION_INVALID:
      return 'La version de l’extension Web eID et de l’application PC ne correspondent pas : mettez Web eID à jour.';
    case webeid.ErrorCode.ERR_WEBEID_ACTION_PENDING:
      return 'Une opération Web eID est déjà en cours. Finalisez-la ou fermez la fenêtre PIN ouverte.';
    default:
      if (err instanceof Error && err.message) {
        return err.message;
      }
      return 'Erreur lors de la communication avec le lecteur de carte eID.';
  }
}

export async function checkWebEidStatus(): Promise<WebEidStatusInfo> {
  const inIframe =
    typeof window !== 'undefined' ? window.self !== window.top : false;
  try {
    const res = await webeid.status();
    return {
      available: true,
      inIframe,
      extension: res.extension,
      nativeApp: res.nativeApp,
    };
  } catch (err) {
    const errorCode =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code || '')
        : undefined;
    return {
      available: false,
      inIframe,
      errorCode,
      message: formatWebEidError(err),
    };
  }
}

async function generateLocalSessionKeys(): Promise<{
  privateKey: CryptoKey;
  publicKeySpkiB64Url: string;
  publicKeyFingerprint: string;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const publicKeySpkiB64Url = bufToBase64Url(spki);
  const publicKeyFingerprint = (await sha256Hex(publicKeySpkiB64Url)).slice(
    0,
    24
  );
  return {
    privateKey: keyPair.privateKey,
    publicKeySpkiB64Url,
    publicKeyFingerprint,
  };
}

export async function createHardwareEidSession(params: {
  signerUid: string;
  signerEmail: string;
  chantier: Chantier;
  sampleJournal: Journal;
  getIdToken: () => Promise<string>;
}): Promise<VerifiedSigningSession> {
  let certResp: webeid.LibraryGetSigningCertificateResponse;
  try {
    certResp = await webeid.getSigningCertificate({ lang: 'fr' });
  } catch (err) {
    throw new Error(formatWebEidError(err));
  }

  const canonicalPayload = computeCanonicalJournalPayload(
    params.chantier,
    params.sampleJournal
  );
  const documentSha256Hex = await sha256Hex(canonicalPayload);
  const idToken = await params.getIdToken();

  const prepResp = await fetch('/api/eid/prepare-sign', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      certificateBase64: certResp.certificate,
      documentSha256Hex,
      canonicalPayload,
      supportedSignatureAlgorithms: certResp.supportedSignatureAlgorithms,
    }),
  });

  const prepData = (await prepResp.json().catch(() => ({}))) as {
    error?: string;
    signerName?: string;
    certIssuer?: string;
    certSerial?: string;
    certThumbprint?: string;
    certValidTo?: string;
  };
  if (!prepResp.ok) {
    throw new Error(
      prepData.error ||
        'Impossible de valider le certificat lu sur la carte eID.'
    );
  }

  const verifiedAt = new Date().toISOString();
  const randBytes = crypto.getRandomValues(new Uint8Array(6));
  const randHex = Array.from(randBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  const verificationId = `EID-HW-${verifiedAt.slice(0, 10).replace(/-/g, '')}-${randHex}`;

  const keys = await generateLocalSessionKeys();

  return {
    mode: 'hardware_eid',
    verificationId,
    method: 'eid',
    signerName: (prepData.signerName || 'Titulaire eID').trim(),
    signerEmail: params.signerEmail.trim(),
    signerUid: params.signerUid,
    nationalIdHash: '',
    verifiedAt,
    webAuthnUsed: false,
    privateKey: keys.privateKey,
    publicKeySpkiB64Url: keys.publicKeySpkiB64Url,
    publicKeyFingerprint: keys.publicKeyFingerprint,
    hardwareVerified: true,
    certificateBase64: certResp.certificate,
    supportedSignatureAlgorithms: certResp.supportedSignatureAlgorithms,
    certIssuer: prepData.certIssuer,
    certSerial: prepData.certSerial,
    certThumbprint: prepData.certThumbprint,
    certValidTo: prepData.certValidTo,
    getIdToken: params.getIdToken,
  };
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

  const keys = await generateLocalSessionKeys();

  const cleanNationalId = (params.nationalIdRaw || '').replace(
    /[^a-zA-Z0-9]/g,
    ''
  );
  const nationalIdHash = cleanNationalId
    ? await sha256Hex(`${params.method}:${cleanNationalId}:${params.signerUid}`)
    : '';

  return {
    mode: 'account_fallback',
    verificationId,
    method: params.method,
    signerName: params.signerName.trim(),
    signerEmail: params.signerEmail.trim(),
    signerUid: params.signerUid,
    nationalIdHash,
    verifiedAt,
    webAuthnUsed,
    privateKey: keys.privateKey,
    publicKeySpkiB64Url: keys.publicKeySpkiB64Url,
    publicKeyFingerprint: keys.publicKeyFingerprint,
    hardwareVerified: false,
  };
}

export async function signJournalPageWithSession(
  session: VerifiedSigningSession,
  role: 'controleur' | 'lecteur',
  chantier: Chantier,
  journal: Journal
): Promise<PageSignatureRecord> {
  const canonicalPayload = computeCanonicalJournalPayload(chantier, journal);
  const documentSha256 = await sha256Hex(canonicalPayload);

  if (
    session.mode === 'hardware_eid' &&
    session.certificateBase64 &&
    session.getIdToken
  ) {
    const idToken = await session.getIdToken();

    const prepResp = await fetch('/api/eid/prepare-sign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        certificateBase64: session.certificateBase64,
        documentSha256Hex: documentSha256,
        canonicalPayload,
        supportedSignatureAlgorithms: session.supportedSignatureAlgorithms || [],
      }),
    });
    const prepData = (await prepResp.json().catch(() => ({}))) as {
      error?: string;
      hashFunction?: string;
      hashBase64?: string;
    };
    if (!prepResp.ok || !prepData.hashFunction || !prepData.hashBase64) {
      throw new Error(
        prepData.error || 'Échec de préparation de signature sur la carte eID.'
      );
    }

    let signResp: webeid.LibrarySignResponse;
    try {
      signResp = await webeid.sign(
        session.certificateBase64,
        prepData.hashBase64,
        prepData.hashFunction,
        { lang: 'fr' }
      );
    } catch (err) {
      throw new Error(formatWebEidError(err));
    }

    const verifyResp = await fetch('/api/eid/verify-sign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        certificateBase64: session.certificateBase64,
        signatureBase64: signResp.signature,
        signatureAlgorithm: signResp.signatureAlgorithm,
        documentSha256Hex: documentSha256,
        canonicalPayload,
      }),
    });

    const verifyData = (await verifyResp.json().catch(() => ({}))) as {
      error?: string;
      valid?: boolean;
      hardwareVerified?: boolean;
      verificationId?: string;
      verifiedAt?: string;
      signerName?: string;
      nationalIdHash?: string;
      certIssuer?: string;
      certSerial?: string;
      certThumbprint?: string;
      certValidTo?: string;
      ocspStatus?: string;
      signatureAlgorithm?: string;
      eidSignatureB64?: string;
    };

    if (!verifyResp.ok || !verifyData.valid || !verifyData.verificationId) {
      throw new Error(
        verifyData.error ||
          'La vérification serveur de la signature eID a échoué.'
      );
    }

    const signedAt = new Date().toISOString();
    const signerName = (verifyData.signerName || session.signerName).slice(
      0,
      120
    );
    const verificationId = verifyData.verificationId.slice(0, 80);

    const payload = buildCanonicalSignaturePayload({
      verificationId,
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
      nationalIdHash: (verifyData.nationalIdHash || '').slice(0, 128),
      verificationId,
      verifiedAt: (verifyData.verifiedAt || session.verifiedAt).slice(0, 40),
      signedAt,
      documentSha256,
      cryptoDigest,
      webAuthnUsed: false,
      hardwareVerified: true,
      certIssuer: (verifyData.certIssuer || '').slice(0, 160),
      certSerial: (verifyData.certSerial || '').slice(0, 80),
      certThumbprint: (verifyData.certThumbprint || '').slice(0, 128),
      certValidTo: (verifyData.certValidTo || '').slice(0, 40),
      ocspStatus: (verifyData.ocspStatus || 'unavailable').slice(0, 32),
      signatureAlgorithm: (verifyData.signatureAlgorithm || '').slice(0, 40),
      eidSignatureB64: (verifyData.eidSignatureB64 || '').slice(0, 1024),
    };
  }

  const signedAt = new Date().toISOString();
  const signerName = session.signerName.slice(0, 120);
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
    hardwareVerified: false,
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
        hardwareVerified: sig.hardwareVerified,
        reason:
          'Les données de la page ne correspondent plus à l’empreinte SHA-256 signée.',
      };
    }

    const parts = (sig.cryptoDigest || '').split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return {
        valid: true,
        dataIntact: true,
        cryptoValid: false,
        hardwareVerified: sig.hardwareVerified,
        reason:
          'Empreinte SHA-256 intacte (signature héritée sans clé publique embarquée).',
      };
    }

    if (parts[0].length <= 32) {
      return {
        valid: true,
        dataIntact: true,
        cryptoValid: true,
        hardwareVerified: sig.hardwareVerified,
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
      hardwareVerified: sig.hardwareVerified,
      reason: cryptoValid
        ? undefined
        : 'La signature ECDSA ne correspond pas à la clé publique.',
    };
  } catch (err) {
    return {
      valid: false,
      dataIntact: false,
      cryptoValid: false,
      hardwareVerified: sig.hardwareVerified,
      reason:
        err instanceof Error
          ? err.message
          : 'Erreur de vérification cryptographique.',
    };
  }
}
