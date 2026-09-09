const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const dbPath = path.join(__dirname, '.tmp-connections.db');
process.env.CONNECTIONS_DB_PATH = dbPath;
test.after(() => fs.rmSync(dbPath, { force: true }));

const store = require('../server/connectionsStore');

test('createConnection, getConnection, listConnections round-trip', () => {
  const created = store.createConnection({
    name: 'Local',
    type: 'emulator',
    projectId: 'demo',
    emulatorHost: 'localhost:4588',
  });
  assert.ok(created.id);
  assert.strictEqual(created.name, 'Local');

  const fetched = store.getConnection(created.id);
  assert.strictEqual(fetched.projectId, 'demo');

  const list = store.listConnections();
  assert.ok(list.some((c) => c.id === created.id));
  assert.strictEqual(list[0].credentialJson, undefined);
});

test('updateConnection changes fields, deleteConnection removes it', () => {
  const created = store.createConnection({ name: 'A', type: 'emulator', projectId: 'p', emulatorHost: 'h:1' });
  const updated = store.updateConnection(created.id, { name: 'B' });
  assert.strictEqual(updated.name, 'B');
  assert.strictEqual(updated.projectId, 'p');

  assert.strictEqual(store.deleteConnection(created.id), true);
  assert.strictEqual(store.getConnection(created.id), null);
});

test('seedDefaultIfEmpty only seeds when the table is empty', () => {
  const before = store.listConnections().length;
  store.seedDefaultIfEmpty({ projectId: 'seed-proj', emulatorHost: 'localhost:9999' });
  const after = store.listConnections().length;
  assert.strictEqual(after, before > 0 ? before : 1);
});
