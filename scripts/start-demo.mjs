// Separate durable demo workspace, never an existing personal database.
process.env.DATA_DIR ??= new URL('../data/demo/',import.meta.url).pathname;
process.env.PORT ??= '4310';
process.env.PORTAL_PORT ??= '4311';
await import('../server.mjs');
