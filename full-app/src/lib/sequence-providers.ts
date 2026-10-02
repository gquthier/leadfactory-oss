/**
 * Catalogue des outils de prospection outbound supportés.
 *
 * Chaque provider définit :
 *   - sa syntaxe de merge tag ({{firstName}} vs {{first_name}} vs {first_name} etc.)
 *   - les variables natives disponibles (et leur "intent" : prénom, nom, entreprise, …)
 *   - des notes sur les particularités (fallback values, spintax, …)
 *
 * Quand le client sélectionne un provider, on injecte le set de variables
 * correspondant dans le system prompt. L'IA n'a plus qu'à utiliser EXACTEMENT
 * ces tokens dans les `body` et `subject` des emails — copier-coller direct
 * possible dans l'outil sans renommage.
 */

export type SequenceProvider =
  | "emelia"
  | "lemlist"
  | "smartlead"
  | "instantly"
  | "lagrowthmachine"
  | "heyreach"
  | "apollo"
  | "woodpecker"
  | "none";

export interface MergeTag {
  /** Token exact à utiliser dans les emails */
  token: string;
  /** Intent générique pour que l'IA sache à quoi sert la variable */
  intent: "firstName" | "lastName" | "fullName" | "company" | "jobTitle" | "email" | "linkedinUrl" | "city" | "website" | "industry" | "icebreaker" | "custom";
  /** Label humain pour l'UI */
  label: string;
}

export interface ProviderSpec {
  id: SequenceProvider;
  label: string;
  description: string;
  /** Documentation du format pour l'IA (1-2 phrases) */
  format: string;
  /** Si le provider supporte le spintax {a|b|c} */
  supportsSpintax: boolean;
  /** Si on peut définir des fallback values (ex: {{firstName | "there"}}) */
  fallbackSyntax?: string;
  tags: MergeTag[];
}

