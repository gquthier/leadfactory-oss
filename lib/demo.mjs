// Jeu de données de démonstration, explicitement fictif.

export function demoPayload(newId) {
  const clientId = newId();
  const campaignId = newId();
  return {
    client: {
      id: clientId,
      company: 'Atelier Démo',
      contact: 'Camille Exemple',
      email: 'contact@example.com',
      offer: 'Accompagnement lead gen B2B (données fictives)',
      audience: 'PME industrielles de 20 à 200 salariés',
      goal: '10 rendez-vous qualifiés par mois',
      budget: 2500,
      notes: 'Client fictif créé par le bouton "Charger la démo". Aucune donnée réelle.',
      status: 'onboarding'
    },
    campaign: {
      id: campaignId,
      clientId,
      name: 'Cold email - trimestre démo',
      channel: 'cold-email',
      goal: 'Tester deux accroches sur la cible principale',
      budget: 800,
      status: 'draft'
    },
    tasks: [
      { id: newId(), clientId, campaignId: null, title: 'Appel de cadrage (démo)', done: true, onboardingKey: null },
      { id: newId(), clientId, campaignId, title: 'Construire la liste de prospects (démo)', done: false, onboardingKey: null },
      { id: newId(), clientId, campaignId, title: 'Relire la séquence avant envoi (démo)', done: false, onboardingKey: null }
    ]
  };
}
