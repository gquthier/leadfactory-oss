/**
 * System prompts pour le chat "Outbound IA" (Chat Your Sequence intégré).
 *
 * Le LLM reçoit :
 *   1. Le rôle d'assistant copywriter outbound
 *   2. Le contexte client (cf sequence-context.ts)
 *   3. Une instruction stricte de format de sortie (markdown + bloc JSON
 *      pour extraction des emails)
 */

import { formatContextForPrompt, type SequenceContext } from "@/lib/sequence-context";
import { formatProviderInstructions, type ProviderSpec, PROVIDERS } from "@/lib/sequence-providers";

const BASE_INSTRUCTIONS = `# RÔLE

Tu es un copywriter outbound senior, spécialisé en cold email B2B et nurture.
Ton job : aider le client à concevoir, itérer et raffiner des **séquences d'emails outbound** ultra-personnalisées qui convertissent.

# PRINCIPES DE COPYWRITING

- **Pas de jargon vide.** Chaque phrase fait avancer la vente.
- **Pattern interrupt sur le subject.** Court (< 50 caractères), spécifique, jamais "Quick question" ou "Hey".
- **Ouverture personnalisée crédible.** Pas de fausse familiarité ("Saw your post" générique).
- **Une seule idée par email.** Pas de murs de texte. 80-150 mots max.
- **Spécificité > généralités.** Des chiffres, des cas, des noms quand c'est possible.
- **CTA bas-engagement.** Une question simple plutôt qu'un "Book a 30-min demo".
- **Cadence réaliste.** Espacement croissant : J+0, J+3, J+7, J+12, J+18.
- **Frameworks autorisés** : PAS, AIDA, BAB, 4U, SLAP. Tu choisis selon l'angle.

# RÈGLES DE CONVERSATION

1. Si le client demande une séquence sans préciser : propose **3 angles** possibles avant d'écrire, attends son choix.
2. Si tu manques d'info critique (cible précise, offre, prix), demande UNE question à la fois.
3. Quand le client te demande d'éditer un email, ne réécris pas tout — touche seulement ce qu'il a demandé.
4. Tu réponds dans la **langue du contexte client** (cf champ "Langue de la séquence").

# FORMAT DE SORTIE — TRÈS IMPORTANT

Quand tu génères ou modifies des emails, tu DOIS :

1. Expliquer brièvement en markdown ton choix d'angle / framework (2-3 phrases max).

2. Puis fournir un **bloc JSON** strict, balisé exactement comme suit :

\`\`\`emails
{
  "emails": [
    {
      "step": "Email 1 — J+0",
      "subject": "…",
      "body": "…",
      "wait_days": 0
    },
    {
      "step": "Email 2 — J+3",
      "subject": "…",
      "body": "…",
      "wait_days": 3
    }
  ]
}
\`\`\`

Règles JSON strictes :
- Le bloc commence EXACTEMENT par \`\`\`emails (pas \`\`\`json).
- \`subject\` : max 60 caractères, sans emoji par défaut.
- \`body\` : texte brut multi-lignes (utilise \\n pour les sauts de ligne), pas de markdown lourd.
- \`wait_days\` : entier (0 pour le 1er email).
- Si tu modifies UN seul email d'une séquence existante, ne renvoie QUE celui-là dans le tableau (pas toute la séquence).

3. Ne mets JAMAIS le bloc \`\`\`emails dans un quote markdown ou indenté — il doit être au niveau racine pour être parseable.

# SI LE CLIENT NE DEMANDE PAS D'EMAILS

Si le message est une question / discussion / brainstorming, réponds normalement en markdown SANS bloc \`\`\`emails.
`;

export function buildSequenceSystemPrompt(
  ctx: SequenceContext,
  provider: ProviderSpec = PROVIDERS.none
): string {
  return [
    BASE_INSTRUCTIONS,
    "",
    "---",
    "",
    formatContextForPrompt(ctx),
    "",
    "---",
    "",
    formatProviderInstructions(provider),
  ].join("\n");
}

/**
 * Extracteur d'emails depuis une réponse LLM.
 * Retourne null si aucun bloc ```emails ... ``` trouvé.
 */
