# Gabarit de preset (un expéditeur)

```yaml
entreprise: ""            # l'expéditeur
resumeOffre: ""           # 1 phrase
typeOffre: ""             # SaaS / Service / Agence / Conseil
prix: ""
promesse: ""
benefice1: ""
benefice2: ""
benefice3: ""
differenciants: ""
preuves: ""               # uniquement des preuves réelles, avec source
icps:
  - nom: ""
    cibleDescription: ""
    cibleSecteur: ""
    cibleFonctions: ""
    cibleProblemes: ""    # 2 à 3 douleurs concrètes
    cibleValeur: ""
    cibleFreins: ""
    cibleMotivations: ""
ctaType: ""               # reply / book / watch / register / download / audit
ctaExact: ""
destination: ""
provider: ""
langue: fr
objectif: ""              # génération de leads / réactivation / upsell
anglesPredefinis: []
antiPatternsSpecifiques: []   # ce qu'il ne faut jamais dire pour cet expéditeur
```

Création : poser les questions une à la fois, proposer 3 angles inférés, demander les interdits, sauvegarder dans `{CLIENT_DIR}/08-outbound/presets/<slug>.md`.
