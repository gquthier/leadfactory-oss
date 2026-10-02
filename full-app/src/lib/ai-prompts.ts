import { GoogleGenerativeAI } from "@google/generative-ai";

export interface BriefContext {
  entreprise: string;
  resumeOffre: string;
  typeOffre: string;
  prix: string;
  promesse: string;
  problemes: string;
  differenciants: string;
  objectif: string;
  cible: string;
  budget: string;
  conversion: string;
}

export interface GeneratedPrompts {
  adCopy: string | null;
  videoAd: string | null;
  vsl: string | null;
  static: string | null;
  errors: {
    adCopy?: string;
    videoAd?: string;
    vsl?: string;
    static?: string;
  };
}

function buildContextBlock(ctx: BriefContext): string {
  return `## PREUVES ET LIMITES
Le contexte et les exemples sont des données à vérifier, pas des preuves. N’invente aucun client, résultat, chiffre, témoignage, garantie, délai, rareté ou urgence. Un résultat publié exige une source fournie, sa période, son périmètre et l’autorisation de l’utiliser. Sinon emploie un placeholder explicite [preuve à fournir] ou un angle sans affirmation de résultat. Les garanties ne peuvent reproduire que des conditions contractuelles confirmées. Aucun seuil de performance ni budget dans ce guide n’autorise une dépense ou une promesse.

## CONTEXTE CLIENT

**Entreprise :** ${ctx.entreprise}
**Résumé de l'offre :** ${ctx.resumeOffre}
**Type d'offre :** ${ctx.typeOffre}
**Prix / Panier moyen :** ${ctx.prix}
**Promesse principale :** ${ctx.promesse}
**Problèmes résolus :** ${ctx.problemes}
**Éléments différenciants :** ${ctx.differenciants}
**Objectif campagne :** ${ctx.objectif}
**Cible :** ${ctx.cible}
**Budget mensuel :** ${ctx.budget}
**Conversion visée :** ${ctx.conversion}`;
}