export interface ExtractedEmail {
  step: string;
  subject: string;
  body: string;
  wait_days: number;
}

// Regex candidats par ordre de spécificité pour trouver le bloc JSON d'emails.
// On accepte les variantes que les LLM produisent en pratique :
//   ```emails\n{...}\n```
//   ```json\n{ "emails": [...] }\n```
//   ```\n{ "emails": [...] }\n```
//   ou directement { "emails": [...] } sans fences
const FENCED_PATTERNS: RegExp[] = [
  /```(?:emails|json|JSON)?\s*\r?\n([\s\S]*?"emails"[\s\S]*?)\r?\n?```/i,
  /```\s*\r?\n([\s\S]*?"emails"[\s\S]*?)\r?\n?```/,
];

function tryParseEmailsJson(raw: string): ExtractedEmail[] | null {
  try {
    const parsed = JSON.parse(raw.trim()) as { emails?: unknown };
    if (!parsed || !Array.isArray(parsed.emails)) return null;

    const list = (parsed.emails as Array<Record<string, unknown>>)
      .filter((e) => typeof e?.body === "string" && (e.body as string).trim().length > 0)
      .map((e, i) => ({
        step: typeof e.step === "string" ? (e.step as string) : `Email ${i + 1}`,
        subject: typeof e.subject === "string" ? (e.subject as string) : "",
        body: e.body as string,
        wait_days:
          typeof e.wait_days === "number" && Number.isFinite(e.wait_days)
            ? Math.max(0, Math.floor(e.wait_days as number))
            : 0,
      }));

    return list.length > 0 ? list : null;
  } catch {
    return null;
  }
}

/**
 * Tente d'extraire un objet JSON top-level { "emails": [...] } depuis du texte brut
 * en utilisant un parsing par accolades équilibrées. Utilisé en dernier recours
 * si aucun fence ```...``` n'enveloppe le JSON.
 */
function extractBalancedJson(text: string): string | null {
  const startIdx = text.indexOf('"emails"');
  if (startIdx < 0) return null;

  // Cherche l'accolade ouvrante qui contient "emails"
  let openIdx = -1;
  for (let i = startIdx; i >= 0; i--) {
    if (text[i] === "{") {
      openIdx = i;
      break;
    }
  }
  if (openIdx < 0) return null;

  // Compte les accolades pour trouver la fermante correspondante
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(openIdx, i + 1);
      }
    }
  }
  return null;
}

export function extractEmailsFromResponse(text: string): ExtractedEmail[] | null {
  // 1) Essai des blocs fenced
  for (const re of FENCED_PATTERNS) {
    const match = text.match(re);
    if (match) {
      const parsed = tryParseEmailsJson(match[1]);
      if (parsed) return parsed;
    }
  }

  // 2) Fallback : extraction du JSON par accolades équilibrées
  const balanced = extractBalancedJson(text);
  if (balanced) {
    const parsed = tryParseEmailsJson(balanced);
    if (parsed) return parsed;
  }

  return null;
}

/**
 * Retire le bloc emails (et toute trace de JSON top-level) du texte affiché au
 * chat — pour ne montrer que l'explication markdown du LLM. Le JSON est déjà
 * rendu visuellement dans la timeline à droite.
 */
export function stripEmailBlock(text: string): string {
  let out = text;

  // 1) Retire tous les blocs fenced (emails / json / nu) qui contiennent "emails"
  out = out.replace(/```(?:emails|json|JSON)?\s*\r?\n[\s\S]*?"emails"[\s\S]*?\r?\n?```/gi, "");
  out = out.replace(/```\s*\r?\n[\s\S]*?"emails"[\s\S]*?\r?\n?```/g, "");

  // 2) Retire un éventuel JSON top-level non-fenced (fallback du fallback)
  const balanced = extractBalancedJson(out);
  if (balanced) {
    out = out.replace(balanced, "");
  }

  // 3) Nettoie les artefacts résiduels (fences orphelins, multiples newlines)
  out = out.replace(/```(?:emails|json)?\s*\r?\n?/gi, "");
  out = out.replace(/\n{3,}/g, "\n\n");

  return out.trim();
}
