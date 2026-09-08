# Start Here

Start Here rassemble les étapes pour commencer dans le cockpit local. La gestion des clients et les modèles préremplis fonctionnent sans compte IA.

## 1. Votre agence

Renseignez votre nom d'agence, offre, cible, langue et contact. Ces informations décrivent votre activité ; elles ne constituent pas un compte sur une plateforme externe. Créez ensuite votre premier client.

## 2. Votre IA personnelle

Pour rédiger du texte depuis le cockpit, créez votre propre clé dans [OpenRouter](https://openrouter.ai/keys), choisissez un identifiant de modèle proposé par ce fournisseur, puis renseignez la connexion dans Start Here. Les frais de génération dépendent de votre compte et du modèle choisi.

Le bouton de test vérifie la clé auprès du fournisseur. Une clé enregistrée n'est pas encore une connexion vérifiée ; une clé vérifiée ne garantit pas que chaque modèle est accessible avec vos crédits ou vos droits. La rédaction renvoie une erreur explicite si le modèle ou le compte ne permet pas la demande.

La clé reste dans le stockage local des connexions, séparé des dossiers clients. Elle n'est pas incluse dans l'export JSON métier ni dans les exports Markdown. Reconfigurez vos connexions sur une autre machine après restauration. Ne l'ajoutez pas à Git ou aux notes de l'agence.

Quand vous choisissez **Rédiger avec mon IA**, les informations du client et de la campagne sélectionnés sont envoyées à OpenRouter et au fournisseur de modèle utilisé. Le texte obtenu est enregistré comme livrable IA. Les modèles préremplis restent disponibles pour préparer un brouillon sans cet envoi.

Contrats utilisés : [vérification d'une clé](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key) et [génération de texte](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion), consultés le 8 septembre 2026.

## 3. Vos skills et outils

Installez les skills dans le dossier reconnu par votre assistant avec les commandes du README. Ouvrez le second cerveau `vault/`, renseignez `Company.md`, puis fournissez un dossier client exporté au skill adapté. Le [catalogue](SKILLS.md) précise les besoins de chaque méthode.

Pour le cold email, Meta Ads et les images/vidéos, connectez vos propres outils dans votre assistant ou votre plateforme. Ces connexions ne sont pas réalisées par le cockpit. Une page d'aide ou une configuration déclarée n'est pas une preuve de connexion.

## 4. Le premier onboarding

Créez un client, ouvrez son questionnaire, puis complétez les étapes métier. Vous pouvez sauvegarder un brouillon incomplet et le reprendre. La soumission exige les informations essentielles ; elle prépare une campagne en brouillon, une checklist et un brief. Elle ne lance aucune publicité, recherche externe ou séquence d'envoi.

Relisez le brief avec le client et marquez-le revu lorsque cette revue a eu lieu. Une modification de fond nécessite une nouvelle validation. Le formulaire est local : il s'utilise par l'opérateur, seul ou avec le client ; ce n'est pas un lien d'onboarding public distant.

## 5. Le premier livrable

Choisissez un modèle prérempli ou une rédaction IA, relisez le résultat et enregistrez vos modifications. Pour une recherche, une image ou une vidéo, appliquez le skill correspondant avec ses outils disponibles, puis liez le fichier réellement produit au dossier. Ne confondez pas une idée de créative, un prompt et une image livrée.
