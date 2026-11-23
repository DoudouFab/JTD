import type { Journal, JournalLineField } from '../types';

const CUSTOM_DICT_KEY = 'jt_custom_dict_v1';

// Unambiguous French + public works (chantier / voirie / égouttage) misspellings & missing accents
const MISSPELLINGS: Record<string, string> = {
  // Mentions & chantier courants
  activite: 'activité',
  activites: 'activités',
  intemperie: 'intempérie',
  intemperies: 'intempéries',
  entrepise: 'entreprise',
  entrepises: 'entreprises',
  entreprisse: 'entreprise',
  ferie: 'férié',
  feries: 'fériés',
  conge: 'congé',
  conges: 'congés',
  egouttage: 'égouttage',
  egout: 'égout',
  egouts: 'égouts',
  impetrant: 'impétrant',
  impetrants: 'impétrants',
  impetran: 'impétrant',
  tranchee: 'tranchée',
  tranchees: 'tranchées',
  chaussee: 'chaussée',
  chaussees: 'chaussées',
  chausee: 'chaussée',
  trotoir: 'trottoir',
  trotoirs: 'trottoirs',
  trottoires: 'trottoirs',
  bordur: 'bordure',
  bordurs: 'bordures',
  avaloire: 'avaloir',
  avaloires: 'avaloirs',
  regars: 'regards',
  racordement: 'raccordement',
  racordements: 'raccordements',
  raccordemnt: 'raccordement',
  canalisaton: 'canalisation',
  canalisatons: 'canalisations',
  terassement: 'terrassement',
  terassements: 'terrassements',
  terrasemnt: 'terrassement',
  terassier: 'terrassier',
  terassiers: 'terrassiers',
  ramblai: 'remblai',
  ramblais: 'remblais',
  ramblayage: 'remblayage',
  ramblayement: 'remblaiement',
  remblayement: 'remblaiement',
  compactge: 'compactage',
  conpactage: 'compactage',
  conpacteur: 'compacteur',
  pelteuse: 'pelleteuse',
  pelleteuze: 'pelleteuse',
  camoin: 'camion',
  camoins: 'camions',
  tuyauxx: 'tuyaux',
  tuayux: 'tuyaux',
  tuyautrie: 'tuyauterie',
  beton: 'béton',
  betons: 'bétons',
  betonnage: 'bétonnage',
  enrobe: 'enrobé',
  enrobes: 'enrobés',
  stabilise: 'stabilisé',
  macon: 'maçon',
  macons: 'maçons',
  maconnerie: 'maçonnerie',
  manoeuvre: 'manœuvre',
  manoeuvres: 'manœuvres',
  oeuvre: 'œuvre',
  geometre: 'géomètre',
  ingenieur: 'ingénieur',
  ingenieurs: 'ingénieurs',
  operateur: 'opérateur',
  operateurs: 'opérateurs',
  chef_dequipe: "chef d'équipe",
  equipe: 'équipe',
  equipes: 'équipes',
  prepose: 'préposé',
  controle: 'contrôle',
  controles: 'contrôles',
  controleur: 'contrôleur',
  securite: 'sécurité',
  etancheite: 'étanchéité',
  evacuation: 'évacuation',
  evacuations: 'évacuations',
  deblai: 'déblai',
  deblais: 'déblais',
  deblaiement: 'déblaiement',
  ecoulement: 'écoulement',
  ecoulements: 'écoulements',
  reservoir: 'réservoir',
  epuration: 'épuration',
  demarrage: 'démarrage',
  arret: 'arrêt',
  arrets: 'arrêts',
  acces: 'accès',
  reprise_service: 'remise en service',
  reception: 'réception',
  receptions: 'réceptions',
  reparation: 'réparation',
  reparations: 'réparations',
  degradation: 'dégradation',
  degradations: 'dégradations',
  defaut: 'défaut',
  defauts: 'défauts',
  netoyage: 'nettoyage',
  balisage_ok: 'balisage conforme',
  eletricite: 'électricité',
  electricite: 'électricité',
  chaufage: 'chauffage',
  manutension: 'manutention',
  vehicule: 'véhicule',
  vehicules: 'véhicules',
  materiau: 'matériau',
  materiaux: 'matériaux',
  materiel: 'matériel',
  equipement: 'équipement',
  equipements: 'équipements',
  outillage_ok: 'outillage conforme',
  // Verbes & participes passés très fréquents en journal de chantier
  realise: 'réalisé',
  realises: 'réalisés',
  realisee: 'réalisée',
  realisees: 'réalisées',
  effectue: 'effectué',
  effectues: 'effectués',
  effectuee: 'effectuée',
  effectuees: 'effectuées',
  execute: 'exécuté',
  executes: 'exécutés',
  executee: 'exécutée',
  executees: 'exécutées',
  termine: 'terminé',
  termines: 'terminés',
  terminee: 'terminée',
  terminees: 'terminées',
  verifie: 'vérifié',
  verifies: 'vérifiés',
  verifiee: 'vérifiée',
  verifiees: 'vérifiées',
  controle_fait: 'contrôlé',
  depose: 'déposé',
  deposes: 'déposés',
  deposee: 'déposée',
  repare: 'réparé',
  repares: 'réparés',
  reparee: 'réparée',
  nettoye: 'nettoyé',
  nettoyes: 'nettoyés',
  nettoyee: 'nettoyée',
  evacue: 'évacué',
  evacues: 'évacués',
  evacuee: 'évacuée',
  remblaye: 'remblayé',
  remblayes: 'remblayés',
  remblayee: 'remblayée',
  compacte: 'compacté',
  compactee: 'compactée',
  raccorde: 'raccordé',
  raccordes: 'raccordés',
  raccordee: 'raccordée',
  coule: 'coulé',
  coulee: 'coulée',
  decoupe: 'découpé',
  decoupee: 'découpée',
  demonte: 'démonté',
  demontee: 'démontée',
  deplace: 'déplacé',
  deplacee: 'déplacée',
  remplace: 'remplacé',
  remplacee: 'remplacée',
  livre: 'livré',
  livree: 'livrée',
  livres: 'livrés',
  valide: 'validé',
  validee: 'validée',
  refuse: 'refusé',
  refusee: 'refusée',
  signale: 'signalé',
  signalee: 'signalée',
  constate: 'constaté',
  constatee: 'constatée',
  demande: 'demandé',
  demandee: 'demandée',
  prevu: 'prévu',
  prevue: 'prévue',
  prevus: 'prévus',
  prevues: 'prévues',
  // Météo, mesures, admin & adverbes courants
  meteo: 'météo',
  generalement: 'généralement',
  leger: 'léger',
  legere: 'légère',
  legeres: 'légères',
  legerement: 'légèrement',
  modere: 'modéré',
  moderee: 'modérée',
  humidite: 'humidité',
  temperature: 'température',
  temperatures: 'températures',
  etat: 'état',
  etats: 'états',
  matinee: 'matinée',
  apres: 'après',
  tres: 'très',
  deja: 'déjà',
  malgre: 'malgré',
  beaucoups: 'beaucoup',
  toujour: 'toujours',
  pandant: 'pendant',
  plusieures: 'plusieurs',
  quelque_fois: 'quelquefois',
  parceque: 'parce que',
  aujourdhui: "aujourd'hui",
  presence: 'présence',
  reunion: 'réunion',
  reunions: 'réunions',
  decision: 'décision',
  decisions: 'décisions',
  evenement: 'événement',
  evenements: 'événements',
  probleme: 'problème',
  problemes: 'problèmes',
  delai: 'délai',
  delais: 'délais',
  duree: 'durée',
  reglement: 'règlement',
  reglementaire: 'réglementaire',
  autorisation_ok: 'autorisation accordée',
  diametre: 'diamètre',
  diametres: 'diamètres',
  epaisseur: 'épaisseur',
  epaisseurs: 'épaisseurs',
  quantite: 'quantité',
  quantites: 'quantités',
  numero: 'numéro',
  numeros: 'numéros',
  reference: 'référence',
  references: 'références',
  camera: 'caméra',
  cameras: 'caméras',
  achevement: 'achèvement',
  aussi_tot: 'aussitôt',
  des_que: 'dès que',
  cote: 'côté',
  cotes: 'côtés',
  entre_autre: 'entre autres',
  // Autres fautes d'orthographe courantes en français
  accompte: 'acompte',
  accueil_err: 'accueil',
  acceuil: 'accueil',
  acceuillir: 'accueillir',
  addresse: 'adresse',
  addresses: 'adresses',
  aparition: 'apparition',
  apercu: 'aperçu',
  appeller: 'appeler',
  appelles: 'appelés',
  arreter: 'arrêter',
  attente_err: 'attente',
  auparavent: 'auparavant',
  aussitot: 'aussitôt',
  bientot: 'bientôt',
  bonhomme: 'bonhomme',
  cailloux_err: 'cailloux',
  calendrier_err: 'calendrier',
  carriere: 'carrière',
  cathegorie: 'catégorie',
  celui_la: 'celui-là',
  ceux_la: 'ceux-là',
  changement_err: 'changement',
  charpente_err: 'charpente',
  ciment_err: 'ciment',
  cloture: 'clôture',
  clotures: 'clôtures',
  cloturer: 'clôturer',
  coherence: 'cohérence',
  colone: 'colonne',
  comission: 'commission',
  commencer_err: 'commencer',
  compagnie_err: 'compagnie',
  completement: 'complètement',
  concurence: 'concurrence',
  conduite_err: 'conduite',
  conection: 'connexion',
  connection: 'connexion',
  consequence: 'conséquence',
  continuel: 'continuel',
  contrainte_err: 'contrainte',
  coordonees: 'coordonnées',
  coordonnees: 'coordonnées',
  courament: 'couramment',
  creer: 'créer',
  cree: 'créé',
  creee: 'créée',
  critere: 'critère',
  criteres: 'critères',
  croisement_err: 'croisement',
  danger_err: 'danger',
  davantages: 'davantage',
  debout_err: 'debout',
  definitif: 'définitif',
  definitive: 'définitive',
  definitivement: 'définitivement',
  demain_err: 'demain',
  depart: 'départ',
  depassement: 'dépassement',
  derriere: 'derrière',
  desaccord: 'désaccord',
  developpement: 'développement',
  differend_err: 'différent',
  different: 'différent',
  differente: 'différente',
  differents: 'différents',
  differentes: 'différentes',
  difficilement_err: 'difficilement',
  difficulte: 'difficulté',
  difficultes: 'difficultés',
  directement_err: 'directement',
  disponibilite: 'disponibilité',
  dossier_err: 'dossier',
  echantillon: 'échantillon',
  echantillons: 'échantillons',
  echelle: 'échelle',
  echelles: 'échelles',
  eclat: 'éclat',
  eclairage: 'éclairage',
  ecrit: 'écrit',
  ecrite: 'écrite',
  ecriture: 'écriture',
  effondrement_err: 'effondrement',
  egalement: 'également',
  elevation: 'élévation',
  empeche: 'empêche',
  empechement: 'empêchement',
  emplacement_err: 'emplacement',
  encadre: 'encadré',
  encadrement_err: 'encadrement',
  enquete: 'enquête',
  ensemble_err: 'ensemble',
  entierement: 'entièrement',
  environement: 'environnement',
  environnement_err: 'environnement',
  epuisement: 'épuisement',
  erreur_err: 'erreur',
  etape: 'étape',
  etapes: 'étapes',
  etude: 'étude',
  etudes: 'études',
  evenementiel: 'événementiel',
  evidemment: 'évidemment',
  evident: 'évident',
  eviter: 'éviter',
  evite: 'évité',
  exactement_err: 'exactement',
  exemple_err: 'exemple',
  exigence_err: 'exigence',
  existant_err: 'existant',
  expedition: 'expédition',
  explication_err: 'explication',
  exterieur: 'extérieur',
  exterieure: 'extérieure',
  facilement_err: 'facilement',
  fenetre: 'fenêtre',
  fermeture_err: 'fermeture',
  fievre: 'fièvre',
  fourniture_err: 'fourniture',
  frequence: 'fréquence',
  frequent: 'fréquent',
  frequente: 'fréquente',
  garantie_err: 'garantie',
  generale: 'générale',
  generaux: 'généraux',
  grue_err: 'grue',
  hauteur_err: 'hauteur',
  heure_err: 'heure',
  hier_err: 'hier',
  horaire_err: 'horaire',
  hors_delai: 'hors délai',
  identique_err: 'identique',
  immediat: 'immédiat',
  immediate: 'immédiate',
  immediatement: 'immédiatement',
  important_err: 'important',
  independant: 'indépendant',
  independante: 'indépendante',
  indique: 'indiqué',
  indiquee: 'indiquée',
  inferieur: 'inférieur',
  inferieure: 'inférieure',
  information_err: 'information',
  installaton: 'installation',
  installations_err: 'installations',
  installe: 'installé',
  installee: 'installée',
  installes: 'installés',
  interdit_err: 'interdit',
  interessant: 'intéressant',
  interieur: 'intérieur',
  interieure: 'intérieure',
  intermediaire: 'intermédiaire',
  interruption_err: 'interruption',
  intervention_err: 'intervention',
  inutile_err: 'inutile',
  inventaire_err: 'inventaire',
  jamais_err: 'jamais',
  journee: 'journée',
  journees: 'journées',
  jusqua: "jusqu'à",
  laboratoire_err: 'laboratoire',
  langage: 'langage',
  largeur_err: 'largeur',
  limitation_err: 'limitation',
  limite_err: 'limite',
  livraison_err: 'livraison',
  localisation_err: 'localisation',
  logement_err: 'logement',
  longueur_err: 'longueur',
  lorsque_err: 'lorsque',
  maintenant_err: 'maintenant',
  maintenance_err: 'maintenance',
  maitre: 'maître',
  maitrise: 'maîtrise',
  maniere: 'manière',
  manquant_err: 'manquant',
  marche_err: 'marché',
  matin_err: 'matin',
  maximum_err: 'maximum',
  mecanique: 'mécanique',
  meme: 'même',
  memes: 'mêmes',
  mesure_err: 'mesure',
  methode: 'méthode',
  methodes: 'méthodes',
  metier: 'métier',
  metiers: 'métiers',
  millimetre: 'millimètre',
  millimetres: 'millimètres',
  minimum_err: 'minimum',
  mise_a_jour: 'mise à jour',
  modification_err: 'modification',
  modifie: 'modifié',
  modifiee: 'modifiée',
  moyen_err: 'moyen',
  moyenne_err: 'moyenne',
  neanmoins: 'néanmoins',
  necessaire: 'nécessaire',
  necessaires: 'nécessaires',
  negatif: 'négatif',
  negative: 'négative',
  niveau_err: 'niveau',
  normalement_err: 'normalement',
  note_err: 'note',
  nouveau_err: 'nouveau',
  nouvelle_err: 'nouvelle',
  objet_err: 'objet',
  obligation_err: 'obligation',
  observation_err: 'observation',
  occasion_err: 'occasion',
  occupation_err: 'occupation',
  operation: 'opération',
  operations: 'opérations',
  ordre_err: 'ordre',
  organisation_err: 'organisation',
  ouvert_err: 'ouvert',
  ouverture_err: 'ouverture',
  ouvrage_err: 'ouvrage',
  ouvrier_err: 'ouvrier',
  panne_err: 'panne',
  papier_err: 'papier',
  parcelle_err: 'parcelle',
  parfaitement_err: 'parfaitement',
  parking_err: 'parking',
  particulier_err: 'particulier',
  particuliere: 'particulière',
  passage_err: 'passage',
  pendant_err: 'pendant',
  periode: 'période',
  periodes: 'périodes',
  permis_err: 'permis',
  personne_err: 'personne',
  personnel_err: 'personnel',
  petit_err: 'petit',
  piece: 'pièce',
  pieces: 'pièces',
  pierre_err: 'pierre',
  plan_err: 'plan',
  pluie_err: 'pluie',
  plusieurs_err: 'plusieurs',
  point_err: 'point',
  police_err: 'police',
  pompage_err: 'pompage',
  pompe_err: 'pompe',
  pose_err: 'pose',
  posee: 'posée',
  poses: 'posés',
  position_err: 'position',
  possible_err: 'possible',
  poteau_err: 'poteau',
  poussiere: 'poussière',
  poussieres: 'poussières',
  prealable: 'préalable',
  prealablement: 'préalablement',
  precaution: 'précaution',
  precautions: 'précautions',
  precedent: 'précédent',
  precedente: 'précédente',
  precis: 'précis',
  precise: 'précise',
  precision: 'précision',
  preferable: 'préférable',
  premier_err: 'premier',
  premiere: 'première',
  preparation: 'préparation',
  prepare: 'préparé',
  preparee: 'préparée',
  present: 'présent',
  presente: 'présente',
  presents: 'présents',
  presentes: 'présentes',
  pression_err: 'pression',
  prestation_err: 'prestation',
  prevoir: 'prévoir',
  principal_err: 'principal',
  priorite: 'priorité',
  prise_err: 'prise',
  procedure: 'procédure',
  procedures: 'procédures',
  prochain_err: 'prochain',
  produit_err: 'produit',
  profondeur_err: 'profondeur',
  programme_err: 'programme',
  progres: 'progrès',
  projet_err: 'projet',
  prolongation_err: 'prolongation',
  protection_err: 'protection',
  provisoire_err: 'provisoire',
  provisoirement_err: 'provisoirement',
  proximite: 'proximité',
  public_err: 'public',
  publique_err: 'publique',
  qualite: 'qualité',
  qualites: 'qualités',
  quartier_err: 'quartier',
  question_err: 'question',
  rabattement_err: 'rabattement',
  raccord_err: 'raccord',
  raison_err: 'raison',
  rapide_err: 'rapide',
  rapidement_err: 'rapidement',
  rapport_err: 'rapport',
  rassemblement_err: 'rassemblement',
  rayon_err: 'rayon',
  realisation: 'réalisation',
  recent: 'récent',
  recente: 'récente',
  recemment: 'récemment',
  recouvrement_err: 'recouvrement',
  rectification_err: 'rectification',
  recuperation: 'récupération',
  recupere: 'récupéré',
  reduction: 'réduction',
  refection: 'réfection',
  regard_err: 'regard',
  region: 'région',
  reglage: 'réglage',
  regle: 'réglé',
  reglee: 'réglée',
  regulier: 'régulier',
  reguliere: 'régulière',
  regulierement: 'régulièrement',
  relatif_err: 'relatif',
  remarque_err: 'remarque',
  remise_err: 'remise',
  remplacement_err: 'remplacement',
  rencontre_err: 'rencontre',
  renfort_err: 'renfort',
  renseignement_err: 'renseignement',
  reouverture: 'réouverture',
  reparer: 'réparer',
  repartition: 'répartition',
  repercussion: 'répercussion',
  repetition: 'répétition',
  reponse: 'réponse',
  reponses: 'réponses',
  reprise_err: 'reprise',
  requete: 'requête',
  reserve: 'réserve',
  reserves: 'réserves',
  resistance: 'résistance',
  resolu: 'résolu',
  responsabilite: 'responsabilité',
  responsable_err: 'responsable',
  resultat: 'résultat',
  resultats: 'résultats',
  retard_err: 'retard',
  retour_err: 'retour',
  retrait_err: 'retrait',
  reussite: 'réussite',
  revetement: 'revêtement',
  revetements: 'revêtements',
  revision: 'révision',
  risque_err: 'risque',
  rivage_err: 'rivage',
  riverain_err: 'riverain',
  route_err: 'route',
  rue_err: 'rue',
  sable_err: 'sable',
  saison_err: 'saison',
  sanitaire_err: 'sanitaire',
  sans_objet_err: 'sans objet',
  satisfaction_err: 'satisfaction',
  schema: 'schéma',
  schemas: 'schémas',
  seance: 'séance',
  sec_err: 'sec',
  sechage: 'séchage',
  section_err: 'section',
  secteur_err: 'secteur',
  semaine_err: 'semaine',
  sensibilite: 'sensibilité',
  separation: 'séparation',
  separe: 'séparé',
  separee: 'séparée',
  serrage_err: 'serrage',
  service_err: 'service',
  seulement_err: 'seulement',
  signalement_err: 'signalement',
  signature_err: 'signature',
  signe: 'signé',
  situation_err: 'situation',
  societe: 'société',
  soiree: 'soirée',
  sol_err: 'sol',
  sollicitation_err: 'sollicitation',
  solution_err: 'solution',
  sondage_err: 'sondage',
  sortie_err: 'sortie',
  soubassement_err: 'soubassement',
  soudage_err: 'soudage',
  soudure_err: 'soudure',
  soulevement: 'soulèvement',
  source_err: 'source',
  sous_traitant_err: 'sous-traitant',
  soutien_err: 'soutien',
  special: 'spécial',
  speciale: 'spéciale',
  speciaux: 'spéciaux',
  specialise: 'spécialisé',
  specification: 'spécification',
  specifique: 'spécifique',
  stabilisation_err: 'stabilisation',
  stabilite: 'stabilité',
  station_err: 'station',
  stockage_err: 'stockage',
  structure_err: 'structure',
  subbase_err: 'sous-fondation',
  suffisant_err: 'suffisant',
  suite_err: 'suite',
  suivant_err: 'suivant',
  suivi_err: 'suivi',
  superieur: 'supérieur',
  superieure: 'supérieure',
  supplement: 'supplément',
  supplementaire: 'supplémentaire',
  supplementaires: 'supplémentaires',
  support_err: 'support',
  suppression_err: 'suppression',
  supprime: 'supprimé',
  supprimee: 'supprimée',
  surface_err: 'surface',
  surveillance_err: 'surveillance',
  surveillant_err: 'surveillant',
  suspension_err: 'suspension',
  systematique: 'systématique',
  systeme: 'système',
  systemes: 'systèmes',
  tache: 'tâche',
  taches: 'tâches',
  talus_err: 'talus',
  tarif_err: 'tarif',
  tassement_err: 'tassement',
  technique_err: 'technique',
  telephone: 'téléphone',
  temporaire_err: 'temporaire',
  temps_err: 'temps',
  tenue_err: 'tenue',
  terrain_err: 'terrain',
  terre_err: 'terre',
  test_err: 'test',
  texte_err: 'texte',
  tolerances: 'tolérances',
  tolerance: 'tolérance',
  total_err: 'total',
  totalement_err: 'totalement',
  trace_err: 'tracé',
  tractopelle_err: 'tractopelle',
  trafic_err: 'trafic',
  traitement_err: 'traitement',
  transmis_err: 'transmis',
  transmission_err: 'transmission',
  transport_err: 'transport',
  travail_err: 'travail',
  travaux_err: 'travaux',
  traversee: 'traversée',
  traversees: 'traversées',
  treillis_err: 'treillis',
  troncon: 'tronçon',
  troncons: 'tronçons',
  tuyau_err: 'tuyau',
  tuyaux_err: 'tuyaux',
  unite: 'unité',
  unites: 'unités',
  urgence_err: 'urgence',
  usage_err: 'usage',
  utilisation_err: 'utilisation',
  utilise: 'utilisé',
  utilisee: 'utilisée',
  utilises: 'utilisés',
  valeur_err: 'valeur',
  validation_err: 'validation',
  vanne_err: 'vanne',
  variable_err: 'variable',
  variation_err: 'variation',
  verification: 'vérification',
  verifications: 'vérifications',
  verifier: 'vérifier',
  vetuste: 'vétuste',
  viabilite: 'viabilité',
  vidange_err: 'vidange',
  vitesse_err: 'vitesse',
  voie_err: 'voie',
  voirie_err: 'voirie',
  voisinage_err: 'voisinage',
  volume_err: 'volume',
  zone_err: 'zone',
};

