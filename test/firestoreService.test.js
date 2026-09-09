const test = require('node:test');
const assert = require('node:assert');
const svc = require('../server/firestoreService');

const testCollection = `_studio_test_${Date.now()}`;

test.after(async () => {
  const docs = await svc.listDocuments(testCollection, { pageSize: 200 });
  for (const doc of docs) {
    await svc.deleteDocument(`${testCollection}/${doc.id}`);
  }
});

test('listCollections returns an array (root)', async () => {
  const collections = await svc.listCollections();
  assert.ok(Array.isArray(collections));
});

test('create, get, update, delete a document round-trip', async () => {
  const id = await svc.createDocument(testCollection, {
    id: 'doc1',
    data: {
      name: 'Ada',
      age: 30,
      createdAt: { __type: 'timestamp', value: '2026-01-01T00:00:00.000Z' },
    },
  });
  assert.strictEqual(id, 'doc1');

  const fetched = await svc.getDocument(`${testCollection}/doc1`);
  assert.strictEqual(fetched.id, 'doc1');
  assert.strictEqual(fetched.data.name, 'Ada');
  assert.strictEqual(fetched.data.age, 30);
  assert.strictEqual(fetched.data.createdAt.__type, 'timestamp');
  assert.deepStrictEqual(fetched.subcollections, []);

  await svc.updateDocument(`${testCollection}/doc1`, { name: 'Ada Lovelace' });
  const updated = await svc.getDocument(`${testCollection}/doc1`);
  assert.strictEqual(updated.data.name, 'Ada Lovelace');
  assert.strictEqual(updated.data.age, undefined); // full overwrite, not merge

  await svc.deleteDocument(`${testCollection}/doc1`);
  const gone = await svc.getDocument(`${testCollection}/doc1`);
  assert.strictEqual(gone, null);
});

test('GeoPoint round-trip', { skip: 'Known bug in the floci-gcp 0.8.0 emulator: geo_point_value is silently dropped on read (write succeeds, read returns null), reproduced independently of this code. Re-enable once the emulator is fixed/upgraded.' }, async () => {
  const id = await svc.createDocument(testCollection, {
    id: 'geodoc',
    data: { home: { __type: 'geopoint', lat: 1, lng: 2 } },
  });
  const fetched = await svc.getDocument(`${testCollection}/${id}`);
  assert.deepStrictEqual(fetched.data.home, { __type: 'geopoint', lat: 1, lng: 2 });
  await svc.deleteDocument(`${testCollection}/${id}`);
});

test('createDocument auto-generates an id when none is given', async () => {
  const id = await svc.createDocument(testCollection, { data: { name: 'Auto' } });
  assert.ok(id && id.length > 0);
  const fetched = await svc.getDocument(`${testCollection}/${id}`);
  assert.strictEqual(fetched.data.name, 'Auto');
  await svc.deleteDocument(`${testCollection}/${id}`);
});

test('queryDocuments filters, orders and limits', async () => {
  await svc.createDocument(testCollection, { id: 'q1', data: { color: 'red', n: 3 } });
  await svc.createDocument(testCollection, { id: 'q2', data: { color: 'blue', n: 1 } });
  await svc.createDocument(testCollection, { id: 'q3', data: { color: 'red', n: 2 } });

  const filtered = await svc.queryDocuments(testCollection, {
    wheres: [{ field: 'color', op: '==', value: 'red' }],
    orderBy: { field: 'n', dir: 'asc' },
  });
  assert.deepStrictEqual(filtered.map((d) => d.id), ['q3', 'q1']);

  const limited = await svc.queryDocuments(testCollection, {
    wheres: [{ field: 'color', op: '==', value: 'red' }],
    limit: 1,
  });
  assert.strictEqual(limited.length, 1);
});

test('listDocuments paginates with cursorDocId', async () => {
  await svc.createDocument(testCollection, { id: 'p1', data: { n: 1 } });
  await svc.createDocument(testCollection, { id: 'p2', data: { n: 2 } });
  await svc.createDocument(testCollection, { id: 'p3', data: { n: 3 } });

  const page1 = await svc.listDocuments(testCollection, { pageSize: 2 });
  assert.strictEqual(page1.length, 2);

  const page2 = await svc.listDocuments(testCollection, { pageSize: 2, cursorDocId: page1[1].id });
  assert.ok(page2.length >= 1);
  assert.notStrictEqual(page2[0].id, page1[0].id);
  assert.notStrictEqual(page2[0].id, page1[1].id);
});
