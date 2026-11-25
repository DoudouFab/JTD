import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import forge from 'node-forge';

interface FirebaseAppletConfig {
  projectId: string;
}

interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  provider: string;
}

interface SupportedSigAlg {
  hashFunction: string;
  paddingScheme: string;
  cryptoAlgorithm: string;
}

interface CachedCertEntry {
  cert: crypto.X509Certificate;
  fetchedAt: number;
}

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

const ALLOWED_BELGIAN_PKI_HOSTS = new Set([
  'certs.eid.belgium.be',
  'repository.eid.belgium.be',
  'ocsp.eid.belgium.be',
]);

const KNOWN_BELGIAN_ISSUER_HINTS = [
  'citizen ca',
  'belgium root ca',
  'belgium root ca2',
  'belgium root ca3',
  'belgium root ca4',
  'belgium root ca5',
  'belgium root ca6',
];

function loadFirebaseProjectId(): string {
  const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  try {
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<FirebaseAppletConfig>;
    if (typeof parsed.projectId === 'string' && parsed.projectId.trim()) {
      return parsed.projectId.trim();
    }
  } catch {
    // fallback to env if present
  }
  return (process.env.FIREBASE_PROJECT_ID || '').trim();
}

const FIREBASE_PROJECT_ID = loadFirebaseProjectId();

// ---------------------------------------------------------------------------
// Firebase ID Token Verification (no IAM required — Google public x509 keys)
// ---------------------------------------------------------------------------

let googleCertsCache: { certs: Record<string, string>; expiresAt: number } = {
  certs: {},
  expiresAt: 0,
};

async function getGoogleSecureTokenCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (now < googleCertsCache.expiresAt && Object.keys(googleCertsCache.certs).length > 0) {
    return googleCertsCache.certs;
  }
  const resp = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
    { signal: AbortSignal.timeout(5000) }
  );
  if (!resp.ok) {
    throw new Error('Impossible de récupérer les clés publiques Firebase Auth.');
  }
  const certs = (await resp.json()) as Record<string, string>;
  const cc = resp.headers.get('cache-control') || '';
  const maxAgeMatch = /max-age=(\d+)/i.exec(cc);
  const ttlMs = maxAgeMatch ? Math.max(60, Number(maxAgeMatch[1])) * 1000 : 3600 * 1000;
  googleCertsCache = {
    certs,
    expiresAt: now + ttlMs,
  };
  return certs;
}

function decodeJwtPart(b64Url: string): Record<string, unknown> {
  const normalized = b64Url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const json = Buffer.from(normalized + pad, 'base64').toString('utf8');
  const parsed = JSON.parse(json) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Jeton JWT invalide.');
  }
  return parsed as Record<string, unknown>;
}

async function verifyFirebaseBearerToken(idToken: string): Promise<VerifiedFirebaseUser> {
  if (!FIREBASE_PROJECT_ID) {
    throw new Error('Configuration Firebase projet introuvable sur le serveur.');
  }
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Format de jeton Firebase invalide.');
  }

  const header = decodeJwtPart(parts[0]);
  const payload = decodeJwtPart(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    throw new Error('Algorithme de jeton non autorisé.');
  }

  const certs = await getGoogleSecureTokenCerts();
  let pem = certs[header.kid];
  if (!pem) {
    googleCertsCache.expiresAt = 0;
    const freshCerts = await getGoogleSecureTokenCerts();
    pem = freshCerts[header.kid];
  }
  if (!pem) {
    throw new Error('Clé de signature Firebase introuvable.');
  }

  const sigBuf = Buffer.from(
    parts[2].replace(/-/g, '+').replace(/_/g, '/'),
    'base64'
  );
  const signedInput = Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8');
  const sigValid = crypto.verify('RSA-SHA256', signedInput, pem, sigBuf);
  if (!sigValid) {
    throw new Error('Signature du jeton d’authentification invalide.');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const exp = Number(payload.exp || 0);
  const iat = Number(payload.iat || 0);
  const authTime = Number(payload.auth_time || 0);
  const expectedIss = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;

  if (!Number.isFinite(exp) || exp <= nowSec) {
    throw new Error('Session expirée. Veuillez vous reconnecter.');
  }
  if (!Number.isFinite(iat) || iat > nowSec + 300 || authTime > nowSec + 300) {
    throw new Error('Horodatage de session invalide.');
  }
  if (payload.aud !== FIREBASE_PROJECT_ID || payload.iss !== expectedIss) {
    throw new Error('Jeton émis pour un autre projet.');
  }
  const uid = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!uid || uid.length > 128) {
    throw new Error('Identifiant utilisateur manquant dans le jeton.');
  }

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const emailVerified = Boolean(payload.email_verified);
  const fbMeta =
    payload.firebase && typeof payload.firebase === 'object'
      ? (payload.firebase as Record<string, unknown>)
      : {};
  const provider = typeof fbMeta.sign_in_provider === 'string' ? fbMeta.sign_in_provider : '';

  if (!email || (!emailVerified && provider !== 'google.com')) {
    throw new Error('Adresse e-mail non vérifiée pour signer.');
  }

  return { uid, email, emailVerified: emailVerified || provider === 'google.com', provider };
}