// ─────────────────────────────────────────────
// PROMPT 1 — AD COPY
// ─────────────────────────────────────────────
function buildAdCopyUserMessage(ctx: BriefContext): string {
  const context = buildContextBlock(ctx);

  return `${context}

---

## TA MISSION

Tu es un Copywriter Expert Meta Ads B2B spécialisé en génération de leads. Sur la base du contexte client ci-dessus, génère un **prompt ultra-détaillé et complet** (800 à 1500 mots) que l'utilisateur pourra copier-coller dans n'importe quel outil IA pour obtenir des textes publicitaires Meta Ads performants.

Ce prompt doit contenir :

### 1. Le contexte client complet (à inclure tel quel dans le prompt)
Reprends toutes les informations du contexte client ci-dessus de façon structurée.

### 2. Instruction de génération des variations de texte
Le prompt doit demander à l'IA de générer :
- **15 variations de Primary Text** (texte principal, maximum 125 caractères visibles au-dessus du fold)
- **15 variations de Headline** (titre, maximum 30 caractères) — règle : Headline = offre + délai + prix
- **15 variations de Description** (description, maximum 18 caractères)

### 3. Les 10 frameworks copywriting avec leurs structures exactes (1 à 2 variations par framework)

Le prompt doit instruire l'IA d'utiliser EXACTEMENT ces 10 frameworks avec leurs structures :

**Variation 1-2 : FOMO — Peur de rater la tendance**
Structure : Tendance (ce que les concurrents font déjà) → Demande (pourquoi c'est urgent) → Produit (la solution) → Urgence (fenêtre de temps) → CTA

**Variation 3-4 : PAS — Problème → Agitation → Solution**
Structure : Nommer le problème précis → Amplifier la douleur (conséquences) → Présenter l'offre comme la sortie logique

**Variation 5-6 : AIDA — Attention → Intérêt → Désir → Action**
Structure : Crochet d'accroche qui stoppe (Attention) → Développer l'intérêt avec des faits (Intérêt) → Activer le désir avec le résultat rêvé (Désir) → CTA clair (Action)

**Variation 7-8 : Objection-Réassurance**
Structure : Nommer le frein principal ("Vous pensez que…") → Réfuter avec preuve concrète → Rassurer par les résultats

**Variation 9 : Liste de Points**
Structure : Listicle 3 à 5 points ✓ articulant la valeur — chaque point = un bénéfice concret

**Variation 10 : Storytelling du Héros**
Structure : Situation avant (souffrance identifiable) → Tournant (découverte de l'offre) → Situation après (transformation quantifiée)

**Variation 11 : Ennemi Commun**
Structure : Ancienne méthode nommée (ennemie du prospect) → Pourquoi elle échoue → Nouvelle méthode (l'offre) comme alternative moderne

**Variation 12 : Avant/Après**
Structure : AVANT: [état de souffrance actuel précis] → APRÈS: [état désiré quantifié après l'offre]

**Variation 13 : Guide Éducatif**
Structure : Conseil actionnable gratuit (valeur immédiate) → Transition naturelle "c'est exactement ce que…" → Présentation de l'offre

**Variation 14-15 : Démonstration Technique**
Structure : Étape 1 (action simple, timing) → Étape 2 (action simple, timing) → Étape 3 (résultat obtenu, timing)

### 4. Techniques Call-Out Hormozi à intégrer dans les variations
- **Labels** : "Pour les [cible précise qui se reconnaît immédiatement]…"
- **Yes-Questions** : Question à laquelle la cible répond forcément OUI (ex : "Vous en avez marre de prospecter sans résultat ?")
- **If-Then** : "Si tu [symptôme du problème exact], alors [bénéfice immédiat de lire la suite]"
- **Résultats Ridicules** : Résultat surprenant et quantifié en ouverture (exemple à compléter : [résultat sourcé], [période], [conditions])

### 5. Règles de copywriting strictes
- Headline = offre + délai + prix (les 3 éléments quand applicable)
- Phrases courtes : maximum 15 mots par phrase
- Niveau de compréhension : adolescent de 15 ans (zéro jargon)
- Une seule idée par variation, jamais de catalogue
- Preuves > Promesses : chaque affirmation forte doit être suivie d'une preuve

### 6. Déclencheurs psychologiques à répartir sur les 45 variations
1. FOMO / peur de la perte
2. Douleur / soulagement
3. Résultat quantifié précis
4. Identification à la cible (le prospect se reconnaît)
5. Preuve sociale (implicite ou explicite)
6. Réciprocité (valeur donnée avant de demander)
7. Exclusivité / accès privilégié
8. Autorité / expertise démontrée
9. Conditions et limites contractuelles confirmées ; ne jamais affirmer zéro risque

### 7. CTAs à utiliser (à alterner)
- "Réserver un appel"
- "Voir ce qui est inclus"
- "Obtenir mes leads"
- "Prendre ma place"
- "Je veux des leads qualifiés"

### 8. Format de sortie — Tableau obligatoire
| Framework | Déclencheur | Primary Text (125 chars max) | Headline (30 chars max) | Description (18 chars max) | CTA |

### Critères de qualité (QA copy)
- Chaque variation se comprend en moins de 3 secondes
- Le headline dit clairement : quoi + combien de temps + quel prix
- Le Primary Text commence par un hook qui stoppe le scroll
- Zéro superlatif creux ("révolutionnaire", "unique", "incroyable")

Génère maintenant ce prompt complet, opérationnel, prêt à être utilisé directement dans un outil IA.`;
}

