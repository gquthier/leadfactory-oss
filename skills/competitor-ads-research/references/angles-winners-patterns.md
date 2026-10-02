# 5 angles, ads durables, extraction de patterns

## Les 5 angles (un seul par ad)

| Angle | Définition | Signaux de détection |
|---|---|---|
| Douleur | Verbalise une douleur précise du prospect dès le hook | « Si tu … », « Marre de … », validation du problème avant la solution |
| Désir | Peint la transformation finale sans s'attarder sur le problème | État final positif, chiffre cible, vocabulaire aspirationnel |
| Preuve | S'appuie sur un cas client, un témoignage, un résultat chiffré | Prénom + résultat, format témoignage ou étude de cas |
| Contre-intuitif | Casse une croyance partagée du marché | « Tout le monde dit X. C'est faux. », ton affirmé |
| Urgence | Donne une raison d'agir maintenant | Deadline, places limitées, bonus expirant |

Règle en cas de mélange : classer selon l'angle dominant dans les 3 premières secondes (ou la première phrase). Égalité : Contre-intuitif > Preuve > Urgence > Douleur > Désir.

Exclure de l'analyse : ads de notoriété pure sans hook (marquer « Branding »), ads dans une langue non maîtrisée. Témoignage court sans hook clair → Preuve par défaut.

## Ads durables

Personne ne laisse tourner longtemps une ad qui ne convertit pas : la durée d'activité est le meilleur proxy disponible depuis l'extérieur. Ce n'est pas une mesure de performance ; l'écrire dans le brief.

| Jours actifs | Statut |
|---|---|
| < 7 | test |
| 7 à 21 | validation |
| > 21 | `winner` |
| > 60 | `hero` |
| > 180 | `evergreen` |

Signaux de renfort : plusieurs variantes du même angle (scaling), diffusion multi-pays, multi-plateformes, relances d'une même créative sous plusieurs ids, landing dédiée. Anti-signaux : campagne de notoriété, pas de CTA, reach très faible.

Les sections « Top hooks » et « Top CTA » du brief sont extraites uniquement des ads durables.

## Extraction des patterns

1. **Structures de hooks** récurrentes (3 occurrences ou plus), avec nombre de concurrents. Exemples de gabarits : « Si tu [persona] et que tu [galère], … », « Voilà comment [résultat] en [délai] », « Tout le monde te dit [croyance]. C'est faux. », « [Prénom] a fait [résultat] en [délai] ».
2. **Frameworks de copy** du corps : PAS, AIDA, Hook-Story-Offer, Before/After/Bridge, listicle. Compter parmi les ads durables.
3. **Format dominant par angle** (face caméra, UGC, statique, carrousel, VSL) chez les ads durables : c'est ce qui guide les recommandations de format.
4. **CTA récurrents** classés direct / doux / conditionnel / rareté. Top 5.
5. **Douleurs partagées** : une douleur présente chez 4 concurrents ou plus = angle saturé, à éviter ou à retourner.
6. **White spaces** : lister les 10 douleurs majeures du marché (deep search ou brief), cocher celles exploitées par les concurrents ; les autres sont des opportunités.
7. **Évolution temporelle** (si 90 jours) : angles émergents, angles abandonnés, saisonnalité.

Section attendue dans `analysis.md` :

```markdown
## Patterns détectés
### Hooks (structures récurrentes)
1. "…" — N occurrences, M concurrents
### Frameworks de copy
- PAS : N ads (x %)
### Angles saturés
- Douleur "…" : M concurrents
### White spaces
- Aucun concurrent ne joue l'angle "…"
```
