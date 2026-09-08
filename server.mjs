#!/usr/bin/env node
// Point d'entrée : écoute uniquement sur la loopback.

import { createApp } from './lib/app.mjs';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT ?? 4310);

let app;
try {
  app = await createApp({ dataDir: process.env.DATA_DIR });
  app.server.listen(PORT, HOST, () => {
    console.log(`LeadFactory OSS démarre sur http://${HOST}:${PORT}`);
    console.log(`Données : ${app.dataDir}/db.json (verrou : db.lock, connexions IA : connections.json)`);
    console.log('Ctrl+C pour arrêter.');
  });
  app.server.on('error', async (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `Le port ${PORT} est déjà utilisé. Fermez l'autre instance. ` +
          'Pour une seconde instance, utilisez un autre dossier de données : DATA_DIR=./data-2 PORT=4311 npm start'
      );
    } else {
      console.error('Erreur serveur :', err.message);
    }
    await app.store.close();
    process.exit(1);
  });
} catch (err) {
  console.error('Démarrage impossible.');
  console.error(err.message);
  process.exit(1);
}

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\nArrêt (${signal}) : écritures terminées, verrou relâché.`);
  try {
    await app.close();
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
