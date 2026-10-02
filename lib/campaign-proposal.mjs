// Deterministic scaffold: arithmetic, supplied facts and explicit unknowns only.
export function campaignProposal(client) {
 const o=client.onboarding,b=o.campaign.budget;
 return `# Proposition de campagne — ${client.company}

Statut : proposition à valider, résultats non garantis. Source : questionnaire client ; déclarations non vérifiées indépendamment.

## 1. Résumé et objectif
${o.campaign.objective}
Offre : ${o.offer.service}. Problème : ${o.offer.problem}.
Promesse déclarée à vérifier : ${o.offer.promise}.

## 2. Cible et qualification
${o.target.profile}. Zone : ${o.target.zone||'à confirmer'}.
Lead qualifié : ${o.campaign.qualifiedLead}.
Exclusions : ${o.target.exclusions}.

## 3. Concept et canal
Canal demandé : ${o.campaign.channel}. Hypothèse à tester : démontrer le problème et le mécanisme de l’offre, puis inviter à une qualification.
Angle A : diagnostic du problème. Angle B : démonstration du service. Ce sont deux pistes de test, pas des concepts gagnants prouvés.
Preuves fournies : ${o.offer.proofs||'aucune ; prévoir une démonstration vérifiable avant diffusion'}.

## 4. Budget et économie
Budget mensuel déclaré : ${b} EUR. Convention de planning : 30 jours, soit ${(b/30).toFixed(2)} EUR/jour en moyenne ; ce n’est pas un paramètre de plateforme déjà appliqué.
Honoraires, production, outils et taxes : à chiffrer séparément. Répartition et durée réelle à confirmer.
${b===0?'Aucun achat média viable avec ce budget nul : privilégier un pilote sans dépense ou revoir le budget.':'Un pilote payant reste conditionnel aux accès, aux assets et à la mesure.'}
Aucune prévision de leads sans baseline. Si CPL observé = X, volume indicatif = budget média / X ; ce calcul est un scénario, pas une promesse.

## 5. Production et calendrier
Durée souhaitée : ${o.campaign.timeline||'à convenir'}.
Jalon 1 : Delivery vérifie accès, preuves et destination. Jalon 2 : Creative Strategist propose deux concepts et leurs variantes. Jalon 3 : Media Buyer prépare la campagne en pause et teste la mesure. Jalon 4 : activation seulement sous mandat, puis revue des premiers signaux à la cadence convenue.
Assets déclarés : ${o.delivery.assets||'à fournir'}. Volume définitif, formats et dates : à confirmer avec la capacité de livraison.

## 6. Mesure et critères de décision
KPI : ${o.campaign.kpi}. Conserver période, dépense, demandes, demandes qualifiées et rendez-vous tenus. Définir avant lancement plafond de test, taille d’échantillon et critères continuer/arrêter ; ne pas optimiser seulement le CTR.

## 7. Viabilité, dépendances et risques
Viabilité : CONDITIONNELLE. Les objectifs ne sont pas des résultats acquis.
Accès déclarés : ${o.delivery.accessGranted?'accordés, à vérifier dans les outils':'non confirmés'}.
Contraintes : ${o.delivery.constraints||'à préciser'}.
Vérifier : droits des assets, preuve des claims, conformité de la destination, traitement des leads, marge par vente, capacité de réponse et coût d’acquisition acceptable. Aucun lancement public par cette proposition.

## 8. Validation et prochaine étape
Validateur client : ${o.delivery.validator||'à désigner'}. Retour attendu : confirmer cible, budget, périmètre et calendrier, puis lister les ajustements.
Responsable agence : Communication client pour le retour, Delivery pour les engagements.
Décision attendue : validation du plan ou demande de modifications. Une mise à disposition n’est pas une acceptation ni un contrat signé.
`;
}
export const WORKFLOW_STEPS=[
 {slug:'onboarding',name:'Onboarding',skill:'client-onboarding-flow',task:'Vérifie le questionnaire. Livre une synthèse, les faits déclarés, les contradictions et les inputs manquants. Ne bloque pas les drafts utiles sur un manque non bloquant.'},
 {slug:'creative-strategist',name:'Creative Strategist',skill:'creative-brief',task:'Propose deux concepts distincts et faisables depuis les seules preuves fournies, avec message, formats, assets requis et hypothèse mesurable.'},
 {slug:'media-buyer',name:'Media Buyer',skill:'agency-media-buying',task:'Vérifie viabilité du canal demandé, budget, destination, accès et tracking. Livre un plan de test conditionnel avec critères de décision. Zéro création de campagne externe.'},
 {slug:'client-communication',name:'Communication client',skill:'campaign-proposal',task:'Assemble une proposition client claire depuis les étapes précédentes. Reprends les huit sections du modèle fourni ; distingue faits, hypothèses et coûts inconnus. Donne budget, périmètre, calendrier, responsabilités, mesure, risques, critères de validation. Ne transforme pas le draft en engagement signé.'}
];
