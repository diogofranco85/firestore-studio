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
