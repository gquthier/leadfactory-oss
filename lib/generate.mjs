// Modèles préremplis 100 % déterministes : aucune IA, aucun aléatoire, aucun envoi.
// Même entrée => même sortie, octet pour octet.

import { onboardingProgress, onboardingSummaryLines } from './onboarding.mjs';

const NOTICE =
  '> Modèle prérempli généré localement à partir des champs du client. ' +
  'Aucune IA, aucun envoi, aucun visuel image ou vidéo. À relire et adapter avant usage.';

function fallback(value, alt) {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw === '' ? alt : raw;
}

function contactName(client) {
  return fallback(client.contact, 'l\'équipe');
}

/** Preuves : uniquement celles saisies dans le questionnaire, jamais inventées. */
function proofsOf(client) {
  return fallback(client.onboarding?.offer?.proofs, '');
}

function proofLine(client, placeholder) {
  const proofs = proofsOf(client);
  return proofs === '' ? placeholder : `- Preuves fournies par le client : ${proofs}`;
}

export function coldEmailSequence(client, campaign = null) {
  const company = fallback(client.company, 'votre entreprise');
  const audience = fallback(client.audience, 'la cible définie avec le client');
  const offer = fallback(client.offer, 'l\'offre du client');
  const goal = fallback(campaign?.goal || client.goal, 'obtenir des rendez-vous qualifiés');
  const contact = contactName(client);

  return [
    NOTICE,
    '',
    `# Séquence cold email - ${company}`,
    campaign ? `Campagne : ${campaign.name} (canal ${campaign.channel})` : 'Campagne : non liée',
    `Cible : ${audience}`,
    `Objectif : ${goal}`,
    '',
    '## Message 1 - Prise de contact',
    'Objet : question rapide sur {{sujet_prospect}}',
    '',
    'Bonjour {{prenom}},',
    '',
    `Je travaille avec ${company} sur ${offer}.`,
    `Nous échangeons en ce moment avec ${audience}, et le sujet qui revient est {{probleme_observe}}.`,
    '',
    'Est-ce un sujet chez vous en ce moment ?',
    '',
    `${contact}`,
    '',
    '## Message 2 - Relance valeur (J+3)',
    'Objet : Re: question rapide sur {{sujet_prospect}}',
    '',
    'Bonjour {{prenom}},',
    '',
    'Je complète mon message précédent avec un point concret :',
    '- Constat : {{probleme_observe}}',
    `- Approche : ${offer}`,
    proofLine(client, '- Preuve : {{preuve_client}} (aucune preuve fournie dans le questionnaire)'),
    '- Point de depart : {{premier_pas_propose}}',
    '',
    'Souhaitez-vous que je détaille en 15 minutes ?',
    '',
    `${contact}`,
    '',
    '## Message 3 - Clôture polie (J+7)',
    'Objet : je referme le sujet ?',
    '',
    'Bonjour {{prenom}},',
    '',
    'Sans retour de votre part, je considère que ce n\'est pas la priorité du moment.',
    'Je reste disponible si le sujet revient sur la table ce trimestre.',
    '',
    `${contact}`,
    '',
    '## À compléter avant envoi',
    '- {{prenom}}, {{sujet_prospect}}, {{probleme_observe}}, {{premier_pas_propose}}',
    '- Vérifier la liste de destinataires, le consentement et le lien de désinscription.'
  ].join('\n');
}

export function creativeBrief(client, campaign = null) {
  const company = fallback(client.company, 'le client');
  const audience = fallback(client.audience, 'à définir avec le client');
  const offer = fallback(client.offer, 'à définir');
  const goal = fallback(campaign?.goal || client.goal, 'à définir');
  const channel = campaign ? campaign.channel : 'à définir';
  const budget = campaign ? campaign.budget : client.budget;

  return [
    NOTICE,
    '',
    `# Brief créatif - ${company}`,
    campaign ? `Campagne : ${campaign.name}` : 'Campagne : non liée',
    `Canal : ${channel}`,
    `Budget de référence : ${budget} EUR`,
    '',
    '## Contexte',
    `- Offre : ${offer}`,
    `- Audience : ${audience}`,
    `- Objectif : ${goal}`,
    '',
    '## Message principal',
    `- Promesse : ${fallback(client.onboarding?.offer?.promise, `${offer} pour ${audience}`)}.`,
    proofLine(client, '- Preuve à fournir par le client : {{preuve_client}}'),
    client.onboarding?.target?.exclusions ? `- Exclusions (no-go) : ${client.onboarding.target.exclusions}` : null,
    '- Appel à l\'action : {{cta}}',
    '',
    '## Formats à produire (par un humain ou un outil dédié)',
    '- 3 accroches courtes (max 40 caractères)',
    '- 2 descriptions (max 150 caractères)',
    '- 1 script vidéo de 20 secondes (texte uniquement)',
    '',
    '## Contraintes',
    '- Ton : {{ton_de_marque}}',
    '- Interdits : promesses chiffrées non vérifiées, témoignages non valides.',
    '- Aucun visuel n\'est fourni ici : ce document est un brief texte.'
  ]
    .filter((line) => line !== null)
    .join('\n');
}