// ─────────────────────────────────────────────
// PROMPT 2 — VIDEO AD SCRIPT
// ─────────────────────────────────────────────
function buildVideoAdUserMessage(ctx: BriefContext): string {
  const context = buildContextBlock(ctx);

  return `${context}

---

## TA MISSION

Tu es un Expert en production de contenus vidéo publicitaires Meta Ads, spécialisé en génération de leads B2B. Sur la base du contexte client ci-dessus, génère un **prompt ultra-détaillé et complet** (800 à 1500 mots) que l'utilisateur pourra copier-coller dans n'importe quel outil IA pour obtenir des scripts de vidéos publicitaires Meta Ads performants.

Ce prompt doit contenir :

### 1. Le contexte client complet (à inclure tel quel dans le prompt)
Reprends toutes les informations du contexte client ci-dessus de façon structurée.

### 2. Instruction de génération des scripts
Le prompt doit demander à l'IA de générer **5 scripts de vidéos publicitaires**, avec pour chacun une version 30 secondes et une version 60 secondes, soit **10 scripts au total**.

### 3. Structure obligatoire Hook / Problème / Solution / CTA avec timings précis

Chaque script doit suivre EXACTEMENT cette structure :

**HOOK (0-5 secondes) — Stopper le scroll**
Le hook doit capter l'attention dans les 3 premières secondes. Utiliser l'un des 4 types de hooks Hormozi (voir ci-dessous). Format : *[Note de production : type de plan, cadrage]* / VO: texte dit à voix haute

**PROBLÈME (5-15 secondes) — Formuler la douleur précise**
Nommer le problème avec les mots exacts que la cible utiliserait. Empathie totale. Pas de solution encore. Format : *[Plan serré ou plan moyen, B-roll illustrant le problème]* / VO: texte

**SOLUTION (15-40s pour le 30s / 15-50s pour le 60s) — Présenter l'offre**
Présenter l'offre comme la solution naturelle et logique. Inclure : 1) le mécanisme (comment ça marche en 1 phrase) 2) une preuve concrète si elle est fournie ; sinon décrire le mécanisme sans inventer de résultat. Format : *[Plan produit/service, démonstration, témoignage rapide]* / VO: texte

**CTA (5-10 dernières secondes) — Une seule action**
Instruction claire, simple, une seule action demandée. URL ou action précise. Répétition du bénéfice principal en 1 phrase avant le CTA. Format : *[Plan serré visage ou texte à l'écran]* / VO: "Cliquez sur le lien ci-dessous pour [action]"

### 4. Les 4 types de hooks Hormozi — un par script différent

**Type 1 — Label Hook**
Format : "Si tu es [profil précis avec caractéristique identifiante], ce qui suit va changer ta façon de [domaine]"
Le label doit correspondre au profil confirmé dans le brief. Exemple : "Si vous êtes [profil documenté] et rencontrez [problème observé]..."

**Type 2 — Yes-Question Hook**
Format : Question rhétorique à laquelle la cible répond FORCÉMENT oui
La question doit toucher la douleur principale. Ex : "Tu en as marre de passer des heures sur LinkedIn pour rien ?"
Suivi de : "Alors regarde ça."

**Type 3 — If-Then Hook**
Format : "Si tu [symptôme du problème très précis], alors regarde ça jusqu'au bout"
Le "Si tu" doit décrire une situation que la cible vit MAINTENANT. Ex : "Si tu envoies plus de 20 messages par jour sur LinkedIn sans résultat..."

**Type 4 — Ridiculous Result Hook**
Format : Annoncer un résultat surprenant et quantifié dans les 3 premières secondes
Exemple de structure à justifier : "[résultat vérifié] sur [période vérifiée], pour [offre et prix confirmés]."
Le résultat doit être crédible ET inattendu.

**Type 5 (bonus) — Mise en situation in media res**
Commencer directement dans la situation problématique. Ex : "Lundi matin, 9h. Vous ouvrez LinkedIn. Encore zéro réponse aux 15 messages envoyés vendredi."

### 5. Ton et style d'écriture imposés
- Ton conversationnel et authentique, jamais corporate ou institutionnel
- Deuxième personne (tu/vous selon la cible définie dans le contexte)
- Phrases courtes, rythme dynamique, pauses dramatiques bien placées
- Zéro superlatif creux ("révolutionnaire", "incroyable", "unique en son genre")
- Le script doit sonner comme une conversation filmée, pas comme un argumentaire lu

### 6. Notes de mise en scène obligatoires pour chaque scène
Pour chaque partie du script, inclure entre *[astérisques]* :
- Ce qu'on voit à l'écran (décor, personne, action en cours)
- Le type de plan (plan large, plan moyen, gros plan, plan serré visage)
- Les textes ou graphiques à afficher à l'écran (captions, chiffres, URL)
- La musique ou ambiance sonore recommandée

### 7. Éléments obligatoires dans chaque script
- Mention explicite du problème central de la cible
- Présentation claire de la solution (l'offre nommée)
- Au moins 1 résultat concret et quantifié (chiffre réel ou benchmark)
- CTA précis avec action unique demandée

### 8. Format de sortie pour chaque script
- **Titre** : "Script [N] — Hook [Type]"
- **Type de hook utilisé** et **déclencheur psychologique principal**
- **Version 30 secondes** : séquence avec timings et notes de production
- **Version 60 secondes** : séquence avec timings et notes de production

Génère maintenant ce prompt complet, opérationnel, prêt à être utilisé directement dans un outil IA.`;
}

