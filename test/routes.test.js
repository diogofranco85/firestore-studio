const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const app = require('../server/app');
const svc = require('../server/firestoreService');

const testCollection = `_studio_test_routes_${Date.now()}`;

function withServer(fn) {
  return async () => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const base = `http://localhost:${server.address().port}`;
    try {
      await fn(base);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

test.after(async () => {
  const docs = await svc.listDocuments(testCollection, { pageSize: 200 });
  for (const doc of docs) await svc.deleteDocument(`${testCollection}/${doc.id}`);
});

test('GET /api/collections returns 200 and a list', withServer(async (base) => {
  const res = await fetch(`${base}/api/collections`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.collections));
}));

test('full document lifecycle through the REST API', withServer(async (base) => {
  const createRes = await fetch(`${base}/api/document/${testCollection}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'doc1', data: { name: 'Grace' } }),
  });
  assert.strictEqual(createRes.status, 201);
  const created = await createRes.json();
  assert.strictEqual(created.id, 'doc1');

  const getRes = await fetch(`${base}/api/document/${testCollection}/doc1`);
  assert.strictEqual(getRes.status, 200);
  const got = await getRes.json();
  assert.strictEqual(got.data.name, 'Grace');

  const putRes = await fetch(`${base}/api/document/${testCollection}/doc1`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { name: 'Grace Hopper' } }),
  });
  assert.strictEqual(putRes.status, 200);

  const listRes = await fetch(`${base}/api/documents/${testCollection}`);
  const list = await listRes.json();
  assert.strictEqual(list.documents.find((d) => d.id === 'doc1').data.name, 'Grace Hopper');

  const delRes = await fetch(`${base}/api/document/${testCollection}/doc1`, { method: 'DELETE' });
  assert.strictEqual(delRes.status, 200);

  const goneRes = await fetch(`${base}/api/document/${testCollection}/doc1`);
  assert.strictEqual(goneRes.status, 404);
}));

test('POST without a data object returns 400', withServer(async (base) => {
  const res = await fetch(`${base}/api/document/${testCollection}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'bad' }),
  });
  assert.strictEqual(res.status, 400);
}));

test('malformed JSON body returns a JSON error, not HTML', withServer(async (base) => {
  const res = await fetch(`${base}/api/document/${testCollection}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not valid json',
  });
  assert.strictEqual(res.status, 400);
  const body = await res.json();
  assert.ok(typeof body.error === 'string' && body.error.length > 0);
}));