function missingSection(client) {
  const ob = client.onboarding;
  if (!ob) {
    return [
      '## Ce qu\'il manque',
      '- Questionnaire d\'onboarding non commencé',
      '- Accès aux outils (CRM, boîte d\'envoi, comptes publicitaires)',
      '- Personnes référentes et circuit de validation',
      '- Définition d\'un lead qualifié',
      '- Contraintes légales et de marque'
    ];
  }
  const progress = onboardingProgress(ob);
  const lines = [`## Questionnaire d'onboarding (${progress.filled}/${progress.total} champs requis, statut ${ob.status})`];
  lines.push(...onboardingSummaryLines(ob));
  if (progress.missing.length > 0) {
    lines.push('## Ce qu\'il manque');
    for (const m of progress.missing) lines.push(`- ${m.stepLabel} › ${m.label}`);
  }
  if (!ob.delivery?.accessGranted) lines.push('- Accès aux comptes : non accordés (à demander via invitation plateforme)');
  return lines;
}

export function onboardingBrief(client) {
  const company = fallback(client.company, 'le client');
  return [
    NOTICE,
    '',
    `# Brief onboarding - ${company}`,
    `Contact : ${fallback(client.contact, 'à renseigner')}`,
    `Email : ${fallback(client.email, 'à renseigner')}`,
    `Statut : ${client.status}`,
    `Budget déclaré : ${client.budget} EUR`,
    '',
    '## Ce que nous savons',
    `- Offre : ${fallback(client.offer, 'à renseigner')}`,
    `- Audience : ${fallback(client.audience, 'à renseigner')}`,
    `- Objectif : ${fallback(client.goal, 'à renseigner')}`,
    `- Notes : ${fallback(client.notes, 'aucune note')}`,
    '',
    ...missingSection(client),
    '',
    '## Prochaines étapes',
    '1. Appel de cadrage',
    '2. Collecte des accès',
    '3. Validation du positionnement',
    '4. Préparation de la première campagne'
  ].join('\n');
}

export const GENERATORS = {
  'cold-email': {
    label: 'Séquence cold email (3 messages)',
    deliverableType: 'cold-email',
    title: 'Séquence cold email (modèle)',
    build: coldEmailSequence
  },
  'creative-brief': {
    label: 'Brief créatif',
    deliverableType: 'creative-brief',
    title: 'Brief créatif (modèle)',
    build: creativeBrief
  },
  'onboarding-brief': {
    label: 'Brief onboarding',
    deliverableType: 'brief',
    title: 'Brief onboarding (modèle)',
    build: (client) => onboardingBrief(client)
  }
};

// --- Prompts IA -------------------------------------------------------------
// Le modèle prérempli sert de structure ; seules les preuves saisies sont transmises.

const LANGUAGE_LABEL = { fr: 'français', en: 'anglais' };

function clientContext(client, campaign) {
  const lines = [
    `Entreprise : ${fallback(client.company, 'non renseignée')}`,
    `Signataire : ${fallback(client.contact, 'non renseigné')}`,
    `Offre : ${fallback(client.offer, 'non renseignée')}`,
    `Audience : ${fallback(client.audience, 'non renseignée')}`,
    `Objectif : ${fallback(client.goal, 'non renseigné')}`,
    `Budget mensuel : ${client.budget} EUR`,
    `Notes : ${fallback(client.notes, 'aucune')}`
  ];
  if (campaign) {
    lines.push(
      `Campagne : ${campaign.name} (canal ${campaign.channel}, statut ${campaign.status}, budget ${campaign.budget} EUR)`,
      `Objectif de campagne : ${fallback(campaign.goal, 'non renseigné')}`
    );
  }
  const summary = onboardingSummaryLines(client.onboarding);
  if (summary.length > 0) lines.push('', 'Questionnaire d\'onboarding :', ...summary);
  return lines.join('\n');
}

export function buildAiMessages(kind, client, campaign, agency) {
  const generator = GENERATORS[kind];
  const language = LANGUAGE_LABEL[agency?.language] ?? 'français';
  const proofs = proofsOf(client);
  const template = generator.build(client, campaign).replace(`${NOTICE}\n\n`, '');
  const system = [
    `Tu es le rédacteur d'une agence de génération de leads${agency?.name ? ` (${agency.name})` : ''}.`,
    `Tu écris en ${language}, en texte Markdown uniquement.`,
    'Règles strictes :',
    '- N\'invente aucune preuve, aucun chiffre, aucun témoignage. Utilise seulement les preuves fournies ci-dessous ; sinon indique {{preuve_a_fournir}}.',
    '- Ne produis pas d\'image ni de vidéo et ne prétends pas en avoir produit.',
    '- Respecte les exclusions (no-go) et contraintes du client.',
    '- Conserve les variables entre doubles accolades quand une information manque.',
    proofs === '' ? 'Preuves fournies : aucune.' : `Preuves fournies : ${proofs}`
  ].join('\n');
  const user = [
    `Rédige : ${generator.label}.`,
    '',
    '## Contexte client (seules données disponibles)',
    clientContext(client, campaign),
    '',
    '## Structure attendue (modèle à remplir et améliorer, pas à recopier tel quel)',
    template
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

/** Checklist d'onboarding : clés stables, utilisées pour l'idempotence. */
export const ONBOARDING_CHECKLIST = [
  { key: 'kickoff', title: 'Onboarding : planifier l\'appel de cadrage' },
  { key: 'access', title: 'Onboarding : récupérer les accès (CRM, boîte d\'envoi, comptes ads)' },
  { key: 'icp', title: 'Onboarding : valider l\'audience cible et la définition d\'un lead qualifié' },
  { key: 'offer', title: 'Onboarding : valider l\'offre et les arguments' },
  { key: 'assets', title: 'Onboarding : collecter logos, preuves et contraintes de marque' },
  { key: 'tracking', title: 'Onboarding : mettre en place le suivi des leads' },
  { key: 'first-campaign', title: 'Onboarding : préparer la première campagne' }
];
