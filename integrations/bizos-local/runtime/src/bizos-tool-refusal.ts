// A BizOS server tool (image, e-mail, site) refused because the BizOS usage
// window is full, as the agent and the person must read it. The signed
// desktop bridge carries the server's code and its own FR/EN sentence
// (« Limite hebdomadaire BizOS atteinte — réinitialisation dans 2 j 4 h »).
// Before .53 the server answered 402 insufficient_work_credits for it, the
// agent read « BizOS continuity insufficient_work_credits (402) » and the
// person saw nothing at all.
import { ContinuityBridgeError, type LocalizedBridgeMessage } from "./continuity-bridge.js";

export const USAGE_LIMIT_REACHED = "usage_limit_reached";

export interface BizosToolRefusal {
  status: 429;
  code: typeof USAGE_LIMIT_REACHED;
  /** The tool result the agent reads: the code, then FR and EN. */
  agentText: string;
  /** One grey line for the conversation, in the machine's language. */
  notice: string;
}

const TOOL_OUTCOME: Record<string, LocalizedBridgeMessage> = {
  bizos_image_generate: { fr: "Image non générée", en: "Image not generated" },
  bizos_email_send: { fr: "E-mail non envoyé", en: "Email not sent" },
  bizos_email_inbox: { fr: "Boîte de réception non lue", en: "Inbox not read" },
  bizos_site_create: { fr: "Site non créé", en: "Site not created" },
  bizos_site_publish: { fr: "Site non publié", en: "Site not published" },
  bizos_site_unpublish: { fr: "Site non retiré", en: "Site not taken offline" },
};

const FALLBACK: LocalizedBridgeMessage = { fr: "Limite d’utilisation BizOS atteinte", en: "BizOS usage limit reached" };
const NEXT_STEP: LocalizedBridgeMessage = {
  fr: "Rien n’a été produit ni débité. Dis-le à la personne avec ce délai et ne réessaie pas avant la réinitialisation.",
  en: "Nothing was produced or charged. Tell the person, with this delay, and do not retry before the reset.",
};

/** `null` for any other failure: it keeps its own error path. */
export function bizosToolRefusal(
  tool: string,
  error: unknown,
  locale: string = Intl.DateTimeFormat().resolvedOptions().locale,
): BizosToolRefusal | null {
  if (!(error instanceof ContinuityBridgeError) || error.code !== USAGE_LIMIT_REACHED) return null;
  const reason = error.localizedMessage ?? FALLBACK;
  const outcome = TOOL_OUTCOME[tool] ?? { fr: "Outil BizOS refusé", en: "BizOS tool refused" };
  const french = locale.toLowerCase().startsWith("fr");
  return {
    status: 429,
    code: USAGE_LIMIT_REACHED,
    agentText: `${USAGE_LIMIT_REACHED} — FR : ${reason.fr}. ${NEXT_STEP.fr} — EN: ${reason.en}. ${NEXT_STEP.en}`,
    notice: french ? `${outcome.fr} : ${reason.fr}.` : `${outcome.en}: ${reason.en}.`,
  };
}