async function requireFirebaseAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match?.[1]) {
    res.status(401).json({ error: 'Authentification requise (jeton manquant).' });
    return;
  }
  try {
    const user = await verifyFirebaseBearerToken(match[1].trim());
    (req as Request & { authUser?: VerifiedFirebaseUser }).authUser = user;
    next();
  } catch (err) {
    res.status(401).json({
      error: err instanceof Error ? err.message : 'Authentification invalide.',
    });
  }
}

// ---------------------------------------------------------------------------
// Strict SSRF-Safe Belgian PKI Fetching (AIA CA Issuers & OCSP)
// ---------------------------------------------------------------------------

function isPrivateOrBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const octets = ip.split('.').map((x) => Number(x));
    const [a, b] = octets;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (
      low === '::1' ||
      low === '::' ||
      low.startsWith('fe80:') ||
      low.startsWith('fc') ||
      low.startsWith('fd') ||
      low.startsWith('::ffff:127.') ||
      low.startsWith('::ffff:10.') ||
      low.startsWith('::ffff:192.168.') ||
      low.startsWith('::ffff:169.254.')
    ) {
      return true;
    }
    return false;
  }
  return true;
}

async function validateAllowlistedPkiUrl(rawUrl: string): Promise<URL> {
  const parsed = new URL(rawUrl.trim());
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Protocole PKI non autorisé.');
  }
  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_BELGIAN_PKI_HOSTS.has(host)) {
    throw new Error(`Hôte PKI hors liste autorisée (${host}).`);
  }
  const records = await dns.lookup(host, { all: true });
  if (!records.length || records.some((r) => isPrivateOrBlockedIp(r.address))) {
    throw new Error('Résolution réseau PKI bloquée.');
  }
  return parsed;
}

const caCertCache = new Map<string, CachedCertEntry>();

