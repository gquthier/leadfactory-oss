---
name: cold-traffic-landing-page
description: Conçoit et construit une landing page statique (HTML, CSS, JS) pour trafic froid Meta, TikTok ou YouTube — archétype de page, copy bloc par bloc, système de design fidèle à la marque, formulaire ou réservation, QA mobile — à partir du site du client, du brief et des rapports de recherche. À utiliser pour "landing page {client}", "page d'opt-in", "page de capture" ; pas pour une VSL (vsl-copywriter) ni pour les pubs (meta-ads-copywriter).
---

# Cold Traffic Landing Page

Sortie : un dossier de page statique dans `{CLIENT_DIR}/06-landing-page/` + un `copy-blueprint.md`. Le déploiement (Vercel, Netlify, hébergeur) se fait uniquement avec la CLI ou le compte que l'utilisateur a configuré, sur sa demande explicite.

## Entrées

1. URL du site client, lue avec l'outil de fetch disponible : couleurs, logo, typographie, ton, langage d'offre, cibles de CTA existantes.
2. Brief d'onboarding (`{CLIENT_DIR}/00-onboarding/onboarding-form.md` ou texte collé) : offre, prix, ICP, douleurs, bénéfices, CTA, preuves, assets de marque.
3. Rapports `{CLIENT_DIR}/01-deep-search/` : conscience, sophistication, verbatims, hooks gagnants, gaps.
4. Optionnel mais recommandé : `04-vsl/strategy.md` (big idea, mécanisme), `05-meta-ads/ads-multi-variantes.md` (congruence pub → page), assets (logo, visuels, témoignages).

Minimum sans recherche : URL, dossier client, objectif principal (opt-in / réservation / vue VSL), URL du formulaire ou de l'agenda, ICP + offre + prix.

Tout lire avant d'écrire une ligne. Ne jamais inventer preuve, témoignage, chiffre ou logo : placeholder `[À FOURNIR]` visible.

## Pipeline

1. **Contexte** : bloc-notes interne (avatar, conscience, sophistication, 3 douleurs verbatim, 3 résultats désirés, big idea et mécanisme hérités, offre et garantie, inventaire des preuves, marque : 2 couleurs + accent + police + ton + logo, CTA et destination).
2. **Archétype** (une ligne de justification) :

| Conscience | Objectif | Archétype |
|---|---|---|
| Solution / Product aware | réserver un appel | page de candidature, courte, qualification |
| Solution / Product aware | voir la VSL puis réserver | page hôte VSL : vidéo + 1 CTA |
| Problem aware | ressource gratuite | squeeze : hero + 3 puces + formulaire |
| Most aware | achat direct | page de vente longue |
| froid, faible conscience | réserver un appel | advertorial narratif → appel |

Défaut pour une offre de service haut de gamme en trafic froid : page de candidature, bloc VSL au-dessus de la ligne de flottaison si une VSL existe.

3. **Copy bloc par bloc** dans `copy-blueprint.md`, structure dans [references/copy-blueprint.md](references/copy-blueprint.md). Un seul CTA de destination, répété 3 à 4 fois. Mécanisme nommé 3 à 5 fois. Verbatims de la recherche comme puces.
4. **Design** : mapper la marque (couleurs hex, police, rayon, ambiance). Défauts si marque faible : fond sombre `#0A0A0A` ou clair chaud `#FAFAF7`, une couleur d'accent, police distinctive (Geist, Satoshi, Manrope, Sora, Space Grotesk, Instrument Serif ou Fraunces en display), boutons larges à fort contraste, sections espacées, mobile d'abord à 375 px. Éviter les templates génériques : pas de dégradés violets, pas de 3 cartes SaaS identiques, pas de gris sur gris, un seul élément visuel signature (marquee, badge, mise en page asymétrique).
5. **Construction** : `index.html`, `styles.css`, `script.js` (CTA collant mobile après 30 % de scroll, accordéon FAQ, défilement doux, envoi de formulaire), `assets/`. Tailwind via CDN acceptable ; framework (Next.js) seulement sur demande. Head : viewport, Open Graph, favicon, police choisie, placeholder pixel `<!-- PIXEL : coller l'id du brief -->`. Formulaire : prénom, email, téléphone (+ 1 à 2 questions de qualification si candidature), champ honeypot, état de succès ou redirection, événement `Lead` déclenché seulement si le pixel est configuré. Sections sémantiques avec `id`, `h1` unique, labels accessibles.
6. **QA** : headline ≤ 12 mots avec délai ou spécificité · un seul CTA de destination · mécanisme 3 à 5 fois · ≥ 3 verbatims · ≥ 1 preuve sourcée ou placeholder · FAQ de 5 à 7 vraies objections · mentions légales et contact en pied · rendu correct à 375, 768, 1280 px · contraste AA · aucun lien `#` cassé · action de formulaire réelle ou placeholder signalé · congruence avec le hook gagnant des pubs. Prévisualiser en local (`python3 -m http.server`) ; si un outil de capture est disponible, vérifier mobile et desktop.
7. **Livraison** : `README.md` dans le dossier (ce qui manque, placeholders à remplacer, étapes avant lancement). Déployer seulement si demandé et si la CLI est authentifiée ; sinon donner la commande.

## Règles

Mobile d'abord · aucune preuve inventée · congruence pub → page (même hook, même mécanisme, même CTA) · performance (image hero légère) · un chemin de sortie : `{CLIENT_DIR}/06-landing-page/`.
