# Firestore Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local web app that browses and edits data in a running Firestore emulator (project `floci-gcp`, emulator at `localhost:4588`), with full CRUD, similar in spirit to Prisma Studio.

**Architecture:** A single Node.js project. `server/` is an Express app (using `firebase-admin` pointed at the emulator) that serves a REST API and the static frontend. `public/` is a vanilla HTML/CSS/JS frontend (no build step, no framework) that renders a collection tree, a document table, and a type-aware document editor.

**Tech Stack:** Node.js (v18+), Express 4, firebase-admin, dotenv, Node's built-in test runner (`node --test`). No frontend framework, no bundler.

**Spec:** `docs/superpowers/specs/2026-09-09-firestore-studio-design.md`

## Global Constraints

- Emulator connection: `FIRESTORE_EMULATOR_HOST=localhost:4588`, `FIRESTORE_PROJECT_ID=floci-gcp` (both overridable via `.env`, these are the defaults).
- Server port default: `4001` (overridable via `.env` `PORT`).
- Firestore special types (Timestamp, GeoPoint, DocumentReference, Bytes) are serialized on the wire as `{ "__type": "<type>", ...fields }`; see spec's "Type serialization" table for the exact shape of each.
- Documents are listed ordered by document ID, paginated with `startAfter`, default page size 50.
- `PUT` on a document always fully overwrites it (`set`, not merge) — the editor always submits the complete document.
- All API errors return `{ "error": "<message>" }` with status 400 (bad input), 404 (not found), 503 (emulator unreachable), or 500 (unexpected).
- No frontend framework or bundler — plain `<script>`, `fetch`, DOM APIs only.

---

### Task 1: Project scaffolding & config

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `server/config.js`
- Test: `test/config.test.js`

**Interfaces:**
- Produces: `server/config.js` exports `{ projectId: string, emulatorHost: string, port: number }`, read from `FIRESTORE_PROJECT_ID`, `FIRESTORE_EMULATOR_HOST`, `PORT` env vars with defaults `'floci-gcp'`, `'localhost:4588'`, `4001`.

- [ ] **Step 1: Create scaffolding files**

`package.json`:
```json
{
  "name": "firestore-studio",
  "version": "0.1.0",
  "private": true,
  "description": "Local data browser/editor for the Firestore emulator",
  "main": "server/start.js",
  "scripts": {
    "start": "node server/start.js",
    "test": "node --test"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "firebase-admin": "^12.6.0"
  }
}
```

`.gitignore`:
```
node_modules/
.env
```

`.env.example`:
```
FIRESTORE_PROJECT_ID=floci-gcp
FIRESTORE_EMULATOR_HOST=localhost:4588
PORT=4001
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` written, no errors.

- [ ] **Step 3: Write the failing test**

`test/config.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert');

test('uses default values when env vars are not set', () => {
  delete process.env.FIRESTORE_PROJECT_ID;
  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.PORT;
  delete require.cache[require.resolve('../server/config')];
  const config = require('../server/config');
  assert.strictEqual(config.projectId, 'floci-gcp');
  assert.strictEqual(config.emulatorHost, 'localhost:4588');
  assert.strictEqual(config.port, 4001);
});

test('uses env vars when set', () => {
  process.env.FIRESTORE_PROJECT_ID = 'other-project';
  process.env.FIRESTORE_EMULATOR_HOST = 'localhost:9999';
  process.env.PORT = '5000';
  delete require.cache[require.resolve('../server/config')];
  const config = require('../server/config');
  assert.strictEqual(config.projectId, 'other-project');
  assert.strictEqual(config.emulatorHost, 'localhost:9999');
  assert.strictEqual(config.port, 5000);
  delete process.env.FIRESTORE_PROJECT_ID;
  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.PORT;
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test test/config.test.js`
Expected: FAIL — `Cannot find module '../server/config'`

- [ ] **Step 5: Write minimal implementation**

`server/config.js`:
```js
require('dotenv').config();

const config = {
  projectId: process.env.FIRESTORE_PROJECT_ID || 'floci-gcp',
  emulatorHost: process.env.FIRESTORE_EMULATOR_HOST || 'localhost:4588',
  port: parseInt(process.env.PORT, 10) || 4001,
};

module.exports = config;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/config.test.js`
Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example server/config.js test/config.test.js
git commit -m "Scaffold project and add config loader"
```

---

### Task 2: Firestore client + type serialization

**Files:**
- Create: `server/firestoreClient.js`
- Create: `server/serialize.js`
- Test: `test/serialize.test.js`

**Interfaces:**
- Consumes: `server/config.js` → `{ projectId, emulatorHost, port }` (Task 1).
- Produces: `server/firestoreClient.js` exports `{ db }`, a `firebase-admin` `Firestore` instance connected to the emulator. `server/serialize.js` exports `{ toWire(value), fromWire(value) }` — `toWire` converts a Firestore document-data value (possibly containing `Timestamp`/`GeoPoint`/`DocumentReference`/`Buffer`, nested in maps/arrays) into plain JSON-safe data using the `{ __type, ... }` tagging from the spec; `fromWire` reverses it.

- [ ] **Step 1: Write the Firestore client**

`server/firestoreClient.js`:
```js
const admin = require('firebase-admin');
const config = require('./config');

process.env.FIRESTORE_EMULATOR_HOST = config.emulatorHost;

const app = admin.initializeApp({ projectId: config.projectId });
const db = admin.firestore(app);

module.exports = { db };
```

- [ ] **Step 2: Write the failing test**

`test/serialize.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert');
const { Timestamp, GeoPoint } = require('firebase-admin/firestore');
const { db } = require('../server/firestoreClient');
const { toWire, fromWire } = require('../server/serialize');

