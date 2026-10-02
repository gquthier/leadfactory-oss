# Du brief au livrable créatif

Lecture et packaging : **1er octobre 2026**. Méthodes personnelles adaptées des essais des **29–30 septembre** et du workflow UGC antérieur ; modules HyperFrames installés les **28–30 septembre**. Statut : fichiers et parcours de production fournis ; aucun nouveau rendu client ni appel média payant effectué lors du packaging.

## Choisir une mission

| Mission | Skill d'agence | Livrables | Outils à prévoir |
|---|---|---|---|
| Décliner une vidéo longue | agency-shortform-editing | Extrait, captions, projet, MP4, QA | Source, transcript, moteur vidéo ; ffmpeg/Python/numpy pour le mixeur optionnel |
| Lancer un produit | agency-product-film | Preuves, storyboard, captures, film et projet | Accès de capture autorisé, moteur vidéo ; voix/médias au choix |
| Produire une publicité avatar | agency-ugc-video | Script, audio, vidéo synchronisée, QA | Identité autorisée et service de voix/avatar configuré |
| Décliner des statiques | creative-brief + creative-statics-v2 | Concepts, variations et images si générées | Modèle ou outil image configuré |
| Préparer une VSL | vsl-copywriter + vsl-end-to-end-builder | Structure et script, puis montage avec moteur disponible | Recherche, offre, preuves ; vidéo seulement pour le rendu |

## Installation à la carte

Les **39 skills d'agence** s'installent avec la commande habituelle. Les **12 modules HyperFrames** sont dans un pack optionnel séparé pour ne pas injecter leur bibliothèque dans tous les contextes d'agents.

```sh
node scripts/install-skills.mjs --target ./my-agency/.claude/skills
node scripts/install-skills.mjs --pack creative --target ./my-agency/.claude/skills
```

Le même dossier reçoit les deux ensembles sans noms en double. Un nom déjà présent provoque un arrêt avant écriture pour l'appel concerné. `--dry-run` prévisualise ; `--only` permet une sélection. Un dossier `.codex/skills` de projet peut également être utilisé selon votre assistant. Le [moteur optionnel](../extras/creative-engine/README.md) précise ses licences et dépendances.

## Une campagne complète, sans perdre le contexte

1. Partir du client et de sa campagne dans le cockpit. Recueillir offre, audience, résultat attendu, formats, budget et preuves.
2. Utiliser `creative-brief` pour transmettre les contraintes au rôle Creative Strategist ; rattacher chaque affirmation commerciale à une source.
3. Choisir le workflow adapté dans le tableau. Écrire les éléments propres à ce client dans son dossier autorisé ; garder les modèles vierges dans le pack.
4. Préparer source, storyboard, transcript/captions et registre média. Nommer les variantes par hypothèse : hook, démonstration, angle, rythme. Comparer une variable quand cela facilite le retour.
5. Produire et revoir : lisibilité, crop, typographie, transitions, voix, true peak et décodage. Noter couverture et anomalies ; ne pas confondre fichier rendu et résultat marketing validé.
6. Rattacher au cockpit un livrable texte avec chemins, statut et prochaines actions. Les vidéos demeurent dans le dossier média autorisé : le cockpit ne devient pas un hébergeur ou un lecteur vidéo par l'ajout des skills.
7. Faire approuver le livrable dans le processus client, puis mesurer la campagne si elle est diffusée dans un mandat distinct. Documenter observations et hypothèses sans inventer ROAS ou conversions.

## Exemple fictif de brief

**Atelier Démo**, studio de services fictif. Objectif : expliquer une prestation en 25 secondes à un dirigeant de PME. Livrables : une vidéo 16:9 et une adaptation 9:16, avec projet et captions. Hypothèse : montrer le passage du brief à la livraison rend l'offre plus compréhensible. Critère de recette : le spectateur comprend la prestation et le CTA ; aucune promesse de performance sans source. Offre, prix et destination du CTA restent à fournir.

## BizOS — statut de cette extension

- Les trois nouveaux skills sont dans `skills/`, à côté des 26 existants ; le build du kit les rend disponibles au mécanisme local existant. Les notes Creative et le manifeste source sont mis à jour.
- Le moteur créatif optionnel reste séparé dans `extras/creative-engine/` ; il n'est pas automatiquement installé dans un coffre BizOS.
- Cette livraison ne modifie ni l'app installée ni un runtime cloud. Les sources d'intégration héritées restent historiques ; aucun parcours actuel dans BizOS Simple n'est certifié ici.
- Si les outils `agency_*` sont réellement exposés au run, les utiliser pour les enregistrements métier. Sinon livrer les fichiers et indiquer le rattachement restant. Aucun faux message de synchronisation.

## Droits et ressources

Les méthodes personnelles sont généralisées : aucun clone vocal, visage, identifiant fournisseur, projet privé ou média client n'est redistribué. Les scripts historiques d'API UGC et de capture BizOS ne sont pas copiés ; leurs dépendances étaient personnelles. Le mixeur portable est inclus et documenté. Le moteur HyperFrames garde Apache-2.0, les polices leurs notices SIL OFL ; les MP3 Pixabay sont exclus. Voir [attributions](../THIRD_PARTY_NOTICES.md).

## Ads Meta 9:16

Le skill `agency-meta-motion-ad` exploite site, charte, preuves et assets du client pour concevoir une ad verticale dynamique, avec texte animé et voix ElevenLabs synchronisée. Préférence utilisateur : Opus 5.5 pour la direction et la composition. [Skill, brief et helper voix](../skills/agency-meta-motion-ad/SKILL.md). Le rendu nécessite la mission client et les connexions appropriées ; il est distinct de la proposition automatique de l’onboarding.