export const PROVIDERS: Record<SequenceProvider, ProviderSpec> = {
  none: {
    id: "none",
    label: "Aucun (texte simple)",
    description: "Pas de merge tags. Idéal pour brouillonner du copy sans personnalisation automatique.",
    format: "Pas de merge tags — écrire en texte simple, sans tokens.",
    supportsSpintax: false,
    tags: [],
  },

  emelia: {
    id: "emelia",
    label: "Emelia",
    description: "Format double accolade `{{camelCase}}`",
    format: "Emelia utilise des merge tags en double accolade au format camelCase, ex: {{firstName}}, {{companyName}}.",
    supportsSpintax: true,
    fallbackSyntax: `{{firstName | "there"}}`,
    tags: [
      { token: "{{firstName}}", intent: "firstName", label: "Prénom" },
      { token: "{{lastName}}", intent: "lastName", label: "Nom" },
      { token: "{{companyName}}", intent: "company", label: "Entreprise" },
      { token: "{{jobTitle}}", intent: "jobTitle", label: "Poste" },
      { token: "{{email}}", intent: "email", label: "Email" },
      { token: "{{linkedinUrl}}", intent: "linkedinUrl", label: "LinkedIn" },
      { token: "{{website}}", intent: "website", label: "Site web" },
      { token: "{{city}}", intent: "city", label: "Ville" },
      { token: "{{industry}}", intent: "industry", label: "Industrie" },
    ],
  },

  lemlist: {
    id: "lemlist",
    label: "Lemlist",
    description: "Format double accolade `{{camelCase}}` + icebreaker IA",
    format: "Lemlist utilise des merge tags en double accolade. Le {{icebreaker}} est généré par l'IA Lemlist — à utiliser pour la 1re phrase de l'email d'ouverture.",
    supportsSpintax: true,
    fallbackSyntax: `{{firstName | "there"}}`,
    tags: [
      { token: "{{firstName}}", intent: "firstName", label: "Prénom" },
      { token: "{{lastName}}", intent: "lastName", label: "Nom" },
      { token: "{{companyName}}", intent: "company", label: "Entreprise" },
      { token: "{{jobTitle}}", intent: "jobTitle", label: "Poste" },
      { token: "{{linkedinUrl}}", intent: "linkedinUrl", label: "LinkedIn" },
      { token: "{{icebreaker}}", intent: "icebreaker", label: "Icebreaker IA Lemlist" },
      { token: "{{signature}}", intent: "custom", label: "Signature" },
    ],
  },

  smartlead: {
    id: "smartlead",
    label: "Smartlead",
    description: "Format double accolade `{{snake_case}}`",
    format: "Smartlead utilise des merge tags en double accolade au format snake_case, ex: {{first_name}}, {{company_name}}.",
    supportsSpintax: true,
    tags: [
      { token: "{{first_name}}", intent: "firstName", label: "Prénom" },
      { token: "{{last_name}}", intent: "lastName", label: "Nom" },
      { token: "{{company_name}}", intent: "company", label: "Entreprise" },
      { token: "{{title}}", intent: "jobTitle", label: "Titre" },
      { token: "{{email}}", intent: "email", label: "Email" },
      { token: "{{phone_number}}", intent: "custom", label: "Téléphone" },
      { token: "{{website}}", intent: "website", label: "Site web" },
      { token: "{{location}}", intent: "city", label: "Localisation" },
    ],
  },

  instantly: {
    id: "instantly",
    label: "Instantly",
    description: "Format double accolade `{{camelCase}}`",
    format: "Instantly utilise des merge tags en double accolade au format camelCase, ex: {{firstName}}, {{companyName}}.",
    supportsSpintax: true,
    fallbackSyntax: `{{firstName | "there"}}`,
    tags: [
      { token: "{{firstName}}", intent: "firstName", label: "Prénom" },
      { token: "{{lastName}}", intent: "lastName", label: "Nom" },
      { token: "{{companyName}}", intent: "company", label: "Entreprise" },
      { token: "{{title}}", intent: "jobTitle", label: "Titre" },
      { token: "{{email}}", intent: "email", label: "Email" },
      { token: "{{personalization}}", intent: "icebreaker", label: "Personnalisation IA" },
      { token: "{{website}}", intent: "website", label: "Site web" },
    ],
  },

  lagrowthmachine: {
    id: "lagrowthmachine",
    label: "La Growth Machine",
    description: "Format double pourcent `%FirstName%`",
    format: "La Growth Machine (LGM) utilise des merge tags entourés de pourcents, ex: %FirstName%, %CompanyName%.",
    supportsSpintax: false,
    tags: [
      { token: "%FirstName%", intent: "firstName", label: "Prénom" },
      { token: "%LastName%", intent: "lastName", label: "Nom" },
      { token: "%CompanyName%", intent: "company", label: "Entreprise" },
      { token: "%Job%", intent: "jobTitle", label: "Poste" },
      { token: "%Email%", intent: "email", label: "Email" },
      { token: "%LinkedinUrl%", intent: "linkedinUrl", label: "LinkedIn" },
      { token: "%Industry%", intent: "industry", label: "Industrie" },
      { token: "%Custom1%", intent: "custom", label: "Custom 1" },
    ],
  },

  heyreach: {
    id: "heyreach",
    label: "HeyReach",
    description: "Format double accolade `{firstName}` (simple)",
    format: "HeyReach utilise des merge tags en SIMPLE accolade, ex: {firstName}, {companyName}. Attention : une seule accolade, pas deux.",
    supportsSpintax: false,
    tags: [
      { token: "{firstName}", intent: "firstName", label: "Prénom" },
      { token: "{lastName}", intent: "lastName", label: "Nom" },
      { token: "{companyName}", intent: "company", label: "Entreprise" },
      { token: "{jobTitle}", intent: "jobTitle", label: "Poste" },
      { token: "{location}", intent: "city", label: "Localisation" },
    ],
  },

  apollo: {
    id: "apollo",
    label: "Apollo.io",
    description: "Format double accolade `{{first_name}}`",
    format: "Apollo.io utilise des merge tags en double accolade au format snake_case, ex: {{first_name}}, {{organization_name}}.",
    supportsSpintax: false,
    tags: [
      { token: "{{first_name}}", intent: "firstName", label: "Prénom" },
      { token: "{{last_name}}", intent: "lastName", label: "Nom" },
      { token: "{{organization_name}}", intent: "company", label: "Entreprise" },
      { token: "{{title}}", intent: "jobTitle", label: "Titre" },
      { token: "{{email}}", intent: "email", label: "Email" },
      { token: "{{linkedin_url}}", intent: "linkedinUrl", label: "LinkedIn" },
      { token: "{{city}}", intent: "city", label: "Ville" },
    ],
  },

  woodpecker: {
    id: "woodpecker",
    label: "Woodpecker",
    description: "Format double accolade `{{FIRST_NAME}}`",
    format: "Woodpecker utilise des merge tags en double accolade en MAJUSCULES snake_case, ex: {{FIRST_NAME}}, {{COMPANY}}.",
    supportsSpintax: true,
    fallbackSyntax: `{{FIRST_NAME|there}}`,
    tags: [
      { token: "{{FIRST_NAME}}", intent: "firstName", label: "Prénom" },
      { token: "{{LAST_NAME}}", intent: "lastName", label: "Nom" },
      { token: "{{COMPANY}}", intent: "company", label: "Entreprise" },
      { token: "{{TITLE}}", intent: "jobTitle", label: "Titre" },
      { token: "{{EMAIL}}", intent: "email", label: "Email" },
      { token: "{{WEBSITE}}", intent: "website", label: "Site web" },
      { token: "{{INDUSTRY}}", intent: "industry", label: "Industrie" },
    ],
  },
};