// ─────────────────────────────────────────────
// PROMPT 3 — VSL SCRIPT
// ─────────────────────────────────────────────
function buildVslUserMessage(ctx: BriefContext): string {
  const context = buildContextBlock(ctx);

  return `${context}

---

## TA MISSION

Tu es un Expert VSL_B2B_Specialist, copywriter senior spécialisé en Video Sales Letter pour des offres B2B. Sur la base du contexte client ci-dessus, génère un **prompt ultra-détaillé et complet** (800 à 1500 mots) que l'utilisateur pourra copier-coller dans n'importe quel outil IA pour obtenir un script complet de Video Sales Letter (VSL) performant.

Ce prompt doit contenir :

### 1. Le contexte client complet (à inclure tel quel dans le prompt)
Reprends toutes les informations du contexte client ci-dessus de façon structurée.

### 2. Instruction de génération du VSL
Le prompt doit demander à l'IA d'écrire **un script VSL complet** suivant la structure en 8 étapes ci-dessous, avec une durée cible de 5 à 7 minutes de lecture (environ 700 à 900 mots de script VO).

### 3. La structure VSL en 8 étapes obligatoire avec timings précis

**Étape 1 — ACCROCHE (30 secondes)**
Question choc OU statistique percutante qui touche directement la douleur principale ou le désir le plus fort de la cible.
Objectif : stopper le spectateur et lui donner une raison impérative de continuer.
Format VO: / *Écran:* (noter ce qu'on voit)
Le prompt doit demander d'analyser le niveau de sophistication du marché (1 à 5) pour calibrer l'intensité de l'accroche.

**Étape 2 — PRÉSENTATION DU PROBLÈME (1 minute)**
Décrire avec précision et empathie la douleur quotidienne de la cible.
Utiliser le vocabulaire exact que la cible utiliserait pour décrire son problème.
Pas de solution encore — uniquement la douleur. Appliquer le framework Hormozi WHEN (Past + Present).
Format VO: / *Écran:*

**Étape 3 — AGITATION DU PROBLÈME (1 minute)**
Amplifier la douleur en décrivant les conséquences si rien ne change.
Couvrir les 4 dimensions Hormozi WHAT : ce que ça coûte en argent, en temps, en opportunités manquées, en stress.
Objectif : rendre le problème urgent à résoudre. Fin de l'étape : "Il existe une meilleure façon."
Format VO: / *Écran:*

**Étape 4 — SOLUTION PROPOSÉE (30 secondes)**
Introduire l'offre comme LA solution naturelle et logique au problème décrit.
Nommer l'offre, expliquer le mécanisme principal en une phrase simple (le "unique mechanism").
Pas encore de détails — juste l'annonce de la sortie.
Format VO: / *Écran:*

**Étape 5 — BÉNÉFICES CLÉS (2 minutes)**
Présenter les bénéfices documentés ; les chiffres sont facultatifs et exigent une source. Pour chaque bénéfice :
1. Nommer le résultat (le Dream Outcome Hormozi)
2. Expliquer comment l'offre le délivre (Perceived Likelihood)
3. Quantifier avec des chiffres réels (Speed + Ease Hormozi)
Parler en bénéfices ressentis, pas en caractéristiques techniques.
Format VO: / *Écran:*

**Étape 6 — CRÉDIBILITÉ ET PREUVES (1 à 2 minutes)**
Construire la confiance uniquement avec les témoignages autorisés et résultats documentés disponibles ; sinon présenter les méthodes et les limites de l’offre.
Varier les formats : chiffres clés → citation courte → storytelling d'un cas client.
Format VO: / *Écran:*

**Étape 7 — OFFRE SPÉCIALE ET URGENCE (30 secondes)**
Présenter uniquement une échéance, un bonus, un prix ou une disponibilité vérifiés. En leur absence, proposer une prochaine étape utile sans inventer urgence ni garantie.
L'urgence doit être crédible et justifiée — pas artificielle.
Format VO: / *Écran:*

**Étape 8 — CTA (30 secondes)**
Instruction claire et unique : une seule action à effectuer.
Rappel synthétique du bénéfice principal (1 phrase).
Lever la dernière résistance avec une phrase de réassurance.
Répétition du CTA. URL ou formulaire précis.
Format VO: / *Écran:*

### 4. Adaptation selon le niveau de sophistication du marché
Le prompt doit demander d'évaluer le marché sur l'échelle 1 à 5 :
- Niveau 1 (Premier sur le marché) : Éduquer sur le problème, la simple promesse suffit
- Niveau 2 (Concurrence naissante) : Affirmer la promesse fortement, superlatives légitimes
- Niveau 3 (Marché averti) : Introduire le mécanisme unique, expliquer comment différemment
- Niveau 4 (Marché saturé) : Aller chercher l'identité, la tribu, l'identification forte
- Niveau 5 (Hyper-sophistiqué) : Renverser les attentes, curiosité par la nouveauté radicale

Pour le contexte client fourni, diagnostiquer le niveau ET adapter l'accroche et les bénéfices en conséquence.

### 5. Pour les contextes B2B coaching/consulting : option structure 16 étapes
Si le type d'offre est coaching, consulting ou accompagnement, le prompt doit aussi proposer la structure VSL Coach étendue :
Opening Promise → Who This Is For → Credibility Hook → The Big Problem → Why It's Not Your Fault → The Hidden Cause → The Turning Point → What You Discovered → Social Proof Stack → What's Inside → Who It's NOT For → The Price Reveal → Guarantee → Urgency/Scarcity → The Stack Recap → Final CTA

### 6. Ton et style d'écriture
- Authentique, direct, storytelling sans superlatifs excessifs
- Adresser la cible en "vous" de façon cohérente (sauf si cible très jeune)
- Respirations naturelles et transitions fluides entre chaque étape
- Éviter le jargon commercial ("solution innovante", "expertise reconnue")
- Le script doit sonner comme une conversation, pas comme un argumentaire

### 7. Format de sortie attendu
Pour chaque étape :
- Titre de l'étape + durée estimée
- VO: [Script voix off complet, mot pour mot]
- *Écran: [Notes de mise en scène entre astérisques — ce qu'on voit, le rythme, le B-roll]*
- Durée totale estimée en bas du script

Génère maintenant ce prompt complet, opérationnel, prêt à être utilisé directement dans un outil IA.`;
}

