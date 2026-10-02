# Contrat CRM (à adapter au schéma réel)

Si le code ou l'API du CRM est accessible, inspecter le schéma réel. Sinon, utiliser ce contrat ; un tableau (Notion, feuille de calcul) transpose chaque bloc en colonnes et les activités en onglet journal.

## À lire

- Lead : `id`, `first_name`, `last_name`, `email`, `phone`, `company`, `status`, `pipeline_stage`, `assigned_to`, `last_contacted_at`, `next_follow_up`, `tags`, `notes`, `preferred_contact`, `updated_at`.
- Proposition : `proposal_url`, `proposal_ref`, `proposal_sent_at`, `pricing_amount_eur`, `payment_link`, `valid_until`, `status`. Sinon chercher dans `activities.metadata`, `notes`, champs custom.
- Paiement : `payment_status`, `paid_at`, identifiants de session ou d'intention de paiement, `invoice_status`. Statuts bloquants : `paid`, `succeeded`, `complete`, `closed_won`, `won`, `client`, `onboarding`, `refunded`, `chargeback`. Ambigu → bloquer.
- Activités depuis l'envoi de la proposition : `type` (`email`, `call`, `note`, `meeting`, `whatsapp`, `stage_change`, `payment`, `proposal_sent`, `followup_email`), `created_at`, `created_by`, `metadata`.

## À écrire après envoi

`last_followup_email_sent_at`, `last_followup_sequence_step`, `last_followup_sequence_name` (`proposal_followup_v1`), `followup_sequence_status` (`active` / `completed`), `next_follow_up`, `last_contacted_at`. Colonnes absentes → activité `followup_email` avec metadata complète et signaler que le schéma devrait être étendu.

Activité obligatoire :

```json
{"type": "followup_email", "title": "Follow-up - case_studies_j2",
 "metadata": {"sequence_name": "proposal_followup_v1", "sequence_step": "case_studies_j2", "provider": "…",
              "provider_message_id": "…", "proposal_ref": "…", "sent_at": "ISO",
              "idempotency_key": "lead:{lead_id}:proposal:{proposal_ref}:step:{step}"}}
```

Idempotence : avant envoi, chercher une activité avec même `sequence_name`, `sequence_step`, `proposal_ref` ; si elle existe, ne pas renvoyer.

Design idéal : un endpoint serveur atomique (recharge, vérifie, envoie, met à jour, journalise) avec `expected_lead_updated_at` et `dry_run`. Sans endpoint : opérations séquentielles et signaler le risque de course. Si le CRM ne peut pas être mis à jour après envoi : brouillon seulement.
