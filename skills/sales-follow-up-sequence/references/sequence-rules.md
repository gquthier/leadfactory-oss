# Règles de séquence et templates

Séquence `proposal_followup_v1` :

| Step | Timing | Objectif |
|---|---|---|
| `proposal_sent` | T0 | livrer la proposition, rendre l'action simple |
| `case_studies_j2` | J+2 | preuves, cas clients réels |
| `clarity_check_j6` | J+6 | lever le doute, obtenir une réponse courte |
| `manual_review` | après J+6 | action humaine (appel, message), pas d'email automatique |

Timing depuis `proposal_sent_at` (sinon l'activité « proposition envoyée », sinon `last_contacted_at`). Date le week-end → prochain jour ouvré, fuseau de l'activité commerciale.

Classification : chaud (réponse, question, paiement initié, appel calé) → action manuelle · tiède → prochain step si dû · froid (J+6 passé) → email 3 puis manuel · silencieux (email 3 sans réponse) → arrêt automatique · payé / gagné → aucune relance.

Priorité des événements (les 6 premiers bloquent) : paiement · ne pas contacter · stage gagné/perdu/client · réponse ou activité humaine · appel planifié · step déjà envoyé · timing.

Ne jamais envoyer : « je me permets de relancer » sans valeur nouvelle, « as-tu eu le temps ? » en boucle, urgence fausse, relance après paiement, relance sur devis expiré, liens placeholder.

## Variables

`{{first_name}}` (repli « Bonjour, »), `{{client_name}}`, `{{agency_name}}`, `{{proposal_url}}` (obligatoire), `{{case_study_links}}` (obligatoire email 2, réels), `{{whatsapp_url}}` (`https://wa.me/<numéro international sans +>`), `{{signature}}` (nom, rôle, société, téléphone, configurés une fois).

## Email 1 — T0

Objet : `Proposition {{client_name}} - {{agency_name}}`

```
Bonjour {{first_name}},

Merci pour votre temps aujourd'hui. Comme convenu, voici votre proposition commerciale personnalisée :
{{proposal_url}}

Le devis et les modalités de règlement sont intégrés dans la proposition. Si vous avez des questions, je suis joignable ici ou sur WhatsApp.

Bonne journée,
{{signature}}
```

## Email 2 — J+2

Objet : `Cas clients {{agency_name}}`

```
Bonjour {{first_name}},

Je voulais vous partager quelques cas de clients qui étaient dans une situation proche de la vôtre :
{{case_study_links}}

L'objectif de la période de test est simple : tester le canal proprement, obtenir des signaux réels, puis décider sur des chiffres.

Votre proposition reste ici : {{proposal_url}}

{{signature}}
```

## Email 3 — J+6

Objet : `Tout est clair ?`

```
Bonjour {{first_name}},

Nous avions eu un bon échange, mais je n'ai pas eu de retour sur la proposition. Tout était clair ? Y a-t-il un élément que je peux vous apporter pour trancher ?

Vous pouvez aussi m'envoyer un message ici : {{whatsapp_url}}

Bonne journée,
{{signature}}
```

Tutoiement possible si le CRM indique que c'est l'usage avec ce lead. Variantes WhatsApp courtes uniquement si le canal est autorisé.

## Décision auditable

```json
{"lead_id": "…", "eligible": true, "selected_step": "case_studies_j2", "blocked_reason": null,
 "crm_snapshot_at": "ISO", "proposal_ref": "…", "last_sequence_step": "proposal_sent", "next_follow_up": "ISO"}
```