// ─────────────────────────────────────────────
// PROMPT 4 — STATIC CREATIVE
// ─────────────────────────────────────────────
function buildStaticUserMessage(ctx: BriefContext): string {
  const context = buildContextBlock(ctx);

  return `${context}

---

## TA MISSION

Tu es un Creative Director expert en créatives statiques Meta Ads B2B. Sur la base du contexte client ci-dessus, génère un **prompt ultra-détaillé et complet** (800 à 1500 mots) que l'utilisateur pourra copier-coller dans n'importe quel outil IA pour obtenir des briefs complets de créatifs statiques Meta Ads.

Ce prompt doit contenir :

### 1. Le contexte client complet (à inclure tel quel dans le prompt)
Reprends toutes les informations du contexte client ci-dessus de façon structurée.

### 2. Instruction de génération des briefs
Le prompt doit demander à l'IA de créer **8 briefs de créatifs statiques** au format 1080x1080 pixels, un par template de mise en page.

### 3. Les 8 layouts templates avec leurs éléments exacts

Pour chaque layout, le prompt doit spécifier les éléments de copy et de design ADAPTÉS au contexte client :

**Layout 1 — Grosse Promesse Centrale**
Éléments requis : Headline en typographie XXL (minimum 120px) occupant les 2/3 de la surface + badge prix ou délai en surimpression (pastille ou bandeau) + CTA pleine largeur en bas
Règle copy : Headline = offre + délai + prix (exemple à compléter : [résultat sourcé], [période], [conditions])
Fond : couleur unie forte ou dégradé, headline en blanc ou contraste maximum
Objectif : proposition de valeur comprise en moins de 1 seconde

**Layout 2 — Comparatif Avant/Après**
Éléments requis : 2 colonnes égales + séparateur central vertical + labels "AVANT" et "APRÈS" en haut de chaque colonne
Colonne gauche AVANT : fond rouge ou grisé, liste des douleurs actuelles (3 points max, icônes ✗)
Colonne droite APRÈS : fond vert ou couleur marque, liste des résultats obtenus (3 points max, icônes ✓)
Sous-titre centré en bas : l'offre en 1 phrase + CTA

**Layout 3 — Timeline J0/J1/J2**
Éléments requis : 3 étapes horizontales numérotées + icônes représentatives + étiquettes temporelles + flèches de progression
Labels temporels : J0 / J7 / J30 (ou Étape 1/2/3) selon la réalité de l'offre
Chaque étape : maximum 5 mots + une icône simple
Objectif : montrer que l'offre est simple à activer et rapide à voir des résultats

**Layout 4 — Proof Stack (3 chiffres)**
Éléments facultatifs : blocs de preuves documentées ; sans preuve, remplacer par les étapes réelles du service
Chaque bloc : chiffre en très grande typographie (minimum 80px) + label descriptif en dessous (exemple à compléter : [résultat sourcé], [période], [conditions])
Fond sobre (blanc, gris foncé, ou couleur marque), chiffres en couleur de marque ou blanc sur fond foncé
Headline au-dessus de la grille : la promesse principale en 1 ligne

**Layout 5 — Testimonial**
Éléments requis : Citation forte entre guillemets en grand format + nom et titre du client + étoiles de notation (si pertinent) + CTA en bas
Règle de la citation : elle doit exprimer un RÉSULTAT obtenu, pas un compliment
Format idéal : "J'ai obtenu [résultat concret + chiffre] en [délai] grâce à [offre]" — Prénom N., [Titre], [Entreprise]
Fond : photo légèrement flouée ou couleur unie, citation en blanc ou contraste fort

**Layout 6 — Transformation**
Éléments requis : Headline en 2 parties séparées par une flèche graphique ou contraste visuel fort + sous-titre précisant l'offre ou le délai
Partie gauche : situation de départ (le problème en 3-4 mots max)
Partie droite : situation d'arrivée (le résultat en 3-4 mots max + chiffre si possible)
Visuel central : flèche graphique large, icône de transformation, ou trait de séparation coloré

**Layout 7 — Offre + Garantie**
Éléments requis : Promesse principale en headline + liste de 3 éléments inclus maximum + badge de conditions contractuelles uniquement si elles sont confirmées + CTA final
Badge facultatif : uniquement le texte exact d’une garantie contractuelle confirmée, avec ses conditions ; sinon omettre ce badge.
Les points inclus : bénéfices documentés, sans garantie de résultat implicite (exemple à compléter : [résultat sourcé], [période], [conditions])
Objectif : réduire le risque perçu à zéro

**Layout 8 — Urgence / Scarcité**
Éléments requis : Message d'alerte sur les slots/places disponibles + élément calendrier ou compteur visuel + badge prix/promotion + CTA avec sens d'urgence
Message principal : "Plus que [X] places ce mois" ou "Offre valable jusqu'au [date]"
Couleurs : rouge ou orange pour les éléments d'urgence, contraste fort pour le CTA
Ne jamais créer une urgence artificielle non justifiée — adapter à la réalité de l'offre

### 4. Pour chaque layout, le prompt doit demander
- **Le texte exact** à placer : headline, sous-titre, corps de texte, label CTA (tous personnalisés avec les données client)
- **La palette de couleurs recommandée** : couleurs HEX pour fond, texte principal, accents, CTA
- **Les éléments visuels** : photos (description), icônes (style), illustrations, formes graphiques, badges
- **La hiérarchie visuelle** : élément 1 (capte l'œil en premier) → élément 2 → élément 3
- **Les formats à décliner** : 1:1 (1080×1080) principal + adaptation 4:5 (1080×1350) et 9:16 (1080×1920)

### 5. Checklist QA obligatoire à rappeler dans le prompt
Le prompt doit imposer cette checklist pour chaque créative :
- Format 1080×1080 pixels
- Headline lisible à 50 % de la taille (test thumbnail)
- Contraste texte/fond suffisant (WCAG AA minimum)
- CTA visible et lisible clairement (minimum 40px de hauteur)
- Proposition de valeur claire en moins de 1 seconde
- Délai explicite (si applicable à l'offre)
- Prix explicite (si applicable à l'offre)
- Aucun élément coupé aux bords (zone de sécurité 40px)
- Police minimum 40px pour textes secondaires, minimum 80px pour headline
- Test final : montrer 2 secondes à quelqu'un et demander "qu'est-ce que cette pub vend ?"

### 6. Standard Lead Factory à rappeler
**Règle absolue** : compréhensible instantanément = ce qu'on fait + en combien de temps + à quel prix (quand applicable) + pourquoi crédible.

### 7. Format de sortie attendu pour chaque layout
- Nom du layout
- Texte exact (tous les éléments de copy, personnalisés pour ce client)
- Palette couleur (codes HEX + rôle de chaque couleur)
- Éléments visuels recommandés (description précise)
- Instructions de mise en page (hiérarchie, espacement, typographie)
- Formats à produire

Génère maintenant ce prompt complet, opérationnel, prêt à être utilisé directement dans un outil IA.`;
}

