const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const dbPath = path.join(__dirname, '.tmp-routes.db');
process.env.CONNECTIONS_DB_PATH = dbPath;
test.after(() => fs.rmSync(dbPath, { force: true }));

const app = require('../server/app');
const config = require('../server/config');

let server;
let base;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});
test.after(() => server.close());

test('cria conexão, lista coleções e documentos por ela', async () => {
  const createRes = await fetch(`${base}/api/connections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Rota Teste',
      type: 'emulator',
      projectId: config.projectId,
      emulatorHost: config.emulatorHost,
    }),
  });
  assert.strictEqual(createRes.status, 201);
  const conn = await createRes.json();
  assert.ok(conn.id);
  assert.strictEqual(conn.credentialJson, undefined);

  const listRes = await fetch(`${base}/api/connections`);
  const { connections } = await listRes.json();
  assert.ok(connections.some((c) => c.id === conn.id));

  const collectionsRes = await fetch(`${base}/api/connections/${conn.id}/collections`);
  assert.strictEqual(collectionsRes.status, 200);
  const { collections } = await collectionsRes.json();
  assert.ok(Array.isArray(collections));

  const delRes = await fetch(`${base}/api/connections/${conn.id}`, { method: 'DELETE' });
  assert.strictEqual(delRes.status, 200);
});

test('rota de dados com connId inexistente retorna 404', async () => {
  const res = await fetch(`${base}/api/connections/nao-existe/collections`);
  assert.strictEqual(res.status, 404);
});