async function fetchAllowlistedCaCert(urlStr: string): Promise<crypto.X509Certificate | null> {
  const cached = caCertCache.get(urlStr);
  if (cached && Date.now() - cached.fetchedAt < 12 * 3600 * 1000) {
    return cached.cert;
  }
  try {
    const safeUrl = await validateAllowlistedPkiUrl(urlStr);
    const resp = await fetch(safeUrl.toString(), {
      redirect: 'manual',
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 100 || buf.length > 65536) return null;
    const cert = new crypto.X509Certificate(buf);
    caCertCache.set(urlStr, { cert, fetchedAt: Date.now() });
    return cert;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Belgian eID Certificate Parsing, Chain Validation & OCSP
// ---------------------------------------------------------------------------

interface ParsedEidCertDetails {
  x509: crypto.X509Certificate;
  forgeCert: forge.pki.Certificate;
  signerName: string;
  nationalIdRawDigits: string;
  subjectSummary: string;
  issuerSummary: string;
  serialHex: string;
  thumbprintSha256: string;
  validFromIso: string;
  validToIso: string;
  isWithinValidity: boolean;
  isBelgianCitizenIssuer: boolean;
  hasNonRepudiation: boolean;
  aiaIssuerUrls: string[];
  ocspUrls: string[];
}

function getAttrValue(attrs: forge.pki.CertificateField[], keys: string[]): string {
  for (const attr of attrs) {
    const shortName = String(attr.shortName || '').toLowerCase();
    const name = String(attr.name || '').toLowerCase();
    const type = String(attr.type || '');
    if (keys.includes(shortName) || keys.includes(name) || keys.includes(type)) {
      const val = typeof attr.value === 'string' ? attr.value.trim() : '';
      if (val) return val;
    }
  }
  return '';
}

function cleanDisplayCaseName(raw: string): string {
  return raw
    .replace(/\s*\(signature\)\s*$/i, '')
    .replace(/\s*\(authentication\)\s*$/i, '')
    .trim();
}

function parseAccessUrls(infoAccess: string | undefined, prefix: string): string[] {
  if (!infoAccess) return [];
  const urls: string[] = [];
  for (const line of infoAccess.split(/\r?\n/)) {
    const idx = line.indexOf(prefix);
    if (idx >= 0) {
      const candidate = line.slice(idx + prefix.length).trim();
      if (/^https?:\/\//i.test(candidate)) {
        urls.push(candidate);
      }
    }
  }
  return urls;
}

function parseBelgianEidCertificate(certBase64: string): ParsedEidCertDetails {
  const cleanB64 = certBase64.replace(/\s+/g, '');
  if (!cleanB64 || cleanB64.length > 16384 || !/^[A-Za-z0-9+/=]+$/.test(cleanB64)) {
    throw new Error('Certificat X.509 base64 invalide.');
  }
  const derBuf = Buffer.from(cleanB64, 'base64');
  if (derBuf.length < 128 || derBuf.length > 12288) {
    throw new Error('Taille de certificat X.509 invalide.');
  }

  const x509 = new crypto.X509Certificate(derBuf);
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(derBuf.toString('binary')));
  const forgeCert = forge.pki.certificateFromAsn1(asn1);

  const attrs = forgeCert.subject.attributes;
  const givenName = getAttrValue(attrs, ['gn', 'givenname', '2.5.4.42']);
  const surname = getAttrValue(attrs, ['sn', 'surname', '2.5.4.4']);
  const commonName = cleanDisplayCaseName(getAttrValue(attrs, ['cn', 'commonname', '2.5.4.3']));
  const serialNumber = getAttrValue(attrs, ['serialnumber', '2.5.4.5']);
  const country = getAttrValue(attrs, ['c', 'countryname', '2.5.4.6']).toUpperCase();

  let signerName = commonName;
  if (givenName && surname) {
    signerName = `${givenName} ${surname}`.trim();
  }
  signerName = cleanDisplayCaseName(signerName).slice(0, 120);
  if (!signerName) {
    throw new Error('Nom du titulaire introuvable dans le certificat eID.');
  }

  const issuerAttrs = forgeCert.issuer.attributes;
  const issuerCn = getAttrValue(issuerAttrs, ['cn', 'commonname', '2.5.4.3']);
  const issuerOrg = getAttrValue(issuerAttrs, ['o', 'organizationname', '2.5.4.10']);
  const issuerSummary = [issuerCn, issuerOrg].filter(Boolean).join(' · ').slice(0, 160) ||
    x509.issuer.replace(/\n/g, ', ').slice(0, 160);
  const subjectSummary = x509.subject.replace(/\n/g, ', ').slice(0, 200);

  const keyUsageExt = forgeCert.getExtension('keyUsage') as
    | { nonRepudiation?: boolean; contentCommitment?: boolean; digitalSignature?: boolean }
    | undefined;
  const hasNonRepudiation = Boolean(
    keyUsageExt?.nonRepudiation || keyUsageExt?.contentCommitment
  );

  const validFromMs = Date.parse(x509.validFrom);
  const validToMs = Date.parse(x509.validTo);
  const nowMs = Date.now();
  const isWithinValidity =
    Number.isFinite(validFromMs) &&
    Number.isFinite(validToMs) &&
    nowMs >= validFromMs &&
    nowMs <= validToMs;

  const issuerLower = `${issuerSummary} ${x509.issuer}`.toLowerCase();
  const isBelgianCitizenIssuer =
    (country === 'BE' || issuerLower.includes('c=be') || issuerLower.includes('belgium')) &&
    KNOWN_BELGIAN_ISSUER_HINTS.some((hint) => issuerLower.includes(hint));

  const aiaIssuerUrls = parseAccessUrls(x509.infoAccess, 'CA Issuers - URI:');
  const ocspUrls = parseAccessUrls(x509.infoAccess, 'OCSP - URI:');

  const thumbprintSha256 = crypto
    .createHash('sha256')
    .update(x509.raw)
    .digest('hex')
    .toUpperCase();

  return {
    x509,
    forgeCert,
    signerName,
    nationalIdRawDigits: serialNumber.replace(/[^a-zA-Z0-9]/g, ''),
    subjectSummary,
    issuerSummary,
    serialHex: x509.serialNumber.slice(0, 80),
    thumbprintSha256,
    validFromIso: new Date(validFromMs).toISOString(),
    validToIso: new Date(validToMs).toISOString(),
    isWithinValidity,
    isBelgianCitizenIssuer,
    hasNonRepudiation,
    aiaIssuerUrls,
    ocspUrls,
  };
}

async function verifyBelgianChain(details: ParsedEidCertDetails): Promise<{
  chainVerified: boolean;
  issuerChecked: boolean;
  rootNames: string[];
}> {
  const rootNames: string[] = [];
  let currentCert = details.x509;
  let depth = 0;

  while (depth < 3) {
    const aiaUrls = parseAccessUrls(currentCert.infoAccess, 'CA Issuers - URI:');
    if (!aiaUrls.length) break;

    let parentCert: crypto.X509Certificate | null = null;
    for (const urlStr of aiaUrls) {
      if (!urlStr.toLowerCase().includes('eid.belgium.be')) continue;
      parentCert = await fetchAllowlistedCaCert(urlStr);
      if (parentCert) break;
    }
    if (!parentCert) break;

    if (!currentCert.verify(parentCert.publicKey)) {
      return { chainVerified: false, issuerChecked: true, rootNames };
    }

    const parentCn =
      parentCert.subject
        .split('\n')
        .find((l) => l.startsWith('CN='))
        ?.slice(3) || parentCert.subject;
    rootNames.push(parentCn);

    if (parentCert.subject === parentCert.issuer) {
      return {
        chainVerified: KNOWN_BELGIAN_ISSUER_HINTS.some((h) =>
          parentCn.toLowerCase().includes(h)
        ),
        issuerChecked: true,
        rootNames,
      };
    }

    currentCert = parentCert;
    depth += 1;
  }

  return {
    chainVerified: rootNames.length > 0 && details.isBelgianCitizenIssuer,
    issuerChecked: rootNames.length > 0,
    rootNames,
  };
}

async function checkOcspBestEffort(
  details: ParsedEidCertDetails,
  issuerCert: crypto.X509Certificate | null
): Promise<'good' | 'revoked' | 'unavailable'> {
  if (!issuerCert || !details.ocspUrls.length) return 'unavailable';
  const ocspUrl = details.ocspUrls.find((u) => {
    try {
      return ALLOWED_BELGIAN_PKI_HOSTS.has(new URL(u).hostname.toLowerCase());
    } catch {
      return false;
    }
  });
  if (!ocspUrl) return 'unavailable';

  try {
    const safeUrl = await validateAllowlistedPkiUrl(ocspUrl);
    const issuerAsn1 = forge.asn1.fromDer(
      forge.util.createBuffer(issuerCert.raw.toString('binary'))
    );
    const issuerForge = forge.pki.certificateFromAsn1(issuerAsn1);

    const issuerNameDer = forge.asn1
      .toDer(forge.pki.distinguishedNameToAsn1(issuerForge.subject))
      .getBytes();
    const issuerNameHash = crypto
      .createHash('sha1')
      .update(Buffer.from(issuerNameDer, 'binary'))
      .digest();

    const issuerSpkiDer = issuerCert.publicKey.export({ type: 'spki', format: 'der' });
    const issuerSpkiAsn1 = forge.asn1.fromDer(
      forge.util.createBuffer(issuerSpkiDer.toString('binary'))
    );
    const bitStringNode = (issuerSpkiAsn1.value as forge.asn1.Asn1[])[1];
    const pubKeyBytes = (bitStringNode.value as string).slice(1); // skip unused-bits byte
    const issuerKeyHash = crypto
      .createHash('sha1')
      .update(Buffer.from(pubKeyBytes, 'binary'))
      .digest();

    const serialBytesHex =
      details.x509.serialNumber.length % 2 === 1
        ? `0${details.x509.serialNumber}`
        : details.x509.serialNumber;
    const serialBuf = Buffer.from(serialBytesHex, 'hex');

    const certId = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
        forge.asn1.create(
          forge.asn1.Class.UNIVERSAL,
          forge.asn1.Type.OID,
          false,
          forge.asn1.oidToDer('1.3.14.3.2.26').getBytes() // SHA-1
        ),
        forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, ''),
      ]),
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.OCTETSTRING,
        false,
        issuerNameHash.toString('binary')
      ),
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.OCTETSTRING,
        false,
        issuerKeyHash.toString('binary')
      ),
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.INTEGER,
        false,
        serialBuf.toString('binary')
      ),
    ]);

    const ocspReq = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
        forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
          forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [certId]),
        ]),
      ]),
    ]);

    const reqDer = Buffer.from(forge.asn1.toDer(ocspReq).getBytes(), 'binary');
    const resp = await fetch(safeUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/ocsp-request' },
      body: reqDer,
      redirect: 'manual',
      signal: AbortSignal.timeout(3500),
    });
    if (!resp.ok) return 'unavailable';
    const respBuf = Buffer.from(await resp.arrayBuffer());
    if (respBuf.length < 20 || respBuf.length > 65536) return 'unavailable';

    const respAsn1 = forge.asn1.fromDer(forge.util.createBuffer(respBuf.toString('binary')));
    const topSeq = respAsn1.value as forge.asn1.Asn1[];
    const respStatusByte = topSeq[0]?.value as string;
    if (!respStatusByte || respStatusByte.charCodeAt(0) !== 0) {
      return 'unavailable';
    }
    // Walk BasicOCSPResponse -> ResponseData -> responses[0] -> certStatus
    const responseBytes = (topSeq[1].value as forge.asn1.Asn1[])[0];
    const octetBytes = (responseBytes.value as forge.asn1.Asn1[])[1].value as string;
    const basicResp = forge.asn1.fromDer(forge.util.createBuffer(octetBytes));
    const basicSeq = basicResp.value as forge.asn1.Asn1[];
    const tbsResponseData = basicSeq[0].value as forge.asn1.Asn1[];
    const responsesSeq = tbsResponseData.find(
      (n) => n.tagClass === forge.asn1.Class.UNIVERSAL && n.type === forge.asn1.Type.SEQUENCE
    );
    const singleResp = (responsesSeq?.value as forge.asn1.Asn1[] | undefined)?.[0];
    const singleItems = singleResp?.value as forge.asn1.Asn1[] | undefined;
    const certStatus = singleItems?.[1];
    if (!certStatus || certStatus.tagClass !== forge.asn1.Class.CONTEXT_SPECIFIC) {
      return 'unavailable';
    }
    if (certStatus.type === 0) return 'good';
    if (certStatus.type === 1) return 'revoked';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

