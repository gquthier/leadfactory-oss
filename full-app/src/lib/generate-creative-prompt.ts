import type { OnboardingData } from "@/types/onboarding";

function val(v: unknown): string {
  if (!v) return "—";
  if (Array.isArray(v)) return v.join(", ") || "—";
  return String(v).trim() || "—";
}

export function buildBasePrompt(r: Record<string, unknown>): string {
  const d = r as unknown as OnboardingData;

  return `
# BRIEF CRÉATIF — CAMPAGNE META ADS
## ${val(d.a_entreprise).toUpperCase()}

---

## 1. CONTEXTE CLIENT

**Entreprise :** ${val(d.a_entreprise)}
**Pays / Langue :** ${val(d.a_pays_langues)}
**Réseaux :** ${val(d.a_reseaux)}
**Type d'offre :** ${val(d.a_type)} ${d.a_type_autre ? `(${d.a_type_autre})` : ""}
**Prix / Panier moyen :** ${val(d.a_prix)}
**Cycle de décision :** ${val(d.a_cycle_decision)}

**Résumé de l'offre :**
${val(d.a_resume_offre)}

**Caractéristique — Avantage — Bénéfice :**
${val(d.a_cab)}

**Problèmes résolus :**
${val(d.a_problemes)}

**Éléments différenciants :**
${val(d.a_differenciants)}

**Bénéfices concrets clients :**
${val(d.a_benefices)}

**Principaux concurrents :**
${val(d.a_concurrents)}

**Différenciation vs concurrents :**
${val(d.a_differenciation)}

---

## 2. OBJECTIF DE CAMPAGNE

**Objectif principal :** ${val(d.b_objectif)}
**Conversion à optimiser :** ${val(d.b_conversion)}
**Événement de conversion :** ${val(d.b_event_name)}
**KPI principal :** ${val(d.b_kpi)}
**Objectif chiffré :** ${val(d.b_objectif_chiffre)}

**Définition d'un lead de qualité :**
- Critère 1 : ${val(d.b_qualite_critere1)}
- Critère 2 : ${val(d.b_qualite_critere2)}

---

## 3. MESSAGE PUBLICITAIRE

**Offre / CTA à pousser :** ${val(d.c_cta_type)} ${d.c_cta_autre ? `(${d.c_cta_autre})` : ""}
**Promesse principale :** ${val(d.c_promesse)}

**Bénéfices clés :**
1. ${val(d.c_benefice1)}
2. ${val(d.c_benefice2)}
3. ${val(d.c_benefice3)}

**Preuve la plus forte :** ${val(d.c_preuve_type)} — ${val(d.c_preuve_detail)}

**CTA exact :** ${val(d.e_cta_exact)}

**NO-GO ABSOLUS (à ne jamais dire/montrer) :**
${val(d.c_nogo)}

---

## 4. CIBLAGE

### Cible 1 — ${val(d.d_cible1_description)}
- **Secteur / Taille :** ${val(d.d_cible1_secteur)}
- **Fonctions / Titres :** ${val(d.d_cible1_fonctions)}
- **Problèmes quotidiens :** ${val(d.d_cible1_problemes)}
- **Valeur ajoutée :** ${val(d.d_cible1_valeur)}
- **Freins / Objections :** ${val(d.d_cible1_freins)}
- **Motivations psychologiques :** ${val(d.d_cible1_motivations)}

### Cible 2 — ${val(d.d_cible2_description)}
- **Secteur / Taille :** ${val(d.d_cible2_secteur)}
- **Fonctions / Titres :** ${val(d.d_cible2_fonctions)}
- **Problèmes quotidiens :** ${val(d.d_cible2_problemes)}
- **Valeur ajoutée :** ${val(d.d_cible2_valeur)}
- **Freins / Objections :** ${val(d.d_cible2_freins)}
- **Motivations psychologiques :** ${val(d.d_cible2_motivations)}

**Exclusions :** ${val(d.d_exclusions)}

---

## 5. PARCOURS POST-CLIC

**Destination principale :** ${val(d.e_destination_principale)} ${d.e_destination_principale_autre ? `(${d.e_destination_principale_autre})` : ""}
**URL :** ${val(d.e_url)}
**CTA affiché :** ${val(d.e_cta_exact)}
**Délai de réponse :** ${val(d.e_delai_reponse)}
**Qui répond :** ${val(d.e_qui_repond)}

---

## 6. BUDGET

**Budget mensuel :** ${val(d.g_budget)} €
**Timing / Saisonnalité :** ${val(d.g_timing)}
`.trim();
}