// Keep only entries where key !== clean normalized value (filter out *_err placeholders cleanly)
const CLEAN_MISSPELLINGS: Record<string, string> = Object.fromEntries(
  Object.entries(MISSPELLINGS).filter(
    ([k, v]) => !k.endsWith('_err') && k !== v.toLowerCase()
  )
);

const PHRASE_FIXES: Array<{ regex: RegExp; replacement: string; label: string }> = [
  { regex: /\baujourd\s+hui\b/gi, replacement: "aujourd'hui", label: "aujourd'hui" },
  { regex: /\bc\s+est\b/gi, replacement: "c'est", label: "c'est" },
  { regex: /\bn\s+est\b/gi, replacement: "n'est", label: "n'est" },
  { regex: /\bqu\s+il\b/gi, replacement: "qu'il", label: "qu'il" },
  { regex: /\bqu\s+elle\b/gi, replacement: "qu'elle", label: "qu'elle" },
  { regex: /\bjusqu\s+(à|a)\b/gi, replacement: "jusqu'à", label: "jusqu'à" },
  { regex: /\bd\s+(un|une)\b/gi, replacement: "d'$1", label: "d'un(e)" },
  { regex: /\bl\s+(eau|égout|egout|entreprise|entrepreneur|équipe|equipe|essai|ouvrage)\b/gi, replacement: "l'$1", label: "l'…" },
  { regex: /\bmise\s+a\s+jour\b/gi, replacement: 'mise à jour', label: 'mise à jour' },
  { regex: /\bmise\s+a\s+niveau\b/gi, replacement: 'mise à niveau', label: 'mise à niveau' },
  { regex: /\bmain\s+d['’ ]?\s*oeuvre\b/gi, replacement: "main-d'œuvre", label: "main-d'œuvre" },
  { regex: /\bmaitre\s+d['’ ]?\s*ouvrage\b/gi, replacement: "maître d'ouvrage", label: "maître d'ouvrage" },
];

export type SpellTarget =
  | { kind: 'etatNote' }
  | { kind: 'ouvrierMetier'; index: number }
  | { kind: 'line'; field: JournalLineField; index: number };

export interface SpellIssue {
  id: string;
  target: SpellTarget;
  sectionLabel: string;
  originalText: string;
  flagged: string;
  suggestion: string;
  reason: string;
  canAddToDict: boolean;
  apply: (currentText: string) => string;
}

export function loadCustomDictionary(): Set<string> {
  try {
    const raw = localStorage.getItem(CUSTOM_DICT_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.map((w) => String(w).toLowerCase()))
      : new Set();
  } catch {
    return new Set();
  }
}

export function addWordToCustomDictionary(word: string): Set<string> {
  const dict = loadCustomDictionary();
  dict.add(word.trim().toLowerCase());
  try {
    localStorage.setItem(CUSTOM_DICT_KEY, JSON.stringify(Array.from(dict)));
  } catch {
    // ignore storage errors
  }
  return dict;
}

function matchCase(source: string, replacement: string): string {
  if (!source) return replacement;
  if (source === source.toUpperCase() && source.length > 1) {
    return replacement.toUpperCase();
  }
  if (
    source[0] === source[0].toUpperCase() &&
    source[0] !== source[0].toLowerCase()
  ) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function analyzeText(
  text: string,
  target: SpellTarget,
  sectionLabel: string,
  customDict: Set<string>
): SpellIssue[] {
  if (!text || !text.trim()) return [];
  const issues: SpellIssue[] = [];

  // 1. Double spaces
  if (/ {2,}/.test(text)) {
    issues.push({
      id: `${sectionLabel}-spaces`,
      target,
      sectionLabel,
      originalText: text,
      flagged: 'espaces multiples',
      suggestion: 'Supprimer les doubles espaces',
      reason: 'Typographie',
      canAddToDict: false,
      apply: (curr) => curr.replace(/ {2,}/g, ' ').trim(),
    });
  }

  // 2. Repeated consecutive words ("le le", "de de", etc.)
  const repeatRegex = /\b(le|la|les|de|du|des|un|une|et|en|à|au|aux|pour|sur|par|avec|dans)\s+\1\b/gi;
  let repMatch: RegExpExecArray | null;
  while ((repMatch = repeatRegex.exec(text)) !== null) {
    const dup = repMatch[0];
    const single = repMatch[1];
    issues.push({
      id: `${sectionLabel}-rep-${repMatch.index}`,
      target,
      sectionLabel,
      originalText: text,
      flagged: dup,
      suggestion: single,
      reason: 'Mot répété',
      canAddToDict: false,
      apply: (curr) => curr.replace(dup, single),
    });
  }

  // 3. Phrase expressions ("aujourd hui", "d un", etc.)
  for (const pf of PHRASE_FIXES) {
    pf.regex.lastIndex = 0;
    const m = pf.regex.exec(text);
    if (m) {
      const matched = m[0];
      const singleRegex = new RegExp(pf.regex.source, 'i');
      const suggestionText = matchCase(
        matched,
        matched.replace(singleRegex, pf.replacement)
      );
      issues.push({
        id: `${sectionLabel}-phrase-${pf.label}-${m.index}`,
        target,
        sectionLabel,
        originalText: text,
        flagged: matched,
        suggestion: suggestionText,
        reason: 'Apostrophe / expression',
        canAddToDict: false,
        apply: (curr) =>
          curr.replace(pf.regex, (arg0, g1?: string) =>
            matchCase(
              arg0,
              typeof g1 === 'string'
                ? pf.replacement.replace('$1', g1)
                : pf.replacement
            )
          ),
      });
    }
    pf.regex.lastIndex = 0;
  }

  // 4. Individual French & BTP accent/spelling checks
  const wordRegex = /[A-Za-zÀ-ÖØ-öø-ÿ]{3,}/g;
  let wm: RegExpExecArray | null;
  const seenWords = new Set<string>();
  while ((wm = wordRegex.exec(text)) !== null) {
    const word = wm[0];
    const lower = word.toLowerCase();
    if (customDict.has(lower) || seenWords.has(lower)) continue;

    const fix = CLEAN_MISSPELLINGS[lower];
    if (fix && fix !== lower) {
      seenWords.add(lower);
      const casedFix = matchCase(word, fix);
      const exactRegex = new RegExp(
        `(^|[^A-Za-zÀ-ÖØ-öø-ÿ])${word}(?![A-Za-zÀ-ÖØ-öø-ÿ])`,
        'g'
      );
      issues.push({
        id: `${sectionLabel}-word-${lower}-${wm.index}`,
        target,
        sectionLabel,
        originalText: text,
        flagged: word,
        suggestion: casedFix,
        reason: 'Orthographe / accent',
        canAddToDict: true,
        apply: (curr) => curr.replace(exactRegex, `$1${casedFix}`),
      });
    }
  }

  // 5. Lowercase initial at start of entry (3+ letters)
  const trimmed = text.trimStart();
  if (/^[a-zàâäéèêëîïôöùûüç]{2,}/.test(trimmed)) {
    const firstWordMatch = /^[a-zàâäéèêëîïôöùûüç]+/.exec(trimmed);
    const firstWord = firstWordMatch?.[0] || '';
    if (
      firstWord &&
      !['ml', 'kg', 'cm', 'mm', 'km', 'etc', 'env'].includes(firstWord)
    ) {
      const capitalized = firstWord[0].toUpperCase() + firstWord.slice(1);
      issues.push({
        id: `${sectionLabel}-cap`,
        target,
        sectionLabel,
        originalText: text,
        flagged: firstWord,
        suggestion: capitalized,
        reason: 'Majuscule en début de ligne',
        canAddToDict: false,
        apply: (curr) =>
          curr.replace(
            /^(\s*)([a-zàâäéèêëîïôöùûüç])/,
            (_, sp: string, ch: string) => `${sp}${ch.toUpperCase()}`
          ),
      });
    }
  }

  return issues;
}

const ETAT_PRESETS = new Set([
  'Sec',
  'Nuageux',
  'Pluie',
  'Averses',
  'Neige',
  'Gel',
  'Vent fort',
  'Brouillard',
  'Orage',
]);

export function checkJournalSpelling(
  journal: Journal,
  customDict: Set<string> = loadCustomDictionary()
): SpellIssue[] {
  const issues: SpellIssue[] = [];

  const etatNote = (journal.etatAtmo || []).find((x) => !ETAT_PRESETS.has(x));
  if (etatNote) {
    issues.push(
      ...analyzeText(etatNote, { kind: 'etatNote' }, 'Météo', customDict)
    );
  }

  (journal.ouvriers || []).forEach((o, index) => {
    if (o.metier?.trim()) {
      issues.push(
        ...analyzeText(
          o.metier,
          { kind: 'ouvrierMetier', index },
          `A. Ouvriers (ligne ${index + 1})`,
          customDict
        )
      );
    }
  });

  const sections: Array<{ field: JournalLineField; label: string }> = [
    { field: 'travaux', label: 'B. Travaux' },
    { field: 'materiel', label: 'C. Matériel' },
    { field: 'materiaux', label: 'E. Matériaux' },
    { field: 'essais', label: 'F. Essais' },
    { field: 'evenements', label: 'H. Événements' },
    { field: 'decisions', label: 'J. Décisions' },
    { field: 'visites', label: 'K. Visites' },
  ];

  for (const sec of sections) {
    (journal[sec.field] || []).forEach((line, index) => {
      if (line?.trim()) {
        issues.push(
          ...analyzeText(
            line,
            { kind: 'line', field: sec.field, index },
            `${sec.label} (l.${index + 1})`,
            customDict
          )
        );
      }
    });
  }

  return issues;
}