test('toWire converts primitives unchanged', () => {
  assert.strictEqual(toWire('hello'), 'hello');
  assert.strictEqual(toWire(42), 42);
  assert.strictEqual(toWire(true), true);
  assert.strictEqual(toWire(null), null);
});

test('toWire/fromWire round-trip a Timestamp', () => {
  const date = new Date('2026-01-15T10:30:00.000Z');
  const ts = Timestamp.fromDate(date);
  const wire = toWire(ts);
  assert.strictEqual(wire.__type, 'timestamp');
  assert.strictEqual(wire.value, date.toISOString());
  const back = fromWire(wire);
  assert.ok(back instanceof Timestamp);
  assert.strictEqual(back.toDate().toISOString(), date.toISOString());
});

test('toWire/fromWire round-trip a GeoPoint', () => {
  const gp = new GeoPoint(-23.55, -46.63);
  const wire = toWire(gp);
  assert.deepStrictEqual(wire, { __type: 'geopoint', lat: -23.55, lng: -46.63 });
  const back = fromWire(wire);
  assert.ok(back instanceof GeoPoint);
  assert.strictEqual(back.latitude, -23.55);
  assert.strictEqual(back.longitude, -46.63);
});

test('toWire/fromWire round-trip a DocumentReference', () => {
  const ref = db.doc('users/abc123');
  const wire = toWire(ref);
  assert.deepStrictEqual(wire, { __type: 'reference', path: 'users/abc123' });
  const back = fromWire(wire);
  assert.strictEqual(back.path, 'users/abc123');
});

test('toWire/fromWire round-trip nested maps and arrays', () => {
  const gp = new GeoPoint(1, 2);
  const input = { tags: ['a', 'b'], nested: { home: gp, count: 3 } };
  const wire = toWire(input);
  assert.deepStrictEqual(wire, {
    tags: ['a', 'b'],
    nested: { home: { __type: 'geopoint', lat: 1, lng: 2 }, count: 3 },
  });
  const back = fromWire(wire);
  assert.deepStrictEqual(back.tags, ['a', 'b']);
  assert.ok(back.nested.home instanceof GeoPoint);
  assert.strictEqual(back.nested.count, 3);
});

test('toWire/fromWire round-trip Buffer as bytes', () => {
  const buf = Buffer.from('hello', 'utf8');
  const wire = toWire(buf);
  assert.strictEqual(wire.__type, 'bytes');
  assert.strictEqual(wire.base64, buf.toString('base64'));
  const back = fromWire(wire);
  assert.ok(Buffer.isBuffer(back));
  assert.strictEqual(back.toString('utf8'), 'hello');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/serialize.test.js`
Expected: FAIL — `Cannot find module '../server/serialize'`

- [ ] **Step 4: Write minimal implementation**

`server/serialize.js`:
```js
const { Timestamp, GeoPoint, DocumentReference } = require('firebase-admin/firestore');
const { db } = require('./firestoreClient');

function toWire(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Timestamp) {
    return { __type: 'timestamp', value: value.toDate().toISOString() };
  }
  if (value instanceof GeoPoint) {
    return { __type: 'geopoint', lat: value.latitude, lng: value.longitude };
  }
  if (value instanceof DocumentReference) {
    return { __type: 'reference', path: value.path };
  }
  if (Buffer.isBuffer(value)) {
    return { __type: 'bytes', base64: value.toString('base64') };
  }
  if (Array.isArray(value)) {
    return value.map(toWire);
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) out[key] = toWire(val);
    return out;
  }
  return value;
}

function fromWire(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(fromWire);
  if (typeof value === 'object') {
    if (value.__type === 'timestamp') return Timestamp.fromDate(new Date(value.value));
    if (value.__type === 'geopoint') return new GeoPoint(value.lat, value.lng);
    if (value.__type === 'reference') return db.doc(value.path);
    if (value.__type === 'bytes') return Buffer.from(value.base64, 'base64');
    const out = {};
    for (const [key, val] of Object.entries(value)) out[key] = fromWire(val);
    return out;
  }
  return value;
}

module.exports = { toWire, fromWire };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/serialize.test.js`
Expected: PASS (6 tests). This does not require the emulator to be reachable — no network calls are made.

- [ ] **Step 6: Commit**

```bash
git add server/firestoreClient.js server/serialize.js test/serialize.test.js
git commit -m "Add Firestore client and type-tagged wire serialization"
```

---

### Task 3: Firestore CRUD service

**Files:**
- Create: `server/firestoreService.js`
- Test: `test/firestoreService.test.js`

**Interfaces:**
- Consumes: `server/firestoreClient.js` → `{ db }` (Task 2); `server/serialize.js` → `{ toWire, fromWire }` (Task 2).
- Produces: `server/firestoreService.js` exports:
  - `listCollections(parentPath?: string): Promise<string[]>`
  - `listDocuments(collectionPath: string, opts?: { pageSize?: number, cursorDocId?: string }): Promise<Array<{ id: string, data: object }>>`
  - `getDocument(docPath: string): Promise<{ id: string, data: object, subcollections: string[] } | null>`
  - `createDocument(collectionPath: string, opts: { id?: string, data: object }): Promise<string>` (returns the new doc's id)
  - `updateDocument(docPath: string, data: object): Promise<void>`
  - `deleteDocument(docPath: string): Promise<void>`

**Note:** the tests in this task run against the real Firestore emulator (`localhost:4588`, project `floci-gcp`) — it must be running. They operate under a collection uniquely prefixed with `_studio_test_` and delete everything they create afterward, so they don't disturb real data.

- [ ] **Step 1: Write the failing test**

`test/firestoreService.test.js`:
```js
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
      home: { __type: 'geopoint', lat: 1, lng: 2 },
    },
  });
  assert.strictEqual(id, 'doc1');

  const fetched = await svc.getDocument(`${testCollection}/doc1`);
  assert.strictEqual(fetched.id, 'doc1');
  assert.strictEqual(fetched.data.name, 'Ada');
  assert.strictEqual(fetched.data.age, 30);
  assert.strictEqual(fetched.data.createdAt.__type, 'timestamp');
  assert.deepStrictEqual(fetched.data.home, { __type: 'geopoint', lat: 1, lng: 2 });
  assert.deepStrictEqual(fetched.subcollections, []);

  await svc.updateDocument(`${testCollection}/doc1`, { name: 'Ada Lovelace' });
  const updated = await svc.getDocument(`${testCollection}/doc1`);
  assert.strictEqual(updated.data.name, 'Ada Lovelace');
  assert.strictEqual(updated.data.age, undefined); // full overwrite, not merge

  await svc.deleteDocument(`${testCollection}/doc1`);
  const gone = await svc.getDocument(`${testCollection}/doc1`);
  assert.strictEqual(gone, null);
});

