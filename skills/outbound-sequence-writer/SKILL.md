---
name: outbound-sequence-writer
description: Rédige des séquences de cold email B2B (2 à 6 emails) pour n'importe quel expéditeur — brief de contexte, proposition de 3 angles, choix du framework (PAS, AIDA, BAB, 4U, SLAP), cadence, sortie JSON avec les merge tags du provider d'envoi choisi (Emelia, Lemlist, Smartlead, Instantly, La Growth Machine, HeyReach, Apollo, Woodpecker). À utiliser pour "séquence outbound", "cold emails", "cadence de prospection" ; pas pour le cold call (cold-call-expert) ni pour les relances post-devis (sales-follow-up-sequence).
---

# Outbound Sequence Writer

Produit des **brouillons** de séquence. Aucun email n'est envoyé ; l'utilisateur importe le JSON dans son outil.

## Démarrage

1. Identifier l'expéditeur (preset dans `{CLIENT_DIR}/08-outbound/presets/<slug>.md` ou contexte fourni ; gabarit dans [references/preset-template.md](references/preset-template.md)). Un preset = un expéditeur avec N ICP ; une séquence vise un seul ICP.
2. Identifier le provider d'envoi (merge tags dans [references/providers.md](references/providers.md)). Inconnu → demander avant d'écrire.
3. Vérifier le minimum : offre en une phrase, ICP (secteur + fonction + une douleur précise), promesse, CTA, provider. Manque → une question à la fois.
4. Proposer **3 angles** (titre + une phrase de positionnement), attendre le choix.
5. Choisir le framework ([references/frameworks.md](references/frameworks.md)) : PAS pour une douleur saillante, AIDA pour réveiller, BAB pour une transformation, 4U pour l'urgence réelle, SLAP pour un ROI direct.
6. Cadence par défaut 4 emails J+0 / J+3 / J+7 / J+12 ; cycle long (> 30 j) J+0 / +5 / +12 / +22 / +35 ; cycle court J+0 / +2 / +4 / +7 ; B2C ou faible ticket 2 à 3 emails ; grands comptes 5 à 6 avec plus de valeur ajoutée.
7. Rédiger, puis sortir.

## Principes

Objet < 50 caractères, spécifique, jamais « Quick question » ni « Idée pour {société} » · ouverture crédible (observation factuelle ou question miroir, pas de fausse familiarité) · une idée par email, 80 à 150 mots · spécificité (chiffres, cas, mécanismes, uniquement s'ils sont vrais) · CTA à faible engagement (« ça résonne ? ») plutôt qu'une démo de 30 min · email 1 ouvre la porte, email 2 preuve, email 3 autre angle ou ressource, email 4 clôture douce (« si ce n'est pas le moment, je ne reviendrai pas ; ok pour une réponse ? ») · variantes A/B : objet et première phrase, jamais le CTA.

Anti-patterns : « J'espère que vous allez bien », commencer par soi, 4 bénéfices et plus, double CTA, emoji dans l'objet, murs de texte, promesses sans preuve, name-dropping inventé, markdown lourd.

## Format de sortie

Deux à trois phrases sur l'angle et le framework, puis un bloc au niveau racine :

````
```emails
{"emails": [
  {"step": "Email 1 — J+0", "subject": "…", "body": "…\n…", "wait_days": 0},
  {"step": "Email 2 — J+3", "subject": "…", "body": "…", "wait_days": 3}
]}
```
````

Objet ≤ 60 caractères, corps en texte brut avec `\n`, `wait_days` entier. Modification d'un seul email → ne renvoyer que celui-là. Merge tags exactement dans la syntaxe du provider. Sauvegarder aussi dans `{CLIENT_DIR}/08-outbound/sequence-{icp}-{date}.json` et `.md`.

Conformité (consentement, désinscription, base légale) : rappeler à l'utilisateur de vérifier avant envoi ; le skill ne la garantit pas.
