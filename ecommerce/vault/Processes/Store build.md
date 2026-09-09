# Construire et tester la boutique Shopify

Responsable : Store Builder. Sortie : code, catalogue brouillon, aperçu réel et rapport de recette.

## Accès et environnement

Lire `shopify-setup` avec `commerce_read_skill`, puis les procédures Shopify pertinentes. Vérifier le magasin autorisé, les droits et la version des outils disponibles. Suivre la [documentation Shopify de création de thème](https://shopify.dev/docs/storefronts/themes/getting-started/create), consultée le 9 septembre 2026 et à revérifier avant exécution.

Avec Shopify CLI configuré, `shopify theme init` prépare un thème. Depuis ce dossier, `shopify theme dev --store <votre-magasin>` démarre la prévisualisation de développement sur le magasin choisi. Vérifier l'identité du magasin avec `shopify theme info`. Un accès manquant doit être signalé ; ne pas inventer une URL d'aperçu.

## Construction

Utiliser `shopify-themes`, `shopify-liquid` et `shopify-catalog` pour le thème et les produits/variantes brouillons. Préparer fiche produit, navigation, panier, contact, informations de livraison et politiques correspondant à l'activité réelle. Utiliser des médias dont les droits sont connus et des textes fondés sur les faits produit.

Concevoir des variantes à tester : les visuels, bénéfices et moyens de paiement peuvent modifier les résultats, mais aucune recette ne garantit la conversion. Vérifier disponibilité, frais, compatibilité et contraintes des prestataires de paiement pour le compte du propriétaire.

## Recette

Exécuter les contrôles du skill `shopify-testing` et `shopify theme check`, puis vérifier mobile et bureau : choix de variante, prix/stock, quantité, ajout/retrait du panier, frais/délais, checkout en mode test, confirmation et événement de mesure. Utiliser d'abord les modes test/sandbox appropriés. Une transaction réelle n'est réalisée que si nécessaire et déjà autorisée avec un montant et un compte définis ; un remboursement ne garantit pas l'absence de frais.

Lire `shopify-performance` pour mesurer les pages réelles. Enregistrer les captures, erreurs corrigées, limites et identifiants de thème dans un livrable `store`. Le statut reste `building` ou `preview` selon les preuves. Une mise en ligne exige la portée autorisée par le propriétaire et une vérification réelle après publication. La commande de publication n'est pas une étape automatique de la recette.
