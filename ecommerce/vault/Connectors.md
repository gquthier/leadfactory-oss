# Outils, comptes et source de vérité

Le cockpit e-commerce détient l'état métier quand ce pack est installé depuis BizOS local.
Tout le reste — boutique, publicité, email, paiement, logistique — appartient au propriétaire
et n'est pas configuré par ce modèle.

| Capacité | Outil / compte choisi | Source de vérité | Actions autorisées | État |
|---|---|---|---|---|
| État métier (produits, concurrents, boutiques, campagnes, relevés) | Cockpit e-commerce | Cockpit | Lecture et écriture via `commerce_*` | Fourni par l'installation |
| Boutique | TODO | Plateforme | TODO | Non configuré |
| Sourcing et fournisseurs | TODO | Devis et échanges datés | Aucun contact sans autorisation | Non configuré |
| Publicité | TODO | Compte publicitaire | Aucune dépense sans autorisation | Non configuré |
| Email et rétention | TODO | Outil email | Rédaction ; envoi sur autorisation | Non configuré |
| Paiement | TODO | Prestataire de paiement | Aucune modification sans autorisation | Non configuré |
| Logistique | TODO | Prestataire ou fournisseur | TODO | Non configuré |
| Mesure | Saisie manuelle dans le cockpit | Relevés saisis, avec leur source | Saisie datée et sourcée | Manuel |

Pour chaque outil connecté, noter : le compte, le responsable, le périmètre accordé et la
manière de révoquer l'accès. Les identifiants restent hors de ce dossier.

Un skill peut décrire un outil sans que cet outil soit installé. Une capacité absente produit
un constat d'indisponibilité, jamais une action annoncée comme réalisée.
