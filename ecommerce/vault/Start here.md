# Démarrer votre business e-commerce

Ce dossier est un modèle de travail réutilisable. Il ne contient aucune boutique existante,
aucun compte, aucun client et aucun résultat. Tout ce qui y figure est à remplir.

## Première session

Ouvrez ce dossier avec votre agent et demandez-lui de lire `AGENTS.md`. Répondez ensuite à
cette question, qui suffit à démarrer :

> Dans quel marché et quelle langue voulez-vous vendre, quel type de produit vous intéresse,
> quel budget de test acceptez-vous de perdre, quels outils et comptes possédez-vous déjà,
> et quelles actions exigent votre accord explicite ?

La réponse va dans `Business.md`. Ce qui reste inconnu reste `TODO` : rien n'est inventé.
Le rôle Director écrit ensuite le premier plan dans `NOW.md`.

## Comment travailler ensuite

Le business avance en dix étapes, décrites dans `Source map.md` : recherche produit,
concurrents, sourcing, offre, marque, boutique, créatives, acquisition, rétention,
opérations. Chaque tâche et chaque livrable porte une de ces étapes.

Ne lancez pas les dix en parallèle. Une étape produit un livrable vérifiable, puis la
suivante s'appuie dessus. La séquence bloquante est : **un produit dont l'économie tient**
avant toute construction de boutique, et **une boutique dont le parcours d'achat est testé**
avant toute dépense publicitaire.

## Où sont les données

Quand ce pack est installé depuis BizOS local, le cockpit e-commerce détient l'état
canonique : profil, produits, concurrents, fournisseurs, boutiques, créatives, campagnes,
tâches, livrables et relevés. Les agents l'écrivent avec les outils `commerce_*`. Les notes
Markdown de ce coffre complètent cet enregistrement — elles ne le remplacent pas.

Sans ces outils, écrivez le livrable dans le dossier concerné de ce coffre et indiquez
explicitement ce qui reste à importer. Ne dites jamais qu'une donnée est enregistrée dans le
cockpit si aucun outil ne l'y a écrite.

## Ce que ce pack ne fait pas

Il ne crée pas de boutique, ne publie rien, ne lance aucune campagne, n'envoie aucun email
et ne dépense rien. Les comptes Shopify, publicitaires, email et de paiement sont les vôtres,
et chaque action externe demande votre autorisation explicite (`Autonomy.md`).

Les skills du pack (`skills/` dans le coffre installé) décrivent des procédures. Lire un skill ne connecte aucun
outil et n'installe aucun CLI.
