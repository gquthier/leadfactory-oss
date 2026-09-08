# Merge tags par provider (syntaxe exacte)

| Provider | Prénom | Société | Notes |
|---|---|---|---|
| Emelia | `{{firstName}}` | `{{companyName}}` | spintax `{a\|b}`, repli `{{firstName \| "there"}}` |
| Lemlist | `{{firstName}}` | `{{companyName}}` | `{{icebreaker}}`, spintax, repli |
| Smartlead | `{{first_name}}` | `{{company_name}}` | snake_case, spintax |
| Instantly | `{{firstName}}` | `{{companyName}}` | `{{personalization}}`, spintax, repli |
| La Growth Machine | `%FirstName%` | `%CompanyName%` | TitleCase, pourcentages, pas de spintax |
| HeyReach | `{firstName}` | `{companyName}` | accolade simple |
| Apollo | `{{first_name}}` | `{{organization_name}}` | snake_case |
| Woodpecker | `{{FIRST_NAME}}` | `{{COMPANY}}` | MAJUSCULES, spintax, repli `{{FIRST_NAME\|there}}` |

Aucune variation de casse, de séparateur ou d'accolades. Vérifier la documentation du provider si un tag inhabituel est nécessaire.
