export const ADMIN_EMAILS = [
  'pirquinfabien@gmail.com',
  'fabien.pirquin@inasep.be',
] as const;
export const DEFAULT_ADMIN_EMAIL = 'pirquinfabien@gmail.com';
export const APP_SIGNATURE = 'F. Pirquin';

export type AccessStatus = 'pending' | 'approved' | 'revoked';

export interface PreauthorizedEmail {
  id: string;
  email: string;
  accessCode: string;
  note: string;
  createdBy: string;
  createdAtMs?: number;
}

export interface AccessUserRecord {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'user';
  status: AccessStatus;
  deviceHint: string;
  note: string;
  activationCode: string;
  createdAtMs?: number;
  updatedAtMs?: number;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email?: string;
  role: 'admin' | 'user';
  active: boolean;
  defaultPrepose: string;
  defaultHoraireDebut: string;
  defaultHoraireFin: string;
}

export type SignatureMethod = 'eid';

export interface PageSignatureRecord {
  role: 'controleur' | 'lecteur';
  method: SignatureMethod;
  signerUid: string;
  signerName: string;
  signerEmail: string;
  nationalIdHash: string;
  verificationId: string;
  verifiedAt: string;
  signedAt: string;
  documentSha256: string;
  cryptoDigest: string;
  webAuthnUsed: boolean;
}

export type JournalStatus = 'in_progress' | 'completed';

export interface Ouvrier {
  firme: string;
  metier: string;
  nbre: number;
}

export interface Journal {
  id: string;
  chantierId: string;
  chantierOwnerId?: string;
  chantierReaderIds?: string[];
  chantierReaderEmails?: string[];
  authorId?: string;
  authorName?: string;
  status?: JournalStatus;
  journalNum: number;
  date: string; // YYYY-MM-DD
  horaireDebut: string;
  horaireFin: string;
  tempMatin: string;
  tempApresMidi: string;
  etatAtmo: string[];
  ouvriers: Ouvrier[];
  travaux: string[];
  materiel: string[];
  materiaux: string[];
  essais: string[];
  evenements: string[];
  decisions: string[];
  visites: string[];
  sigEntrepreneur: string;
  signatureControleur?: PageSignatureRecord | null;
  signatureLecteur?: PageSignatureRecord | null;
}

export type JournalLineField =
  | 'travaux'
  | 'materiel'
  | 'materiaux'
  | 'essais'
  | 'evenements'
  | 'decisions'
  | 'visites';

export interface Chantier {
  id: string;
  ownerId?: string;
  ownerName?: string;
  visibility?: 'private';
  readerIds?: string[];
  readerEmails?: string[];
  readerAccessCode?: string;
  numero: string;
  projet: string;
  entrepriseNom: string;
  entrepriseAdresse: string;
  references: string;
  adresseChantier: string;
  horaireDebut: string;
  horaireFin: string;
  preposeSurveillance: string;
  postes: string[];
}

export interface ShareInvite {
  code: string;
  chantierId: string;
  chantierNumero: string;
  chantierProjet: string;
  ownerId: string;
  ownerName: string;
  label: string;
  active: boolean;
  usedByUid: string;
  expiresAtMs: number;
}

export interface ChantierShare {
  id: string;
  chantierId: string;
  chantierOwnerId: string;
  inviteCode: string;
  readerUid: string;
  readerName: string;
  label: string;
  revoked: boolean;
  expiresAtMs: number;
}

export interface DB {
  chantiers: Chantier[];
  journaux: Journal[];
}

export const STORAGE_KEY = 'jt_data_v2';
export const BACKUP_META_KEY = 'jt_last_backup_v1';

export const ETATS = [
  'Sec',
  'Nuageux',
  'Pluie',
  'Averses',
  'Neige',
  'Gel',
  'Vent fort',
  'Brouillard',
  'Orage',
] as const;

export const STANDARD_TRAVAUX_PRESETS = [
  'Aucune activité',
  'Intempérie',
  'Congé Entreprise',
  'Férié',
] as const;

export const SECTION_LABELS = {
  A: 'Ouvriers',
  B: 'Travaux exécutés',
  C: 'Matériel en service',
  E: 'Matériaux entrés ce jour',
  F: 'Essais sur chantier',
  H: 'Événements imprévus',
  J: 'Décisions prises',
  K: 'Visite divers',
} as const;

export const LINE_SECTIONS: {
  key: JournalLineField;
  code: 'B' | 'C' | 'E' | 'F' | 'H' | 'J' | 'K';
  label: string;
  placeholder: string;
}[] = [
  {
    key: 'travaux',
    code: 'B',
    label: SECTION_LABELS.B,
    placeholder: 'Ex. Terrassement tranchée rue… (ou choisissez un poste)',
  },
  {
    key: 'materiel',
    code: 'C',
    label: SECTION_LABELS.C,
    placeholder: 'Ex. Pelle 15T, Compacteur, Camion benne…',
  },
  {
    key: 'materiaux',
    code: 'E',
    label: SECTION_LABELS.E,
    placeholder: 'Ex. Tuyaux PEHD DN110 (48 ml), Sable stabilisé 12T…',
  },
  {
    key: 'essais',
    code: 'F',
    label: SECTION_LABELS.F,
    placeholder: 'Ex. Essai de compactage / Pression conduite…',
  },
  {
    key: 'evenements',
    code: 'H',
    label: SECTION_LABELS.H,
    placeholder: 'Ex. Impétrant non renseigné, intempéries…',
  },
  {
    key: 'decisions',
    code: 'J',
    label: SECTION_LABELS.J,
    placeholder: 'Ex. Validation tracé avec auteur de projet…',
  },
  {
    key: 'visites',
    code: 'K',
    label: SECTION_LABELS.K,
    placeholder: 'Ex. Visite maître d’ouvrage / CSS…',
  },
];

export const INASEP_LOGO_DATA_URL =
  'data:image/jpeg;base64,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';