export function buildClaudeSystemPrompt(): string {
  return `Tu es un expert senior en publicité Meta (Facebook & Instagram) spécialisé en génération de leads B2B. Tu as plus de 10 ans d'expérience en media buying, copywriting publicitaire et direction créative pour des annonceurs B2B avec des budgets de 500€ à 100k€/mois.

Ta mission : transformer un brief client en un prompt créatif ultra-détaillé et actionnable pour produire des visuels publicitaires statiques performants sur Meta.

Tu raisonnes comme un strategist + copywriter + directeur artistique combinés. Tes recommandations sont précises, basées sur les meilleures pratiques Meta Ads 2025, et adaptées au contexte B2B français.`;
}

export function buildClaudeUserPrompt(baseBrief: string): string {
  return `${baseBrief}

---

## TA MISSION

Sur la base du brief ci-dessus, génère un **prompt créatif complet et ultra-détaillé** pour la production de visuels publicitaires statiques Meta. Ce prompt sera utilisé par un designer/concepteur pour créer les visuels.

### STRUCTURE TA RÉPONSE AINSI :

---

## 🎯 STRATÉGIE CRÉATIVE

Analyse le brief et définis **3 angles créatifs distincts** (ex: douleur/solution, preuve sociale, bénéfice direct). Pour chaque angle :
- **Nom de l'angle**
- **Concept central** (1 phrase)
- **Mécanique psychologique** (pourquoi ça convertit pour cette cible)
- **Niveau de conscience** du prospect visé (problem-aware, solution-aware, etc.)

---

## 📐 FORMATS & SPÉCIFICATIONS

Pour chaque angle, décline sur **3 formats** :
- **1:1 (1080×1080px)** — Feed carré
- **4:5 (1080×1350px)** — Feed portrait (meilleur reach)
- **9:16 (1080×1920px)** — Story & Reels

---

## ✍️ COPYWRITING PAR ANGLE

Pour chacun des 3 angles :

### ANGLE X — [Nom]

**Headline (≤ 40 car.) :**
> [Ton headline accrocheur]

**Sous-titre (≤ 80 car.) :**
> [Sous-titre complémentaire]

**Primary Text — Version courte (≤ 125 car.) :**
> [Pour mobile, attention courte]

**Primary Text — Version longue (storytelling, 150-300 mots) :**
> [Hook + développement + CTA]

**Primary Text — Variante preuve sociale :**
> [Avec chiffres ou témoignage]

**Hook visuel (ce qui arrête le scroll en < 1,5 sec) :**
> [Description de l'accroche visuelle]

---

## 🎨 DIRECTIVES VISUELLES

### Style global
- **Ambiance générale :** [ex: professionnel/premium, corporate moderne, humain/chaleureux]
- **Palette recommandée :** [couleurs HEX + rôle de chaque couleur]
- **Typographie :** [familles de polices + hiérarchie]
- **Photographie :** [style, sujets à montrer/éviter, banque d'images suggérée]
- **Éléments graphiques :** [formes, icônes, patterns, cadres]

### Par angle : description visuelle précise
Pour chaque angle, décris le visuel en détail (composition, premier plan, arrière-plan, textes intégrés, couleurs dominantes, CTA button style).

---

## ⚠️ RÈGLES IMPÉRATIVES

**À respecter absolument :**
${baseBrief.includes("NO-GO") ? "Voir section NO-GO du brief" : "- Pas de promesses non vérifiables\n- Rester dans les clous des politiques Meta Ads\n- Ton premium, jamais cheap"}

**Conformité Meta Ads :**
- Ratio texte/image : privilégier < 20% de texte sur le visuel
- Pas de before/after sans disclaimer
- Pas de claims santé non étayés
- Ciblage RGPD compliant

---

## ✅ CHECKLIST VALIDATION FINALE

Avant de valider un visuel, vérifier :
- [ ] La promesse principale est visible en < 2 secondes
- [ ] Le CTA est clair et unique
- [ ] Les no-go sont respectés
- [ ] Le visuel fonctionne en noir & blanc (contraste OK)
- [ ] Le texte est lisible sur mobile (taille min. 16px équivalent)
- [ ] L'identité de marque est cohérente
- [ ] Le lien avec la landing page est évident (continuité créative)`;
}
