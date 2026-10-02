type JsonRecord = Record<string, unknown>;

export interface AgentTask {
  key: string;
  agentRole: string;
  objective: string;
  deliverable: string;
  dueInHours?: number;
  dependsOn?: string[];
}

interface TriggerParams {
  onboardingId: string;
  campaignId?: string | null;
  clientId: string;
  company: string;
  email: string;
  responses: JsonRecord;
  notionProposalUrl?: string | null;
}

export function buildLeadFactoryAgentPlan(responses: JsonRecord): AgentTask[] {
  const wantsVideo = JSON.stringify(responses).toLowerCase().includes("vsl");

  const base: AgentTask[] = [
    {
      key: "campaign-proposal-agent",
      agentRole: "Campaign Proposal Agent",
      objective: "Construire la proposition de campagne Meta Ads à partir de l'onboarding.",
      deliverable: "Proposition de campagne structurée + cibles + angles + KPI.",
      dueInHours: 12,
    },
    {
      key: "brief-static-designer-agent",
      agentRole: "Brief Static Designer Agent",
      objective: "Créer le brief statics/design exécutable par l'équipe créa.",
      deliverable: "Brief static designer complet prêt à produire.",
      dueInHours: 24,
      dependsOn: ["campaign-proposal-agent"],
    },
    {
      key: "static-variation-agent",
      agentRole: "Static Variation Agent",
      objective: "Proposer 6 variations de statics alignées à la proposition.",
      deliverable: "Set de variations statics prêt pour review.",
      dueInHours: 48,
      dependsOn: ["brief-static-designer-agent"],
    },
    {
      key: "copy-review-agent",
      agentRole: "Copy Review Agent",
      objective: "Revoir et améliorer copywriting/hooks/CTA des statics.",
      deliverable: "Statics revues + recommandations copy priorisées.",
      dueInHours: 54,
      dependsOn: ["static-variation-agent"],
    },
    {
      key: "delivery-agent",
      agentRole: "Delivery Agent",
      objective: "Assembler et livrer la proposition finale client (Notion + Slack).",
      deliverable: "Proposition finale client envoyable immédiatement.",
      dueInHours: 72,
      dependsOn: ["copy-review-agent"],
    },
  ];

  if (wantsVideo) {
    base.splice(4, 0, {
      key: "script-prep-agent",
      agentRole: "Script Prep Agent",
      objective: "Créer les scripts VSL/ADS et leurs variantes pour le client.",
      deliverable: "Scripts client finalisés (deadline J+3).",
      dueInHours: 72,
      dependsOn: ["brief-static-designer-agent"],
    });
  }

  return base;
}

export async function triggerLeadFactoryAutomation(params: TriggerParams): Promise<void> {
  const webhookUrl = process.env.LEADFACTORY_AUTOMATION_WEBHOOK_URL;
  if (!webhookUrl) return;

  const payload = {
    event: "leadfactory.onboarding.completed",
    occurredAt: new Date().toISOString(),
    source: "leadfactory-app",
    client: {
      id: params.clientId,
      company: params.company,
      email: params.email,
    },
    onboarding: {
      id: params.onboardingId,
      responses: params.responses,
    },
    campaign: {
      id: params.campaignId ?? null,
    },
    automation: {
      planVersion: "v1",
      agents: buildLeadFactoryAgentPlan(params.responses),
      assets: {
        notionProposalUrl: params.notionProposalUrl ?? null,
      },
    },
  };

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (process.env.LEADFACTORY_AUTOMATION_WEBHOOK_TOKEN) {
    headers.authorization = `Bearer ${process.env.LEADFACTORY_AUTOMATION_WEBHOOK_TOKEN}`;
  }

  await fetch(webhookUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(4000),
  });
}