// ─────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────
export async function generateAllAIPrompts(ctx: BriefContext): Promise<GeneratedPrompts> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return {
      adCopy: null,
      videoAd: null,
      vsl: null,
      static: null,
      errors: {
        adCopy: "GEMINI_API_KEY manquante",
        videoAd: "GEMINI_API_KEY manquante",
        vsl: "GEMINI_API_KEY manquante",
        static: "GEMINI_API_KEY manquante",
      },
    };
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  function getModel(systemInstruction: string) {
    return genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction,
      generationConfig: { temperature: 0.8 },
    });
  }

  const adCopyModel = getModel(
    "Tu es un Copywriter Expert Meta Ads spécialisé en génération de leads B2B. Tu maîtrises les 10 frameworks copywriting (FOMO, PAS, AIDA, Objection-Réassurance, Liste, Storytelling Héros, Ennemi Commun, Avant/Après, Guide Éducatif, Démonstration Technique) et les call-out Hormozi (Labels, Yes-Questions, If-Then, Résultats Ridicules). Génère un prompt ultra-détaillé et complet avec les structures exactes de chaque framework."
  );
  const videoAdModel = getModel(
    "Tu es un Expert en production de vidéos publicitaires Meta Ads B2B. Tu maîtrises les 4 types de hooks Hormozi (Label, Yes-Question, If-Then, Ridiculous Result) et la structure Hook/Problème/Solution/CTA avec timings précis. Génère un prompt ultra-détaillé avec notes de mise en scène complètes."
  );
  const vslModel = getModel(
    "Tu es un Expert VSL_B2B_Specialist, copywriter senior spécialisé en Video Sales Letter pour des offres B2B. Tu maîtrises la structure VSL en 8 étapes (Accroche → Problème → Agitation → Solution → Bénéfices → Crédibilité → Offre/Urgence → CTA), la structure Coach 16 étapes, et le framework Hormozi What-Who-When. Tu analyses le niveau de sophistication du marché (1 à 5) pour calibrer chaque script. Génère un prompt ultra-détaillé et complet."
  );
  const staticModel = getModel(
    "Tu es un Creative Director expert en créatives statiques Meta Ads B2B 1080x1080. Tu maîtrises les 8 layouts templates (Grosse Promesse, Avant/Après, Timeline J0/J1/J2, Proof Stack 3 chiffres, Testimonial, Transformation, Offre+Garantie, Urgence/Scarcité) et la règle : compréhensible en 1 seconde = offre + délai + prix + crédibilité. Génère un prompt ultra-détaillé avec briefs complets pour chaque layout."
  );

  const [adCopyResult, videoAdResult, vslResult, staticResult] = await Promise.allSettled([
    adCopyModel.generateContent(buildAdCopyUserMessage(ctx)),
    videoAdModel.generateContent(buildVideoAdUserMessage(ctx)),
    vslModel.generateContent(buildVslUserMessage(ctx)),
    staticModel.generateContent(buildStaticUserMessage(ctx)),
  ]);

  const errors: GeneratedPrompts["errors"] = {};

  const adCopy =
    adCopyResult.status === "fulfilled"
      ? adCopyResult.value.response.text()
      : (() => { errors.adCopy = (adCopyResult as PromiseRejectedResult).reason?.message ?? "Erreur inconnue"; return null; })();

  const videoAd =
    videoAdResult.status === "fulfilled"
      ? videoAdResult.value.response.text()
      : (() => { errors.videoAd = (videoAdResult as PromiseRejectedResult).reason?.message ?? "Erreur inconnue"; return null; })();

  const vsl =
    vslResult.status === "fulfilled"
      ? vslResult.value.response.text()
      : (() => { errors.vsl = (vslResult as PromiseRejectedResult).reason?.message ?? "Erreur inconnue"; return null; })();

  const staticPrompt =
    staticResult.status === "fulfilled"
      ? staticResult.value.response.text()
      : (() => { errors.static = (staticResult as PromiseRejectedResult).reason?.message ?? "Erreur inconnue"; return null; })();

  return { adCopy, videoAd, vsl, static: staticPrompt, errors };
}
