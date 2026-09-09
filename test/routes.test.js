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

async function createTestConnection() {
  const res = await fetch(`${base}/api/connections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Rota Teste Docs',
      type: 'emulator',
      projectId: config.projectId,
      emulatorHost: config.emulatorHost,
    }),
  });
  return res.json();
}

test('ciclo completo de documento via rotas connId-scoped', async () => {
  const conn = await createTestConnection();
  const collection = 'route-test-docs';
  try {
    const createRes = await fetch(`${base}/api/connections/${conn.id}/document/${collection}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { foo: 'bar' } }),
    });
    assert.strictEqual(createRes.status, 201);
    const { id } = await createRes.json();
    assert.ok(id);

    const getRes = await fetch(`${base}/api/connections/${conn.id}/document/${collection}/${id}`);
    assert.strictEqual(getRes.status, 200);
    const doc = await getRes.json();
    assert.deepStrictEqual(doc.data, { foo: 'bar' });

    const listRes = await fetch(`${base}/api/connections/${conn.id}/documents/${collection}`);
    assert.strictEqual(listRes.status, 200);
    const { documents } = await listRes.json();
    assert.ok(documents.some((d) => d.id === id));

    const delRes = await fetch(`${base}/api/connections/${conn.id}/document/${collection}/${id}`, { method: 'DELETE' });
    assert.strictEqual(delRes.status, 200);

    const getAfterDelRes = await fetch(`${base}/api/connections/${conn.id}/document/${collection}/${id}`);
    assert.strictEqual(getAfterDelRes.status, 404);
  } finally {
    await fetch(`${base}/api/connections/${conn.id}`, { method: 'DELETE' });
  }
});

test('POST de documento sem data retorna 400', async () => {
  const conn = await createTestConnection();
  try {
    const res = await fetch(`${base}/api/connections/${conn.id}/document/route-test-docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    await fetch(`${base}/api/connections/${conn.id}`, { method: 'DELETE' });
  }
});

test('importação em lote cria documentos com id explícito e auto-gerado', async () => {
  const conn = await createTestConnection();
  const collection = 'route-test-import';
  try {
    const res = await fetch(`${base}/api/connections/${conn.id}/import/${collection}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documents: [{ id: 'fixo', data: { foo: 'bar' } }, { data: { foo: 'baz' } }] }),
    });
    assert.strictEqual(res.status, 201);
    const { imported, errors } = await res.json();
    assert.strictEqual(imported, 2);
    assert.deepStrictEqual(errors, []);

    const getRes = await fetch(`${base}/api/connections/${conn.id}/document/${collection}/fixo`);
    assert.strictEqual(getRes.status, 200);
    assert.deepStrictEqual((await getRes.json()).data, { foo: 'bar' });
  } finally {
    await fetch(`${base}/api/connections/${conn.id}`, { method: 'DELETE' });
  }
});

test('corpo JSON malformado retorna erro em JSON, não HTML', async () => {
  const conn = await createTestConnection();
  try {
    const res = await fetch(`${base}/api/connections/${conn.id}/document/route-test-docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid',
    });
    assert.ok(res.status >= 400 && res.status < 500);
    assert.match(res.headers.get('content-type') || '', /application\/json/);
  } finally {
    await fetch(`${base}/api/connections/${conn.id}`, { method: 'DELETE' });
  }
});
