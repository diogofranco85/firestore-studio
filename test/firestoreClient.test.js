const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const dbPath = path.join(__dirname, '.tmp-client.db');
process.env.CONNECTIONS_DB_PATH = dbPath;
test.after(() => fs.rmSync(dbPath, { force: true }));

const store = require('../server/connectionsStore');
const { getClient, resetClient } = require('../server/firestoreClient');

test('getClient returns a Firestore instance for an emulator connection', async () => {
  const conn = store.createConnection({
    name: 'Teste',
    type: 'emulator',
    projectId: 'demo-project',
    emulatorHost: 'localhost:4588',
  });
  const db = await getClient(conn.id);
  assert.strictEqual(typeof db.collection, 'function');

  const again = await getClient(conn.id);
  assert.strictEqual(db, again, 'deve reaproveitar o client em cache');
});

test('getClient rejects for an unknown connection id', async () => {
  await assert.rejects(() => getClient('does-not-exist'));
});

test('getClient works again after resetClient for the same connection', async () => {
  const conn = store.createConnection({
    name: 'Teste reset',
    type: 'emulator',
    projectId: 'demo-project',
    emulatorHost: 'localhost:4588',
  });
  await getClient(conn.id);
  await resetClient(conn.id);
  const db = await getClient(conn.id);
  await assert.doesNotReject(() => db.listCollections());
});

test('getClient não deixa a env var FIRESTORE_EMULATOR_HOST sequestrar outras conexões', async () => {
  // Simula o cenário real: a env var já está setada (via .env) quando o
  // módulo é carregado pela primeira vez. Recarregamos o módulo para
  // reexecutar seu delete no topo do arquivo com a env var presente.
  process.env.FIRESTORE_EMULATOR_HOST = 'localhost:9999';
  delete require.cache[require.resolve('../server/firestoreClient')];
  const { getClient: freshGetClient } = require('../server/firestoreClient');
  try {
    const connA = store.createConnection({
      name: 'Conexão A',
      type: 'emulator',
      projectId: 'demo-project',
      emulatorHost: 'localhost:4588',
    });
    const connB = store.createConnection({
      name: 'Conexão B',
      type: 'emulator',
      projectId: 'demo-project',
      emulatorHost: 'localhost:59999',
    });
    const dbA = await freshGetClient(connA.id);
    const dbB = await freshGetClient(connB.id);
    // Nesta versão do SDK, settings({host}) é exposto como servicePath+port.
    assert.strictEqual(`${dbA._settings.servicePath}:${dbA._settings.port}`, 'localhost:4588');
    assert.strictEqual(`${dbB._settings.servicePath}:${dbB._settings.port}`, 'localhost:59999');
  } finally {
    delete process.env.FIRESTORE_EMULATOR_HOST;
  }
});