// ---------------------------------------------------------------------------
// Hash Selection & Signature Verification
// ---------------------------------------------------------------------------

function chooseHashFunction(
  supported?: SupportedSigAlg[]
): 'SHA-256' | 'SHA-384' | 'SHA-512' {
  if (!Array.isArray(supported) || !supported.length) return 'SHA-256';
  const funcs = new Set(supported.map((s) => String(s?.hashFunction || '').toUpperCase()));
  if (funcs.has('SHA-256')) return 'SHA-256';
  if (funcs.has('SHA-384')) return 'SHA-384';
  if (funcs.has('SHA-512')) return 'SHA-512';
  return 'SHA-256';
}

function nodeDigestName(hashFunc: string): 'sha256' | 'sha384' | 'sha512' {
  const upper = hashFunc.toUpperCase();
  if (upper === 'SHA-384') return 'sha384';
  if (upper === 'SHA-512') return 'sha512';
  return 'sha256';
}

function verifyCardSignatureOverPayload(params: {
  x509: crypto.X509Certificate;
  canonicalPayload: string;
  signatureBase64: string;
  signatureAlgorithm: SupportedSigAlg;
}): boolean {
  const cleanSigB64 = params.signatureBase64.replace(/\s+/g, '');
  const sigBuf = Buffer.from(cleanSigB64, 'base64');
  if (sigBuf.length < 32 || sigBuf.length > 1024) {
    return false;
  }

  const alg = nodeDigestName(params.signatureAlgorithm.hashFunction || 'SHA-256');
  const dataBuf = Buffer.from(params.canonicalPayload, 'utf8');
  const cryptoAlg = String(params.signatureAlgorithm.cryptoAlgorithm || '').toUpperCase();
  const paddingScheme = String(params.signatureAlgorithm.paddingScheme || '').toUpperCase();
  const keyType = params.x509.publicKey.asymmetricKeyType;

  if (cryptoAlg === 'ECC' || keyType === 'ec') {
    if (crypto.verify(alg, dataBuf, { key: params.x509.publicKey, dsaEncoding: 'ieee-p1363' }, sigBuf)) {
      return true;
    }
    return crypto.verify(alg, dataBuf, { key: params.x509.publicKey, dsaEncoding: 'der' }, sigBuf);
  }

  if (paddingScheme === 'PSS') {
    if (
      crypto.verify(
        alg,
        dataBuf,
        {
          key: params.x509.publicKey,
          padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
          saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
        },
        sigBuf
      )
    ) {
      return true;
    }
    return crypto.verify(
      alg,
      dataBuf,
      {
        key: params.x509.publicKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_AUTO,
      },
      sigBuf
    );
  }

  return crypto.verify(
    alg,
    dataBuf,
    {
      key: params.x509.publicKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    sigBuf
  );
}

// ---------------------------------------------------------------------------
// Express App Setup
// ---------------------------------------------------------------------------

async function createServer(): Promise<void> {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, service: 'mes-jdt-eid' });
  });

  app.post('/api/eid/prepare-sign', requireFirebaseAuth, async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        certificateBase64?: unknown;
        documentSha256Hex?: unknown;
        canonicalPayload?: unknown;
        supportedSignatureAlgorithms?: unknown;
      };

      const certB64 = typeof body.certificateBase64 === 'string' ? body.certificateBase64 : '';
      const docShaHex =
        typeof body.documentSha256Hex === 'string' ? body.documentSha256Hex.trim().toLowerCase() : '';
      const canonicalPayload =
        typeof body.canonicalPayload === 'string' ? body.canonicalPayload : '';

      if (!certB64 || !/^[a-f0-9]{64}$/.test(docShaHex) || !canonicalPayload) {
        res.status(400).json({ error: 'Paramètres de préparation eID invalides ou incomplets.' });
        return;
      }

      const recomputedHex = crypto
        .createHash('sha256')
        .update(Buffer.from(canonicalPayload, 'utf8'))
        .digest('hex');
      if (recomputedHex !== docShaHex) {
        res.status(400).json({ error: 'L’empreinte SHA-256 de la page ne correspond pas.' });
        return;
      }

      const details = parseBelgianEidCertificate(certB64);
      if (!details.isWithinValidity) {
        res.status(400).json({
          error: `Le certificat eID a expiré ou n’est pas encore valide (échéance : ${new Date(details.validToIso).toLocaleDateString('fr-BE')}).`,
        });
        return;
      }
      if (!details.hasNonRepudiation) {
        res.status(400).json({
          error: 'Le certificat lu n’est pas le certificat de signature (non-répudiation) de la carte eID.',
        });
        return;
      }
      if (!details.isBelgianCitizenIssuer) {
        res.status(400).json({
          error: `Émetteur non reconnu comme autorité belge eID (${details.issuerSummary}).`,
        });
        return;
      }

      const supported = Array.isArray(body.supportedSignatureAlgorithms)
        ? (body.supportedSignatureAlgorithms as SupportedSigAlg[])
        : [];
      const hashFunction = chooseHashFunction(supported);
      const digestBytes =
        hashFunction === 'SHA-256'
          ? Buffer.from(docShaHex, 'hex')
          : crypto
              .createHash(nodeDigestName(hashFunction))
              .update(Buffer.from(canonicalPayload, 'utf8'))
              .digest();

      const chain = await verifyBelgianChain(details);
      if (chain.issuerChecked && !chain.chainVerified) {
        res.status(400).json({
          error: 'La chaîne cryptographique vers l’autorité eID belge est invalide.',
        });
        return;
      }

      res.json({
        ok: true,
        hashFunction,
        hashBase64: digestBytes.toString('base64'),
        signerName: details.signerName,
        certIssuer: details.issuerSummary,
        certSerial: details.serialHex,
        certThumbprint: details.thumbprintSha256,
        certValidTo: details.validToIso,
        chainVerified: chain.chainVerified,
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Certificat eID illisible.',
      });
    }
  });

  app.post('/api/eid/verify-sign', requireFirebaseAuth, async (req: Request, res: Response) => {
    try {
      const authUser = (req as Request & { authUser: VerifiedFirebaseUser }).authUser;
      const body = (req.body || {}) as {
        certificateBase64?: unknown;
        signatureBase64?: unknown;
        signatureAlgorithm?: unknown;
        documentSha256Hex?: unknown;
        canonicalPayload?: unknown;
      };

      const certB64 = typeof body.certificateBase64 === 'string' ? body.certificateBase64 : '';
      const sigB64 = typeof body.signatureBase64 === 'string' ? body.signatureBase64 : '';
      const docShaHex =
        typeof body.documentSha256Hex === 'string' ? body.documentSha256Hex.trim().toLowerCase() : '';
      const canonicalPayload =
        typeof body.canonicalPayload === 'string' ? body.canonicalPayload : '';
      const sigAlg =
        body.signatureAlgorithm && typeof body.signatureAlgorithm === 'object'
          ? (body.signatureAlgorithm as SupportedSigAlg)
          : null;

      if (!certB64 || !sigB64 || !sigAlg || !/^[a-f0-9]{64}$/.test(docShaHex) || !canonicalPayload) {
        res.status(400).json({ error: 'Données de signature eID incomplètes.' });
        return;
      }

      const recomputedHex = crypto
        .createHash('sha256')
        .update(Buffer.from(canonicalPayload, 'utf8'))
        .digest('hex');
      if (recomputedHex !== docShaHex) {
        res.status(400).json({ error: 'Altération détectée : empreinte SHA-256 non conforme.' });
        return;
      }

      const details = parseBelgianEidCertificate(certB64);
      if (!details.isWithinValidity) {
        res.status(400).json({ error: 'Le certificat eID n’est plus dans sa période de validité.' });
        return;
      }
      if (!details.hasNonRepudiation) {
        res.status(400).json({
          error: 'Le certificat présenté ne possède pas l’usage « Non-répudiation » requis.',
        });
        return;
      }
      if (!details.isBelgianCitizenIssuer) {
        res.status(400).json({
          error: `Émetteur non reconnu comme autorité belge eID (${details.issuerSummary}).`,
        });
        return;
      }

      const sigValid = verifyCardSignatureOverPayload({
        x509: details.x509,
        canonicalPayload,
        signatureBase64: sigB64,
        signatureAlgorithm: sigAlg,
      });
      if (!sigValid) {
        res.status(400).json({
          error: 'La signature cryptographique produite par la puce eID est invalide.',
        });
        return;
      }

      const chain = await verifyBelgianChain(details);
      if (chain.issuerChecked && !chain.chainVerified) {
        res.status(400).json({
          error: 'Vérification de chaîne CA belge échouée.',
        });
        return;
      }

      let issuerCert: crypto.X509Certificate | null = null;
      for (const aiaUrl of details.aiaIssuerUrls) {
        if (aiaUrl.toLowerCase().includes('eid.belgium.be')) {
          issuerCert = await fetchAllowlistedCaCert(aiaUrl);
          if (issuerCert) break;
        }
      }
      const ocspStatus = await checkOcspBestEffort(details, issuerCert);
      if (ocspStatus === 'revoked') {
        res.status(400).json({
          error: 'Cette carte eID ou son certificat de signature est révoqué (contrôle OCSP belge).',
        });
        return;
      }

      const verifiedAt = new Date().toISOString();
      const randHex = crypto.randomBytes(6).toString('hex').toUpperCase();
      const verificationId = `EID-HW-${verifiedAt.slice(0, 10).replace(/-/g, '')}-${randHex}`;

      const nationalIdHash = details.nationalIdRawDigits
        ? crypto
            .createHash('sha256')
            .update(`eid:${details.nationalIdRawDigits}:${authUser.uid}`)
            .digest('hex')
        : '';

      const algorithmLabel = [
        sigAlg.cryptoAlgorithm || 'RSA',
        sigAlg.paddingScheme && sigAlg.paddingScheme !== 'NONE' ? sigAlg.paddingScheme : '',
        sigAlg.hashFunction || 'SHA-256',
      ]
        .filter(Boolean)
        .join('-')
        .slice(0, 40);

      res.json({
        valid: true,
        hardwareVerified: true,
        verificationId,
        verifiedAt,
        signerName: details.signerName,
        nationalIdHash,
        certIssuer: details.issuerSummary,
        certSerial: details.serialHex,
        certThumbprint: details.thumbprintSha256,
        certValidTo: details.validToIso,
        ocspStatus,
        signatureAlgorithm: algorithmLabel,
        eidSignatureB64: sigB64.replace(/\s+/g, '').slice(0, 1024),
        chainVerified: chain.chainVerified,
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Erreur lors de la vérification eID.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`Mes JDT server listening on http://${HOST}:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