test('createDocument auto-generates an id when none is given', async () => {
  const id = await svc.createDocument(testCollection, { data: { name: 'Auto' } });
  assert.ok(id && id.length > 0);
  const fetched = await svc.getDocument(`${testCollection}/${id}`);
  assert.strictEqual(fetched.data.name, 'Auto');
  await svc.deleteDocument(`${testCollection}/${id}`);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/firestoreService.test.js`
Expected: FAIL — `Cannot find module '../server/firestoreService'`

- [ ] **Step 3: Write minimal implementation**

`server/firestoreService.js`:
```js
const { FieldPath } = require('firebase-admin/firestore');
const { db } = require('./firestoreClient');
const { toWire, fromWire } = require('./serialize');

async function listCollections(parentPath) {
  const ref = parentPath ? db.doc(parentPath) : db;
  const collections = await ref.listCollections();
  return collections.map((c) => c.id);
}

async function listDocuments(collectionPath, { pageSize = 50, cursorDocId } = {}) {
  let query = db.collection(collectionPath).orderBy(FieldPath.documentId()).limit(pageSize);
  if (cursorDocId) {
    const cursorSnap = await db.collection(collectionPath).doc(cursorDocId).get();
    query = query.startAfter(cursorSnap);
  }
  const snapshot = await query.get();
  return snapshot.docs.map((doc) => ({ id: doc.id, data: toWire(doc.data()) }));
}

async function getDocument(docPath) {
  const snap = await db.doc(docPath).get();
  if (!snap.exists) return null;
  const subcollections = await snap.ref.listCollections();
  return {
    id: snap.id,
    data: toWire(snap.data()),
    subcollections: subcollections.map((c) => c.id),
  };
}

async function createDocument(collectionPath, { id, data }) {
  const converted = fromWire(data);
  const colRef = db.collection(collectionPath);
  const docRef = id ? colRef.doc(id) : colRef.doc();
  await docRef.set(converted);
  return docRef.id;
}

async function updateDocument(docPath, data) {
  const converted = fromWire(data);
  await db.doc(docPath).set(converted);
}

async function deleteDocument(docPath) {
  await db.doc(docPath).delete();
}

module.exports = {
  listCollections,
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/firestoreService.test.js`
Expected: PASS (4 tests). Requires the Firestore emulator to be reachable at `localhost:4588`. If it fails with a connection error, start the emulator first.

- [ ] **Step 5: Commit**

```bash
git add server/firestoreService.js test/firestoreService.test.js
git commit -m "Add Firestore CRUD service"
```

---

### Task 4: REST API and app wiring

**Files:**
- Create: `server/routes.js`
- Create: `server/app.js`
- Create: `server/start.js`
- Test: `test/routes.test.js`

**Interfaces:**
- Consumes: `server/firestoreService.js` (Task 3) — all six functions.
- Produces: `server/app.js` exports a configured Express `app` (no `listen()` call — importable for tests). `server/start.js` is the process entry point (`npm start` runs it): checks emulator connectivity, then calls `app.listen(config.port)`.
- REST surface (all under `/api`): `GET /collections`, `GET /collections/*`, `GET /documents/*`, `GET /document/*`, `POST /document/*`, `PUT /document/*`, `DELETE /document/*` — `*` is a `/`-joined path (collection or document path), matching the spec's routing table.

- [ ] **Step 1: Write the failing test**

`test/routes.test.js`:
```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/routes.test.js`
Expected: FAIL — `Cannot find module '../server/app'`

- [ ] **Step 3: Write the routes**

`server/routes.js`:
```js
const express = require('express');
const svc = require('./firestoreService');

const router = express.Router();

function handleError(err, res) {
  if (/ECONNREFUSED/.test(err.message)) {
    return res.status(503).json({ error: 'Não foi possível conectar ao emulador do Firestore.' });
  }
  res.status(500).json({ error: err.message });
}

router.get('/collections', async (req, res) => {
  try {
    res.json({ collections: await svc.listCollections() });
  } catch (err) {
    handleError(err, res);
  }
});

router.get('/collections/*', async (req, res) => {
  try {
    res.json({ collections: await svc.listCollections(req.params[0]) });
  } catch (err) {
    handleError(err, res);
  }
});

router.get('/documents/*', async (req, res) => {
  try {
    const pageSize = parseInt(req.query.pageSize, 10) || 50;
    const cursorDocId = req.query.cursor || undefined;
    const documents = await svc.listDocuments(req.params[0], { pageSize, cursorDocId });
    res.json({ documents });
  } catch (err) {
    handleError(err, res);
  }
});

router.get('/document/*', async (req, res) => {
  try {
    const document = await svc.getDocument(req.params[0]);
    if (!document) return res.status(404).json({ error: 'Document not found' });
    res.json(document);
  } catch (err) {
    handleError(err, res);
  }
});

router.post('/document/*', async (req, res) => {
  try {
    const { id, data } = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Missing data object' });
    }
    const newId = await svc.createDocument(req.params[0], { id, data });
    res.status(201).json({ id: newId });
  } catch (err) {
    handleError(err, res);
  }
});

router.put('/document/*', async (req, res) => {
  try {
    const { data } = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Missing data object' });
    }
    await svc.updateDocument(req.params[0], data);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

router.delete('/document/*', async (req, res) => {
  try {
    await svc.deleteDocument(req.params[0]);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

module.exports = router;
```

- [ ] **Step 4: Write the app**

`server/app.js`:
```js
const express = require('express');
const path = require('node:path');
const routes = require('./routes');

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(express.static(path.join(__dirname, '..', 'public')));

module.exports = app;
```

- [ ] **Step 5: Write the entry point**

`server/start.js`:
```js
const config = require('./config');
const app = require('./app');
const { db } = require('./firestoreClient');

async function start() {
  try {
    await db.listCollections();
  } catch (err) {
    console.error(
      `Não foi possível conectar ao emulador do Firestore em ${config.emulatorHost}: ${err.message}`
    );
  }
  app.listen(config.port, () => {
    console.log(`Firestore Studio rodando em http://localhost:${config.port}`);
  });
}

start();
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/routes.test.js`
Expected: PASS (3 tests). Requires the emulator running at `localhost:4588`.

- [ ] **Step 7: Manual smoke check**

Run: `npm start`
Expected: prints `Firestore Studio rodando em http://localhost:4001`.

In another terminal: `curl -s http://localhost:4001/api/collections`
Expected: `{"collections":[...]}` (200 OK).

Stop the server with Ctrl+C.

- [ ] **Step 8: Commit**

```bash
git add server/routes.js server/app.js server/start.js test/routes.test.js
git commit -m "Add REST API and app entry point"
```

---

### Task 5: Frontend shell and collection tree

**Files:**
- Create: `public/index.html`
- Create: `public/style.css`
- Create: `public/app.js`

**Interfaces:**
- Consumes: `GET /api/collections`, `GET /api/collections/*`, `GET /api/documents/*`, `GET /api/document/*` (Task 4).
- Produces: global `state` object and `api` helper in `public/app.js`, reused and extended by Tasks 6 and 7. DOM ids defined in `index.html` (`sidebar`, `collection-tree`, `banner`, `current-path`, `add-doc-btn`, `doc-table`, `prev-page-btn`, `next-page-btn`, `editor-panel`, `editor-title`, `editor-fields`, `editor-close-btn`, `save-doc-btn`, `delete-doc-btn`) are the contract the later tasks' JS attaches to.

- [ ] **Step 1: Write the HTML shell**

`public/index.html`:
```html
<!doctype html>
<html lang="pt-br">
<head>
  <meta charset="utf-8" />
  <title>Firestore Studio</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div id="app">
    <aside id="sidebar">
      <h2>Collections</h2>
      <ul id="collection-tree"></ul>
    </aside>
    <main id="content">
      <div id="banner" class="banner" hidden></div>
      <div id="table-panel">
        <div id="table-toolbar">
          <span id="current-path"></span>
          <button id="add-doc-btn" disabled>+ Novo documento</button>
        </div>
        <table id="doc-table"><thead></thead><tbody></tbody></table>
        <div id="pagination">
          <button id="prev-page-btn" disabled>Anterior</button>
          <button id="next-page-btn" disabled>Próxima</button>
        </div>
      </div>
      <div id="editor-panel" hidden>
        <div id="editor-header">
          <span id="editor-title"></span>
          <button id="editor-close-btn">×</button>
        </div>
        <div id="editor-fields"></div>
        <div id="editor-actions">
          <button id="save-doc-btn">Salvar</button>
          <button id="delete-doc-btn">Apagar</button>
        </div>
      </div>
    </main>
  </div>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write the stylesheet**

`public/style.css`:
```css
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; color: #1a1a1a; background: #fafafa; }
#app { display: flex; height: 100vh; }

#sidebar { width: 260px; overflow-y: auto; border-right: 1px solid #ddd; padding: 12px; background: #fff; }
#sidebar h2 { font-size: 14px; text-transform: uppercase; color: #666; margin: 0 0 8px; }
#collection-tree, .tree-children { list-style: none; margin: 0; padding-left: 14px; }
#collection-tree { padding-left: 0; }
.tree-row { display: flex; align-items: center; gap: 4px; padding: 2px 0; }
.expand-btn { width: 18px; height: 18px; border: 1px solid #ccc; background: #fff; cursor: pointer; font-size: 11px; line-height: 1; }
.tree-label { cursor: pointer; }
.tree-label:hover { text-decoration: underline; }
.doc-label { color: #555; font-size: 13px; }

#content { flex: 1; display: flex; flex-direction: column; padding: 16px; overflow: hidden; }
.banner { background: #fdecea; color: #9c1c0c; border: 1px solid #f5c2bb; padding: 8px 12px; margin-bottom: 12px; border-radius: 4px; }

#table-panel { flex: 1; display: flex; flex-direction: column; overflow: auto; }
#table-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
#doc-table { border-collapse: collapse; width: 100%; }
#doc-table th, #doc-table td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; font-size: 13px; white-space: nowrap; }
#doc-table tbody tr { cursor: pointer; }
#doc-table tbody tr:hover { background: #f0f4ff; }
#pagination { margin-top: 8px; display: flex; gap: 8px; }

#editor-panel { position: fixed; right: 0; top: 0; bottom: 0; width: 420px; background: #fff; border-left: 1px solid #ddd; padding: 16px; overflow-y: auto; box-shadow: -2px 0 8px rgba(0,0,0,0.08); }
#editor-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.field-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
.field-key { width: 120px; }
.field-type { width: 100px; }
.field-value { flex: 1; display: flex; gap: 4px; }
.value-input { flex: 1; }
.json-input { width: 100%; min-height: 80px; font-family: monospace; }
#editor-actions { display: flex; gap: 8px; margin-top: 12px; }
#delete-doc-btn { background: #d93025; color: #fff; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; }
#save-doc-btn { background: #1a73e8; color: #fff; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; }
```

- [ ] **Step 3: Write the sidebar logic**

`public/app.js`:
```js
const state = {
  currentPath: null,
  documents: [],
  pageSize: 50,
  cursorStack: [],
  editingDoc: null,
};

const api = {
  async get(path) {
    const res = await fetch(path);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Erro ${res.status}`);
    return body;
  },
  async send(method, path, payload) {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Erro ${res.status}`);
    return body;
  },
};

function encodeURIComponentPath(pathStr) {
  return pathStr.split('/').map(encodeURIComponent).join('/');
}

function showBanner(message) {
  const banner = document.getElementById('banner');
  banner.textContent = message;
  banner.hidden = false;
}

function hideBanner() {
  document.getElementById('banner').hidden = true;
}

async function loadRootCollections() {
  try {
    const { collections } = await api.get('/api/collections');
    const tree = document.getElementById('collection-tree');
    tree.innerHTML = '';
    collections.forEach((name) => tree.appendChild(buildCollectionNode(name, name)));
    hideBanner();
  } catch (err) {
    showBanner(`Não foi possível conectar ao emulador: ${err.message}`);
  }
}

function buildCollectionNode(path, label) {
  const li = document.createElement('li');
  li.className = 'tree-node';

  const row = document.createElement('div');
  row.className = 'tree-row';

  const expandBtn = document.createElement('button');
  expandBtn.className = 'expand-btn';
  expandBtn.textContent = '+';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'tree-label';
  nameSpan.textContent = label;
  nameSpan.addEventListener('click', () => selectCollection(path));

  row.appendChild(expandBtn);
  row.appendChild(nameSpan);
  li.appendChild(row);

  const childList = document.createElement('ul');
  childList.className = 'tree-children';
  childList.hidden = true;
  li.appendChild(childList);

  let loaded = false;
  expandBtn.addEventListener('click', async () => {
    if (!loaded) {
      try {
        const { documents } = await api.get(`/api/documents/${encodeURIComponentPath(path)}?pageSize=200`);
        childList.innerHTML = '';
        documents.forEach((doc) => {
          childList.appendChild(buildDocumentNode(`${path}/${doc.id}`, doc.id));
        });
        loaded = true;
      } catch (err) {
        showBanner(`Erro ao expandir ${path}: ${err.message}`);
        return;
      }
    }
    childList.hidden = !childList.hidden;
    expandBtn.textContent = childList.hidden ? '+' : '-';
  });

  return li;
}

function buildDocumentNode(docPath, label) {
  const li = document.createElement('li');
  li.className = 'tree-node doc-node';

  const row = document.createElement('div');
  row.className = 'tree-row';

  const expandBtn = document.createElement('button');
  expandBtn.className = 'expand-btn';
  expandBtn.textContent = '+';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'tree-label doc-label';
  nameSpan.textContent = label;

  row.appendChild(expandBtn);
  row.appendChild(nameSpan);
  li.appendChild(row);

  const childList = document.createElement('ul');
  childList.className = 'tree-children';
  childList.hidden = true;
  li.appendChild(childList);

  let loaded = false;
  expandBtn.addEventListener('click', async () => {
    if (!loaded) {
      try {
        const { subcollections } = await api.get(`/api/document/${encodeURIComponentPath(docPath)}`);
        childList.innerHTML = '';
        subcollections.forEach((name) => {
          childList.appendChild(buildCollectionNode(`${docPath}/${name}`, name));
        });
        loaded = true;
      } catch (err) {
        showBanner(`Erro ao expandir ${docPath}: ${err.message}`);
        return;
      }
    }
    childList.hidden = !childList.hidden;
    expandBtn.textContent = childList.hidden ? '+' : '-';
  });

  return li;
}

document.addEventListener('DOMContentLoaded', () => {
  loadRootCollections();
});
```

Note: this file references `selectCollection`, which is defined in Task 6. That's expected — the sidebar's "click label" action only becomes functional once Task 6 lands; expand/collapse (tested below) doesn't depend on it.

- [ ] **Step 4: Manual verification**

Seed a sample collection using the service directly:
```bash
node -e "
const svc = require('./server/firestoreService');
(async () => {
  await svc.createDocument('studio_smoke', { id: 'doc1', data: { name: 'Ada' } });
  await svc.createDocument('studio_smoke', { id: 'doc2', data: { name: 'Bob' } });
  console.log('seeded');
  process.exit(0);
})();
"
```
Expected: `seeded` printed.

Run `npm start`, open `http://localhost:4001` in a browser (or drive it with the `claude-in-chrome` skill if testing headlessly). Expected: sidebar shows a `studio_smoke` entry; clicking its `+` button lists `doc1` and `doc2` underneath. Stop the server with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/style.css public/app.js
git commit -m "Add frontend shell and collection tree sidebar"
```

---

### Task 6: Document table and pagination

**Files:**
- Modify: `public/app.js` (append)

**Interfaces:**
- Consumes: `state`, `api`, `encodeURIComponentPath`, `showBanner`, `hideBanner` (Task 5).
- Produces: `selectCollection(path, cursorDocId?)` — called by the sidebar (Task 5) and by Task 7 after save/delete to refresh the table.

- [ ] **Step 1: Append table rendering and pagination logic**

Append to `public/app.js`:
```js

async function selectCollection(path, cursorDocId) {
  if (path !== state.currentPath) {
    state.cursorStack = [];
    cursorDocId = undefined;
  }
  try {
    const query = cursorDocId
      ? `?pageSize=${state.pageSize}&cursor=${encodeURIComponent(cursorDocId)}`
      : `?pageSize=${state.pageSize}`;
    const { documents } = await api.get(`/api/documents/${encodeURIComponentPath(path)}${query}`);
    state.currentPath = path;
    state.documents = documents;
    document.getElementById('current-path').textContent = path;
    document.getElementById('add-doc-btn').disabled = false;
    renderTable(documents);
    document.getElementById('prev-page-btn').disabled = state.cursorStack.length === 0;
    document.getElementById('next-page-btn').disabled = documents.length < state.pageSize;
    hideBanner();
  } catch (err) {
    showBanner(`Erro ao carregar ${path}: ${err.message}`);
  }
}

function renderTable(documents) {
  const thead = document.querySelector('#doc-table thead');
  const tbody = document.querySelector('#doc-table tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  const fieldNames = new Set();
  documents.forEach((doc) => Object.keys(doc.data || {}).forEach((key) => fieldNames.add(key)));
  const columns = ['id', ...fieldNames];

  const headRow = document.createElement('tr');
  columns.forEach((col) => {
    const th = document.createElement('th');
    th.textContent = col;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  documents.forEach((doc) => {
    const row = document.createElement('tr');
    row.addEventListener('click', () => openEditorForExisting(state.currentPath, doc.id));
    columns.forEach((col) => {
      const td = document.createElement('td');
      td.textContent = col === 'id' ? doc.id : previewValue(doc.data[col]);
      row.appendChild(td);
    });
    tbody.appendChild(row);
  });
}

function previewValue(value) {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value === 'object' && value.__type) {
    if (value.__type === 'timestamp') return value.value;
    if (value.__type === 'geopoint') return `(${value.lat}, ${value.lng})`;
    if (value.__type === 'reference') return value.path;
    if (value.__type === 'bytes') return '<bytes>';
  }
  if (Array.isArray(value)) return `[${value.length} itens]`;
  if (typeof value === 'object') return '{...}';
  return String(value);
}

document.getElementById('next-page-btn').addEventListener('click', () => {
  const lastDoc = state.documents[state.documents.length - 1];
  if (!lastDoc) return;
  state.cursorStack.push(lastDoc.id);
  selectCollection(state.currentPath, lastDoc.id);
});

document.getElementById('prev-page-btn').addEventListener('click', () => {
  state.cursorStack.pop();
  const prevCursor = state.cursorStack[state.cursorStack.length - 1];
  selectCollection(state.currentPath, prevCursor);
});
```

Note: `openEditorForExisting` is defined in Task 7 — the table's row click becomes functional once that task lands.

- [ ] **Step 2: Manual verification**

Reuse the `studio_smoke` collection seeded in Task 5 (re-seed with the same script if it was cleaned up). Run `npm start`, open `http://localhost:4001`, click the `studio_smoke` label in the sidebar. Expected: the table shows two rows (`doc1`/Ada, `doc2`/Bob) with `id` and `name` columns; "Anterior" is disabled, "Próxima" is disabled (fewer than `pageSize` docs). Stop the server.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "Add document table and pagination"
```

---

### Task 7: Document editor (create, edit, delete)

**Files:**
- Modify: `public/app.js` (append)

**Interfaces:**
- Consumes: `state`, `api`, `encodeURIComponentPath`, `showBanner`, `selectCollection` (Tasks 5-6).
- Produces: `openEditorForExisting(collectionPath, docId)` (used by the table's row click, Task 6) and wires the `add-doc-btn`, `save-doc-btn`, `delete-doc-btn`, `editor-close-btn` buttons declared in `index.html` (Task 5).

- [ ] **Step 1: Append the editor logic**

Append to `public/app.js`:
```js

const TYPE_OPTIONS = ['string', 'number', 'boolean', 'null', 'timestamp', 'geopoint', 'reference', 'map/array'];

function openEditor(title, docId, collectionPath, data) {
  state.editingDoc = { collectionPath, id: docId, isNew: docId === null };
  document.getElementById('editor-title').textContent = title;
  document.getElementById('editor-panel').hidden = false;
  renderEditorFields(data || {});
  document.getElementById('delete-doc-btn').hidden = state.editingDoc.isNew;
}

async function openEditorForExisting(collectionPath, docId) {
  try {
    const doc = await api.get(`/api/document/${encodeURIComponentPath(`${collectionPath}/${docId}`)}`);
    openEditor(`${collectionPath}/${docId}`, docId, collectionPath, doc.data);
  } catch (err) {
    showBanner(`Erro ao abrir documento: ${err.message}`);
  }
}

function openEditorForNew(collectionPath) {
  openEditor(`Novo documento em ${collectionPath}`, null, collectionPath, {});
}

function detectType(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object' && value.__type) return value.__type;
  if (Array.isArray(value)) return 'map/array';
  if (typeof value === 'object') return 'map/array';
  return typeof value;
}

function renderEditorFields(data) {
  const container = document.getElementById('editor-fields');
  container.innerHTML = '';

  const idRow = document.createElement('div');
  idRow.className = 'field-row';
  const idLabel = document.createElement('label');
  idLabel.textContent = 'ID do documento';
  const idInput = document.createElement('input');
  idInput.id = 'field-doc-id';
  idInput.value = state.editingDoc.id || '';
  idInput.disabled = !state.editingDoc.isNew;
  idInput.placeholder = state.editingDoc.isNew ? '(auto-gerado se vazio)' : '';
  idRow.appendChild(idLabel);
  idRow.appendChild(idInput);
  container.appendChild(idRow);

  Object.entries(data).forEach(([key, value]) => container.appendChild(buildFieldRow(key, value)));

  const addFieldBtn = document.createElement('button');
  addFieldBtn.textContent = '+ Adicionar campo';
  addFieldBtn.id = 'add-field-btn';
  addFieldBtn.addEventListener('click', () => container.insertBefore(buildFieldRow('', ''), addFieldBtn));
  container.appendChild(addFieldBtn);
}

function buildFieldRow(key, value) {
  const row = document.createElement('div');
  row.className = 'field-row';
  row.dataset.type = detectType(value);

  const keyInput = document.createElement('input');
  keyInput.className = 'field-key';
  keyInput.value = key;
  keyInput.placeholder = 'nome do campo';

  const typeSelect = document.createElement('select');
  typeSelect.className = 'field-type';
  TYPE_OPTIONS.forEach((type) => {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = type;
    if (type === row.dataset.type) opt.selected = true;
    typeSelect.appendChild(opt);
  });

  const valueContainer = document.createElement('div');
  valueContainer.className = 'field-value';
  renderValueInput(valueContainer, row.dataset.type, value);

  typeSelect.addEventListener('change', () => {
    row.dataset.type = typeSelect.value;
    renderValueInput(valueContainer, typeSelect.value, defaultValueForType(typeSelect.value));
  });

  const removeBtn = document.createElement('button');
  removeBtn.textContent = '×';
  removeBtn.className = 'remove-field-btn';
  removeBtn.addEventListener('click', () => row.remove());

  row.appendChild(keyInput);
  row.appendChild(typeSelect);
  row.appendChild(valueContainer);
  row.appendChild(removeBtn);
  return row;
}

function defaultValueForType(type) {
  switch (type) {
    case 'string': return '';
    case 'number': return 0;
    case 'boolean': return false;
    case 'null': return null;
    case 'timestamp': return { __type: 'timestamp', value: new Date().toISOString() };
    case 'geopoint': return { __type: 'geopoint', lat: 0, lng: 0 };
    case 'reference': return { __type: 'reference', path: '' };
    case 'map/array': return {};
    default: return '';
  }
}

function renderValueInput(container, type, value) {
  container.innerHTML = '';
  if (type === 'string') {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'value-input';
    input.value = value ?? '';
    container.appendChild(input);
  } else if (type === 'number') {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'value-input';
    input.value = value ?? 0;
    container.appendChild(input);
  } else if (type === 'boolean') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'value-input';
    input.checked = Boolean(value);
    container.appendChild(input);
  } else if (type === 'null') {
    const span = document.createElement('span');
    span.textContent = 'null';
    container.appendChild(span);
  } else if (type === 'timestamp') {
    const input = document.createElement('input');
    input.type = 'datetime-local';
    input.className = 'value-input';
    const iso = value && value.value ? value.value : new Date().toISOString();
    input.value = iso.slice(0, 16);
    container.appendChild(input);
  } else if (type === 'geopoint') {
    const lat = document.createElement('input');
    lat.type = 'number';
    lat.step = 'any';
    lat.className = 'value-input geo-lat';
    lat.value = value && typeof value.lat === 'number' ? value.lat : 0;
    const lng = document.createElement('input');
    lng.type = 'number';
    lng.step = 'any';
    lng.className = 'value-input geo-lng';
    lng.value = value && typeof value.lng === 'number' ? value.lng : 0;
    container.appendChild(lat);
    container.appendChild(lng);
  } else if (type === 'reference') {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'value-input';
    input.placeholder = 'ex: users/abc123';
    input.value = value && value.path ? value.path : '';
    container.appendChild(input);
  } else {
    const textarea = document.createElement('textarea');
    textarea.className = 'value-input json-input';
    textarea.value = JSON.stringify(value ?? {}, null, 2);
    container.appendChild(textarea);
  }
}

function readFieldRow(row) {
  const type = row.dataset.type;
  const container = row.querySelector('.field-value');
  if (type === 'string') return container.querySelector('input').value;
  if (type === 'number') return Number(container.querySelector('input').value);
  if (type === 'boolean') return container.querySelector('input').checked;
  if (type === 'null') return null;
  if (type === 'timestamp') {
    const raw = container.querySelector('input').value;
    return { __type: 'timestamp', value: new Date(raw).toISOString() };
  }
  if (type === 'geopoint') {
    const lat = Number(container.querySelector('.geo-lat').value);
    const lng = Number(container.querySelector('.geo-lng').value);
    return { __type: 'geopoint', lat, lng };
  }
  if (type === 'reference') {
    return { __type: 'reference', path: container.querySelector('input').value };
  }
  return JSON.parse(container.querySelector('textarea').value);
}

function collectEditorData() {
  const data = {};
  document.querySelectorAll('#editor-fields .field-row').forEach((row) => {
    const keyInput = row.querySelector('.field-key');
    if (!keyInput) return;
    const key = keyInput.value.trim();
    if (!key) return;
    data[key] = readFieldRow(row);
  });
  return data;
}

document.getElementById('editor-close-btn').addEventListener('click', () => {
  document.getElementById('editor-panel').hidden = true;
  state.editingDoc = null;
});

document.getElementById('save-doc-btn').addEventListener('click', async () => {
  try {
    const data = collectEditorData();
    const { isNew, collectionPath, id } = state.editingDoc;
    if (isNew) {
      const idInput = document.getElementById('field-doc-id').value.trim();
      await api.send('POST', `/api/document/${encodeURIComponentPath(collectionPath)}`, {
        id: idInput || undefined,
        data,
      });
    } else {
      await api.send('PUT', `/api/document/${encodeURIComponentPath(`${collectionPath}/${id}`)}`, { data });
    }
    document.getElementById('editor-panel').hidden = true;
    state.editingDoc = null;
    await selectCollection(collectionPath);
  } catch (err) {
    showBanner(`Erro ao salvar: ${err.message}`);
  }
});

document.getElementById('delete-doc-btn').addEventListener('click', async () => {
  if (!confirm('Apagar este documento?')) return;
  try {
    const { collectionPath, id } = state.editingDoc;
    await api.send('DELETE', `/api/document/${encodeURIComponentPath(`${collectionPath}/${id}`)}`);
    document.getElementById('editor-panel').hidden = true;
    state.editingDoc = null;
    await selectCollection(collectionPath);
  } catch (err) {
    showBanner(`Erro ao apagar: ${err.message}`);
  }
});

document.getElementById('add-doc-btn').addEventListener('click', () => {
  if (state.currentPath) openEditorForNew(state.currentPath);
});
```

- [ ] **Step 2: Manual verification**

Run `npm start`, open `http://localhost:4001`, select `studio_smoke`, click the `doc1` row. Expected: editor panel opens showing `name: Ada` as a string field. Change the value to `Ada Lovelace`, click "Salvar". Expected: panel closes, table refreshes showing the new name. Click "+ Novo documento", type a field key `city` / value `SP`, leave ID blank, save. Expected: a new row appears with an auto-generated ID. Click that row, then "Apagar", confirm. Expected: row disappears. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "Add document editor with type-aware fields and CRUD actions"
```

---

### Task 8: End-to-end smoke test across all types and subcollections

**Files:** none (verification only; fix forward in the files above if something breaks)

**Interfaces:** exercises the full stack built in Tasks 1-7.

- [ ] **Step 1: Seed a dataset covering every special type plus a subcollection**

```bash
node -e "
const svc = require('./server/firestoreService');
(async () => {
  await svc.createDocument('studio_demo', {
    id: 'alice',
    data: {
      name: 'Alice',
      age: 30,
      active: true,
      bio: null,
      createdAt: { __type: 'timestamp', value: new Date().toISOString() },
      location: { __type: 'geopoint', lat: -23.55, lng: -46.63 },
      manager: { __type: 'reference', path: 'studio_demo/bob' },
      tags: ['a', 'b'],
    },
  });
  await svc.createDocument('studio_demo', { id: 'bob', data: { name: 'Bob' } });
  await svc.createDocument('studio_demo/alice/notes', { data: { text: 'primeira nota' } });
  console.log('seed ok');
  process.exit(0);
})();
"
```
Expected: `seed ok`.

- [ ] **Step 2: Walk through the UI**

Run `npm start`, open `http://localhost:4001`:
1. Sidebar shows `studio_demo`; expanding it lists `alice` and `bob`.
2. Clicking the `studio_demo` label loads a table with columns for every field seen (`id`, `name`, `age`, `active`, `bio`, `createdAt`, `location`, `manager`, `tags`).
3. Clicking the `alice` row opens the editor with each field showing the correct type-specific input: a checkbox for `active`, a `datetime-local` input for `createdAt`, two number inputs for `location`, a text input with `studio_demo/bob` for `manager`, and a JSON textarea `["a","b"]` for `tags`.
4. Change `age` to `31`, save — the table shows the updated value.
5. Expand `alice` in the sidebar again — a `notes` subcollection node appears; expanding it lists the seeded note document.
6. Click "+ Novo documento" on `studio_demo`, add a field, save with a blank ID — a new row with an auto-generated ID appears.
7. Open that new row and delete it — it disappears from the table.

If any step fails, fix the relevant file from Tasks 1-7 and re-run the affected step.

- [ ] **Step 3: Clean up the demo data**

```bash
node -e "
const svc = require('./server/firestoreService');
(async () => {
  const notes = await svc.listDocuments('studio_demo/alice/notes', { pageSize: 200 });
  for (const n of notes) await svc.deleteDocument(\`studio_demo/alice/notes/\${n.id}\`);
  await svc.deleteDocument('studio_demo/alice');
  await svc.deleteDocument('studio_demo/bob');
  console.log('cleanup ok');
  process.exit(0);
})();
"
```
Expected: `cleanup ok`.

- [ ] **Step 4: Run the full test suite one more time**

Run: `npm test`
Expected: all tests across `test/config.test.js`, `test/serialize.test.js`, `test/firestoreService.test.js`, `test/routes.test.js` PASS.

- [ ] **Step 5: Final commit (only if Step 2 required fixes)**

```bash
git add -A
git commit -m "Fix issues found during end-to-end smoke test"
```
If no fixes were needed, skip this step — there is nothing to commit.