export const PROVIDER_LIST: ProviderSpec[] = [
  PROVIDERS.emelia,
  PROVIDERS.lemlist,
  PROVIDERS.smartlead,
  PROVIDERS.instantly,
  PROVIDERS.lagrowthmachine,
  PROVIDERS.heyreach,
  PROVIDERS.apollo,
  PROVIDERS.woodpecker,
  PROVIDERS.none,
];

export function getProvider(id: string | undefined | null): ProviderSpec {
  if (!id || !(id in PROVIDERS)) return PROVIDERS.none;
  return PROVIDERS[id as SequenceProvider];
}

/**
 * Génère le bloc d'instructions à injecter dans le system prompt pour que
 * l'IA utilise les bonnes variables dans les emails générés.
 */
export function formatProviderInstructions(provider: ProviderSpec): string {
  if (provider.id === "none") {
    return `## VARIABLES DE PERSONNALISATION

Aucun outil d'envoi sélectionné. Écris le copy en texte simple, SANS merge tags. Utilise des placeholders en français entre crochets si nécessaire, ex: [prénom du prospect].`;
  }

  const tagsList = provider.tags
    .map((t) => `- \`${t.token}\` — ${t.label}`)
    .join("\n");

  const spintax = provider.supportsSpintax
    ? `\n- **Spintax supporté** : tu peux utiliser \`{Hello|Hi|Hey}\` pour varier les formulations.`
    : "";

  const fallback = provider.fallbackSyntax
    ? `\n- **Fallback values supportées** : ex: \`${provider.fallbackSyntax}\` (utilise "there" si le prénom est manquant).`
    : "";

  return `## VARIABLES DE PERSONNALISATION

L'utilisateur va envoyer ces emails depuis **${provider.label}**. Tu DOIS utiliser les merge tags ci-dessous EXACTEMENT tels qu'écrits, copier-collables directement dans ${provider.label} sans modification.

${provider.format}

**Variables disponibles** :
${tagsList}${spintax}${fallback}

**Règles d'utilisation** :
- Personnalise au moins le prénom dans le subject ou la 1re ligne du body de chaque email.
- N'invente PAS de nouveaux merge tags — utilise uniquement ceux listés ci-dessus.
- Si une info n'a pas de variable dédiée (ex: secteur d'activité du prospect), évite de l'utiliser ou demande au client s'il a une custom variable configurée.
- Respecte la casse et la syntaxe exacte (accolades simples vs doubles vs pourcents).`;
}
