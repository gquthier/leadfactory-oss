import { type SequenceContext, formatContextForPrompt } from "@/lib/sequence-context";

export function buildLinkedInPostPrompt(ctx: SequenceContext, angle: string, framework: string): string {
  return [
    "Tu es un copywriter LinkedIn senior. Tu vas générer UN seul post LinkedIn percutant.",
    "",
    "RÈGLES ALGO LINKEDIN 2026 (NON-NÉGOCIABLES) :",
    "- 1re ligne ≤ 8 mots (hook isolé)",
    "- Pas de mot négatif dans le hook",
    "- 1 200 à 1 900 caractères au total",
    "- Coupure 'voir plus' à ~210 caractères : la curiosité doit y être",
    "- Paragraphes ultra courts (1-3 lignes)",
    "- 0-3 hashtags max",
    "- Voix HUMAINE, pas voix de presse release",
    "- INTERDIT : delve, leverage, harness, à l'ère du digital, dans un monde, game changer, voici l'astuce, em-dashes en boucle",
    "- CTA spécifique appelant une réponse de 30+ mots (pas 'What do you think?')",
    "",
    `FRAMEWORK À UTILISER : ${framework}`,
    `ANGLE DU POST : ${angle}`,
    "",
    "CONTEXTE CLIENT :",
    formatContextForPrompt(ctx),
    "",
    "FORMAT DE SORTIE — Réponds STRICTEMENT en JSON brut (pas de markdown autour) :",
    "{",
    '  "hook": "la 1re ligne du post (≤ 8 mots)",',
    '  "body": "le post complet, y compris la hook répétée en 1re ligne, avec sauts de ligne \\n",',
    '  "framework": "nom du framework",',
    '  "angle": "résumé de l\'angle en 1 phrase"',
    "}",
  ].join("\n");
}

export function buildColdEmailSequencePrompt(ctx: SequenceContext, angle: string): string {
  return [
    "Tu es un copywriter cold email B2B senior.",
    "Tu vas générer UNE séquence de 4 emails cold outbound (J+0, J+3, J+7, J+12).",
    "",
    "RÈGLES :",
    "- Subject < 50 caractères, jamais 'Quick question' ou 'Hey'",
    "- Une seule idée par email, 80-150 mots max",
    "- Spécificité > généralités",
    "- CTA bas-engagement (question simple)",
    "- Voix humaine, pas 'À l'ère du digital'",
    "",
    `ANGLE STRATÉGIQUE DE LA SÉQUENCE : ${angle}`,
    "",
    "CONTEXTE CLIENT :",
    formatContextForPrompt(ctx),
    "",
    "FORMAT DE SORTIE — JSON brut strict, sans markdown autour :",
    "{",
    '  "name": "Nom court de la séquence (ex: Approche directe ROI)",',
    '  "angle": "résumé angle en 1 phrase",',
    '  "emails": [',
    '    { "step": "Email 1 — J+0", "subject": "…", "body": "…", "wait_days": 0 },',
    '    { "step": "Email 2 — J+3", "subject": "…", "body": "…", "wait_days": 3 },',
    '    { "step": "Email 3 — J+7", "subject": "…", "body": "…", "wait_days": 7 },',
    '    { "step": "Email 4 — J+12", "subject": "…", "body": "…", "wait_days": 12 }',
    "  ]",
    "}",
  ].join("\n");
}

export function buildCallScriptPrompt(ctx: SequenceContext): string {
  return [
    "Tu es un coach commercial senior. Tu vas générer UN script de cold call B2B en français.",
    "",
    "STRUCTURE OBLIGATOIRE :",
    "1. OUVERTURE (10 secondes) — Permission directe, pas de fausse familiarité",
    "2. RAISON D'APPEL (15 secondes) — Spécifique au prospect, pattern interrupt",
    "3. QUALIFICATION (3 questions max)",
    "4. PITCH (45 secondes) — Bénéfice concret + preuve",
    "5. OBJECTIONS PRÉVUES (top 4 + réponses calibrées)",
    "6. CTA — Demande de RDV calé sur un créneau précis",
    "",
    "RÈGLES :",
    "- Pas de 'Comment allez-vous ?' au début (rejette)",
    "- Pas de pitch monologue de 2 minutes",
    "- Le commercial doit poser 1 question toutes les 30 sec max",
    "- Ton direct, humain, jamais robotique",
    "",
    "CONTEXTE CLIENT (offre, cible, promesse, objections fréquentes) :",
    formatContextForPrompt(ctx),
    "",
    "FORMAT DE SORTIE — JSON brut strict, pas de markdown autour :",
    "{",
    '  "name": "Script Cold Call - <ICP cible>",',
    '  "opening": "le texte exact à dire pour l\'ouverture",',
    '  "reason": "le texte exact pour la raison d\'appel",',
    '  "qualification_questions": ["q1", "q2", "q3"],',
    '  "pitch": "le pitch core, 30-45 sec parlées",',
    '  "objections": [',
    '    { "objection": "…", "response": "…" },',
    '    { "objection": "…", "response": "…" },',
    '    { "objection": "…", "response": "…" },',
    '    { "objection": "…", "response": "…" }',
    '  ],',
    '  "cta": "le CTA final exact",',
    '  "tips": "2-3 conseils tactiques pour ce script"',
    "}",
  ].join("\n");
}

/**
 * Plan des 10 posts LinkedIn — variation framework × angle.
 * Donne au LLM une matrice de prompts diverse pour éviter la redondance.
 */
export const LINKEDIN_POST_PLAN: Array<{ framework: string; angle: string }> = [
  { framework: "PAIPS", angle: "Pain principal de la cible — agitation puis preuve + step" },
  { framework: "VFA", angle: "Story personnel : moment de vulnérabilité avant le pivot vers l'offre" },
  { framework: "Relatable Enemy", angle: "Crée un ennemi commun : le conseil populaire mais faux que les autres répètent" },
  { framework: "SLAY", angle: "Specific story client → leçon métier → application universelle → yield" },
  { framework: "PAS", angle: "Problem cible → agite avec data/anecdote → solution = l'offre" },
  { framework: "Rule of One", angle: "UN seul insight contrarian niveau expert" },
  { framework: "Hook/Retain/Reward", angle: "Promesse forte → tension narrative → résolution actionnable" },
  { framework: "Confessional", angle: "Vulnérabilité business : ce que je faisais mal pendant X années" },
  { framework: "PAIPS", angle: "Différenciant unique de l'offre formulé contre les alternatives" },
  { framework: "PAS", angle: "Carrousel-ready : liste de 5 erreurs que la cible fait sans le savoir" },
];

export const COLD_EMAIL_ANGLES: Array<{ name: string; angle: string }> = [
  {
    name: "Approche directe ROI",
    angle: "Frontal sur le ROI mesurable. Subject avec chiffre. Body court, preuve sociale + question simple sur leur situation actuelle.",
  },
  {
    name: "Approche pattern interrupt",
    angle: "Hook contrarian dans le subject. Ouverture qui défie une croyance commune. Body qui pose un problème caché que la cible n'a pas encore formulé.",
  },
];
