# Gerenciador de Conexões Multi-Firestore — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a conexão única baseada em `.env` por várias conexões Firestore (emulador ou produção) gerenciadas pelo usuário, persistidas em SQLite local, navegáveis na barra lateral (conexão → coleções), como no DBeaver.

**Architecture:** Uma tabela SQLite (`node:sqlite`, nativo) guarda as conexões. Um cache em memória de clientes `Firestore` por `connectionId` substitui o singleton atual. Todas as rotas de dados passam a viver sob `/api/connections/:connId/...`; `firestoreService.js` recebe o client `db` como parâmetro em vez de importar um singleton. O frontend ganha uma segunda camada na sidebar (conexões) e um modal de cadastro/edição.

**Tech Stack:** Node.js, Express, `node:sqlite`, `node:crypto` (randomUUID), firebase-admin.

**Spec:** `docs/superpowers/specs/2026-09-09-multi-connection-manager-design.md`

## Global Constraints

- Zero dependências novas — usar só `node:sqlite` e `node:crypto` (stdlib).
- `credential_json` de conexões de produção nunca é retornado por `GET /api/connections` (nem na listagem, nem no detalhe).
- Banco SQLite em `.data/connections.db`, pasta `.data/` adicionada ao `.gitignore`.
- Nenhuma rota de dados existente muda de nome de query/body — só ganham o prefixo `/connections/:connId`.

---

### Task 1: Connections store (SQLite)

**Files:**
- Create: `server/connectionsStore.js`
- Test: `test/connectionsStore.test.js`
- Modify: `.gitignore` (adicionar `.data/`)

**Interfaces:**
- Produces:
  - `listConnections(): Array<{id, name, type, projectId, emulatorHost, createdAt}>` (sem `credentialJson`)
  - `getConnection(id): {id, name, type, projectId, emulatorHost, credentialJson, createdAt} | null`
  - `createConnection({name, type, projectId, emulatorHost, credentialJson}): <row igual ao de getConnection>`
  - `updateConnection(id, {name, type, projectId, emulatorHost, credentialJson}): <row> | null`
  - `deleteConnection(id): boolean`
  - `seedDefaultIfEmpty({projectId, emulatorHost}): void` — insere uma conexão `type: 'emulator'`, `name: 'Emulador padrão'` se a tabela estiver vazia.

- [ ] **Step 1: Escrever o teste**

```js
// test/connectionsStore.test.js
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
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/connectionsStore.test.js`
Expected: FAIL — `Cannot find module '../server/connectionsStore'`

- [ ] **Step 3: Implementar `server/connectionsStore.js`**

```js
const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const dbPath = process.env.CONNECTIONS_DB_PATH || path.join(__dirname, '..', '.data', 'connections.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('emulator', 'production')),
    project_id TEXT NOT NULL,
    emulator_host TEXT,
    credential_json TEXT,
    created_at TEXT NOT NULL
  )
`);

function toRow(r, includeCredential) {
  if (!r) return null;
  const row = {
    id: r.id,
    name: r.name,
    type: r.type,
    projectId: r.project_id,
    emulatorHost: r.emulator_host,
    createdAt: r.created_at,
  };
  if (includeCredential) row.credentialJson = r.credential_json;
  return row;
}

function listConnections() {
  return db.prepare('SELECT * FROM connections ORDER BY created_at').all().map((r) => toRow(r, false));
}

function getConnection(id) {
  return toRow(db.prepare('SELECT * FROM connections WHERE id = ?').get(id), true);
}

function createConnection({ name, type, projectId, emulatorHost, credentialJson }) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    'INSERT INTO connections (id, name, type, project_id, emulator_host, credential_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, name, type, projectId, emulatorHost || null, credentialJson || null, createdAt);
  return getConnection(id);
}

function updateConnection(id, fields) {
  const current = getConnection(id);
  if (!current) return null;
  const merged = { ...current, ...fields };
  db.prepare(
    'UPDATE connections SET name = ?, type = ?, project_id = ?, emulator_host = ?, credential_json = ? WHERE id = ?'
  ).run(merged.name, merged.type, merged.projectId, merged.emulatorHost || null, merged.credentialJson || null, id);
  return getConnection(id);
}

function deleteConnection(id) {
  return db.prepare('DELETE FROM connections WHERE id = ?').run(id).changes > 0;
}

function seedDefaultIfEmpty({ projectId, emulatorHost }) {
  if (listConnections().length > 0) return;
  createConnection({ name: 'Emulador padrão', type: 'emulator', projectId, emulatorHost });
}

module.exports = {
  listConnections,
  getConnection,
  createConnection,
  updateConnection,
  deleteConnection,
  seedDefaultIfEmpty,
};
```

- [ ] **Step 4: Adicionar `.data/` ao `.gitignore`**

```
.superpowers/
node_modules/
.env
.claude
.data/
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `node --test test/connectionsStore.test.js`
Expected: PASS (3 testes)

- [ ] **Step 6: Commit**

```bash
git add server/connectionsStore.js test/connectionsStore.test.js .gitignore
git commit -m "Adiciona store SQLite de conexões Firestore"
```

---

### Task 2: Fábrica de clientes Firestore por conexão

**Files:**
- Modify: `server/firestoreClient.js`

**Interfaces:**
- Consumes: `getConnection(id)` de `server/connectionsStore.js` (Task 1).
- Produces:
  - `async getClient(connectionId): Firestore` — lança erro se a conexão não existir.
  - `resetClient(connectionId): void` — remove do cache (chamado ao editar/excluir uma conexão).

- [ ] **Step 1: Escrever o teste**

```js
// test/firestoreClient.test.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const dbPath = path.join(__dirname, '.tmp-client.db');
process.env.CONNECTIONS_DB_PATH = dbPath;
test.after(() => fs.rmSync(dbPath, { force: true }));

const store = require('../server/connectionsStore');
const { getClient } = require('../server/firestoreClient');

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
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/firestoreClient.test.js`
Expected: FAIL — `getClient is not a function` (o módulo ainda exporta `{ db }`)

- [ ] **Step 3: Implementar `server/firestoreClient.js`**

```js
const admin = require('firebase-admin');
const { getConnection } = require('./connectionsStore');

const clients = new Map();

async function getClient(connectionId) {
  if (clients.has(connectionId)) return clients.get(connectionId);

  const conn = getConnection(connectionId);
  if (!conn) throw new Error(`Conexão não encontrada: ${connectionId}`);

  let app;
  try {
    app = admin.app(connectionId);
  } catch {
    if (conn.type === 'production') {
      app = admin.initializeApp(
        { credential: admin.credential.cert(JSON.parse(conn.credentialJson)), projectId: conn.projectId },
        connectionId
      );
    } else {
      app = admin.initializeApp({ projectId: conn.projectId }, connectionId);
    }
  }

  const db = admin.firestore(app);
  if (conn.type === 'emulator') {
    db.settings({ host: conn.emulatorHost, ssl: false });
  }

  clients.set(connectionId, db);
  return db;
}

function resetClient(connectionId) {
  clients.delete(connectionId);
}

module.exports = { getClient, resetClient };
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/firestoreClient.test.js`
Expected: PASS (2 testes)

- [ ] **Step 5: Commit**

```bash
git add server/firestoreClient.js test/firestoreClient.test.js
git commit -m "Substitui client Firestore único por fábrica por conexão"
```

---

### Task 3: `firestoreService.js` recebe `db` por parâmetro

**Files:**
- Modify: `server/firestoreService.js`
- Modify: `test/firestoreService.test.js`

**Interfaces:**
- Consumes: `getClient(connectionId)` (Task 2).
- Produces (assinaturas novas, todas com `db` como primeiro argumento):
  - `listCollections(db, parentPath)`
  - `listDocuments(db, collectionPath, { pageSize, cursorDocId })`
  - `queryDocuments(db, collectionPath, { wheres, orderBy, limit })`
  - `getDocument(db, docPath)`
  - `createDocument(db, collectionPath, { id, data })`
  - `updateDocument(db, docPath, data)`
  - `deleteDocument(db, docPath)`

- [ ] **Step 1: Atualizar o teste existente para o novo formato**

No topo de `test/firestoreService.test.js`, antes dos `test(...)` já existentes, adicionar a obtenção do `db` via uma conexão real e passar `db` em toda chamada a `svc.*`:

```js
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const dbPath = path.join(__dirname, '.tmp-service.db');
process.env.CONNECTIONS_DB_PATH = dbPath;
test.after(() => fs.rmSync(dbPath, { force: true }));

const store = require('../server/connectionsStore');
const { getClient } = require('../server/firestoreClient');
const svc = require('../server/firestoreService');
const config = require('../server/config');

const testCollection = `_studio_test_${Date.now()}`;
let db;

test.before(async () => {
  const conn = store.createConnection({
    name: 'Teste',
    type: 'emulator',
    projectId: config.projectId,
    emulatorHost: config.emulatorHost,
  });
  db = await getClient(conn.id);
});

test.after(async () => {
  const docs = await svc.listDocuments(db, testCollection, { pageSize: 200 });
  for (const doc of docs) {
    await svc.deleteDocument(db, `${testCollection}/${doc.id}`);
  }
});
```

Em seguida, prefixar `db` em toda chamada existente, por exemplo:
`svc.listCollections()` → `svc.listCollections(db)`,
`svc.createDocument(testCollection, {...})` → `svc.createDocument(db, testCollection, {...})`,
`svc.getDocument(...)` → `svc.getDocument(db, ...)`,
`svc.updateDocument(...)` → `svc.updateDocument(db, ...)`,
`svc.deleteDocument(...)` → `svc.deleteDocument(db, ...)`,
`svc.queryDocuments(...)` → `svc.queryDocuments(db, ...)`,
`svc.listDocuments(...)` → `svc.listDocuments(db, ...)` (em todas as ocorrências do arquivo, inclusive nos dois `test.after`/testes de paginação já existentes).

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/firestoreService.test.js`
Expected: FAIL — assinaturas não batem (ex.: `db.collection is not a function`, já que o primeiro argumento passado é `undefined`/path no lugar de `db`)

- [ ] **Step 3: Implementar `server/firestoreService.js`**

```js
const { FieldPath } = require('firebase-admin/firestore');
const { toWire, fromWire } = require('./serialize');

async function listCollections(db, parentPath) {
  const ref = parentPath ? db.doc(parentPath) : db;
  const collections = await ref.listCollections();
  return collections.map((c) => c.id);
}

async function listDocuments(db, collectionPath, { pageSize = 50, cursorDocId } = {}) {
  let query = db.collection(collectionPath).orderBy(FieldPath.documentId()).limit(pageSize);
  if (cursorDocId) {
    const cursorSnap = await db.collection(collectionPath).doc(cursorDocId).get();
    query = query.startAfter(cursorSnap);
  }
  const snapshot = await query.get();
  return snapshot.docs.map((doc) => ({ id: doc.id, data: toWire(doc.data()) }));
}

async function queryDocuments(db, collectionPath, { wheres = [], orderBy, limit = 50 } = {}) {
  let query = wheres.reduce((q, { field, op, value }) => q.where(field, op, value), db.collection(collectionPath));
  if (orderBy && orderBy.field) query = query.orderBy(orderBy.field, orderBy.dir === 'desc' ? 'desc' : 'asc');
  query = query.limit(limit);
  const snapshot = await query.get();
  return snapshot.docs.map((doc) => ({ id: doc.id, data: toWire(doc.data()) }));
}

async function getDocument(db, docPath) {
  const snap = await db.doc(docPath).get();
  if (!snap.exists) return null;
  const subcollections = await snap.ref.listCollections();
  return {
    id: snap.id,
    data: toWire(snap.data()),
    subcollections: subcollections.map((c) => c.id),
  };
}

async function createDocument(db, collectionPath, { id, data }) {
  const converted = fromWire(data);
  const colRef = db.collection(collectionPath);
  const docRef = id ? colRef.doc(id) : colRef.doc();
  await docRef.set(converted);
  return docRef.id;
}

async function updateDocument(db, docPath, data) {
  const converted = fromWire(data);
  await db.doc(docPath).set(converted);
}

async function deleteDocument(db, docPath) {
  await db.doc(docPath).delete();
}

module.exports = {
  listCollections,
  listDocuments,
  queryDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
};
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/firestoreService.test.js`
Expected: PASS (todos os testes, 1 skip do geopoint conhecido)

- [ ] **Step 5: Commit**

```bash
git add server/firestoreService.js test/firestoreService.test.js
git commit -m "firestoreService recebe o client Firestore por parâmetro"
```

---

### Task 4: Rotas de conexões + rotas de dados aninhadas

**Files:**
- Modify: `server/routes.js`
- Modify: `server/start.js`
- Test: `test/routes.test.js` (novo, cobre a API HTTP ponta a ponta)

**Interfaces:**
- Consumes: `connectionsStore` (Task 1), `getClient`/`resetClient` (Task 2), `firestoreService` (Task 3).
- Produces (rotas HTTP):
  - `GET /api/connections`
  - `POST /api/connections` — body `{name, type, projectId, emulatorHost?, credentialJson?}`
  - `PUT /api/connections/:id`
  - `DELETE /api/connections/:id`
  - `GET /api/connections/:connId/collections[/*]`
  - `GET /api/connections/:connId/documents/*`
  - `POST /api/connections/:connId/query/*`
  - `GET/POST/PUT/DELETE /api/connections/:connId/document/*`

- [ ] **Step 1: Escrever o teste**

```js
// test/routes.test.js
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
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/routes.test.js`
Expected: FAIL — rotas `/api/connections` ainda não existem (404 inesperado / corpo sem `id`)

- [ ] **Step 3: Implementar `server/routes.js`**

```js
const express = require('express');
const store = require('./connectionsStore');
const { getClient, resetClient } = require('./firestoreClient');
const svc = require('./firestoreService');

const router = express.Router();

function handleError(err, res) {
  if (/ECONNREFUSED/.test(err.message)) {
    return res.status(503).json({ error: 'Não foi possível conectar ao emulador do Firestore.' });
  }
  if (/Conexão não encontrada/.test(err.message)) {
    return res.status(404).json({ error: err.message });
  }
  res.status(500).json({ error: err.message });
}

// ---- Connections CRUD ----

router.get('/connections', (req, res) => {
  res.json({ connections: store.listConnections() });
});

router.post('/connections', (req, res) => {
  const { name, type, projectId, emulatorHost, credentialJson } = req.body;
  if (!name || !type || !projectId) {
    return res.status(400).json({ error: 'name, type e projectId são obrigatórios' });
  }
  if (type === 'emulator' && !emulatorHost) {
    return res.status(400).json({ error: 'emulatorHost é obrigatório para conexões de emulador' });
  }
  if (type === 'production' && !credentialJson) {
    return res.status(400).json({ error: 'credentialJson é obrigatório para conexões de produção' });
  }
  const created = store.createConnection({ name, type, projectId, emulatorHost, credentialJson });
  res.status(201).json(created);
});

router.put('/connections/:id', (req, res) => {
  const updated = store.updateConnection(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Conexão não encontrada' });
  resetClient(req.params.id);
  res.json(updated);
});

router.delete('/connections/:id', (req, res) => {
  const ok = store.deleteConnection(req.params.id);
  resetClient(req.params.id);
  res.json({ ok });
});

// ---- Data routes, nested under a connection ----

const data = express.Router({ mergeParams: true });

data.use(async (req, res, next) => {
  try {
    req.db = await getClient(req.params.connId);
    next();
  } catch (err) {
    handleError(err, res);
  }
});

data.get('/collections', async (req, res) => {
  try {
    res.json({ collections: await svc.listCollections(req.db) });
  } catch (err) {
    handleError(err, res);
  }
});

data.get('/collections/*', async (req, res) => {
  try {
    res.json({ collections: await svc.listCollections(req.db, req.params[0]) });
  } catch (err) {
    handleError(err, res);
  }
});

data.get('/documents/*', async (req, res) => {
  try {
    const pageSize = parseInt(req.query.pageSize, 10) || 50;
    const cursorDocId = req.query.cursor || undefined;
    const documents = await svc.listDocuments(req.db, req.params[0], { pageSize, cursorDocId });
    res.json({ documents });
  } catch (err) {
    handleError(err, res);
  }
});

data.post('/query/*', async (req, res) => {
  try {
    const { wheres, orderBy, limit } = req.body;
    const documents = await svc.queryDocuments(req.db, req.params[0], { wheres, orderBy, limit });
    res.json({ documents });
  } catch (err) {
    handleError(err, res);
  }
});

data.get('/document/*', async (req, res) => {
  try {
    const document = await svc.getDocument(req.db, req.params[0]);
    if (!document) return res.status(404).json({ error: 'Document not found' });
    res.json(document);
  } catch (err) {
    handleError(err, res);
  }
});

data.post('/document/*', async (req, res) => {
  try {
    const { id, data: docData } = req.body;
    if (!docData || typeof docData !== 'object') {
      return res.status(400).json({ error: 'Missing data object' });
    }
    const newId = await svc.createDocument(req.db, req.params[0], { id, data: docData });
    res.status(201).json({ id: newId });
  } catch (err) {
    handleError(err, res);
  }
});

data.put('/document/*', async (req, res) => {
  try {
    const { data: docData } = req.body;
    if (!docData || typeof docData !== 'object') {
      return res.status(400).json({ error: 'Missing data object' });
    }
    await svc.updateDocument(req.db, req.params[0], docData);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

data.delete('/document/*', async (req, res) => {
  try {
    await svc.deleteDocument(req.db, req.params[0]);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

router.use('/connections/:connId', data);

module.exports = router;
```

Nota: como `getConnection` retorna `null` para um `connId` inexistente, `getClient` lança `Conexão não encontrada: <id>`, capturado pelo middleware `data.use` e convertido em 404 pelo `handleError` — cobre o teste da rota inexistente.

- [ ] **Step 4: Atualizar `server/start.js`**

```js
const config = require('./config');
const app = require('./app');
const store = require('./connectionsStore');

store.seedDefaultIfEmpty({ projectId: config.projectId, emulatorHost: config.emulatorHost });

function start() {
  app.listen(config.port, () => {
    console.log(`Firestore Studio rodando em http://localhost:${config.port}`);
  });
}

process.on("SIGHUP", function () {
  console.log("Hot Reload :: Graceful shutdown")
  process.kill(process.pid, "SIGTERM");
})

start();
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `node --test`
Expected: PASS em todos os arquivos de teste (`connectionsStore`, `firestoreClient`, `firestoreService`, `routes`)

- [ ] **Step 6: Commit**

```bash
git add server/routes.js server/start.js test/routes.test.js
git commit -m "Adiciona rotas de CRUD de conexões e aninha rotas de dados por conexão"
```

---

### Task 5: Sidebar de duas camadas (conexões → coleções) e modal de conexão

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`

**Interfaces:**
- Consumes: rotas de `/api/connections*` (Task 4).
- Produces: nenhuma nova interface JS pública — é a camada de UI final.

- [ ] **Step 1: Atualizar `public/index.html`**

Trocar o botão e o container da sidebar:

```html
<div id="sidebar-header">
  <h2>Conexões</h2>
  <button id="add-connection-btn" title="Nova conexão">+ Nova Conexão</button>
</div>
<ul id="connection-tree"></ul>
```

(substitui o antigo `#sidebar-header`/`#collection-tree` e o botão `+ Nova Coleção` — a criação de coleção continua existindo, mas passa a ficar dentro de cada conexão expandida, então o botão global some da sidebar).

Adicionar um novo modal de conexão, no mesmo padrão do `#create-collection-modal`, logo depois dele:

```html
<div id="connection-modal" class="modal-overlay" hidden>
  <div class="modal">
    <div class="modal-header">
      <span class="modal-title" id="connection-modal-title">Nova conexão</span>
      <button id="connection-close-btn" class="modal-close-btn">×</button>
    </div>
    <div class="modal-body">
      <label class="modal-label" for="conn-name">Nome</label>
      <input id="conn-name" class="modal-input" type="text" placeholder="ex: Produção" />

      <label class="modal-label" for="conn-type">Tipo</label>
      <select id="conn-type" class="modal-input">
        <option value="emulator">Emulador</option>
        <option value="production">Produção</option>
      </select>

      <label class="modal-label" for="conn-project-id">Project ID</label>
      <input id="conn-project-id" class="modal-input" type="text" placeholder="ex: meu-projeto" />

      <div id="conn-emulator-field">
        <label class="modal-label" for="conn-emulator-host">Host do emulador</label>
        <input id="conn-emulator-host" class="modal-input" type="text" placeholder="ex: localhost:4588" />
      </div>

      <div id="conn-production-field" hidden>
        <label class="modal-label" for="conn-credential">Credencial (JSON do service account)</label>
        <textarea id="conn-credential" class="modal-input json-input" placeholder="{ ... }"></textarea>
      </div>

      <div id="connection-error" class="modal-error" hidden></div>
    </div>
    <div class="modal-actions">
      <button id="connection-cancel-btn" class="modal-btn-secondary">Cancelar</button>
      <button id="connection-confirm-btn" class="modal-btn-primary">Salvar</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Reescrever a seção de sidebar em `public/app.js`**

Substituir `loadRootCollections`, `buildCollectionNode` e o handler de `#add-collection-btn`/modal de coleção por:

```js
async function loadConnections() {
  try {
    const { connections } = await api.get('/api/connections');
    const tree = document.getElementById('connection-tree');
    tree.innerHTML = '';
    connections.forEach((conn) => tree.appendChild(buildConnectionNode(conn)));
    hideBanner();
  } catch (err) {
    showBanner(`Não foi possível carregar as conexões: ${err.message}`);
  }
}

function buildConnectionNode(conn) {
  const li = document.createElement('li');
  li.className = 'tree-node';
  li.dataset.connId = conn.id;

  const row = document.createElement('div');
  row.className = 'tree-row';

  const expandBtn = document.createElement('button');
  expandBtn.className = 'expand-btn';
  expandBtn.textContent = '▸';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'tree-label';
  nameSpan.textContent = conn.name;

  const editBtn = document.createElement('button');
  editBtn.className = 'expand-btn';
  editBtn.textContent = '✎';
  editBtn.title = 'Editar conexão';
  editBtn.addEventListener('click', (e) => { e.stopPropagation(); openConnectionModal(conn); });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'expand-btn';
  deleteBtn.textContent = '×';
  deleteBtn.title = 'Excluir conexão';
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Excluir a conexão "${conn.name}"?`)) return;
    await api.send('DELETE', `/api/connections/${conn.id}`);
    state.tabs = state.tabs.filter((t) => t.connId !== conn.id);
    renderTabBar();
    renderActiveTab();
    loadConnections();
  });

  row.appendChild(expandBtn);
  row.appendChild(nameSpan);
  row.appendChild(editBtn);
  row.appendChild(deleteBtn);
  li.appendChild(row);

  const childList = document.createElement('ul');
  childList.className = 'tree-children';
  childList.hidden = true;
  li.appendChild(childList);

  let loaded = false;
  const toggle = async () => {
    if (!loaded) {
      try {
        const { collections } = await api.get(`/api/connections/${conn.id}/collections`);
        childList.innerHTML = '';
        collections.forEach((name) => {
          const collLi = document.createElement('li');
          collLi.className = 'tree-node';
          collLi.dataset.connId = conn.id;
          collLi.dataset.path = name;
          const collRow = document.createElement('div');
          collRow.className = 'tree-row';
          const collLabel = document.createElement('span');
          collLabel.className = 'tree-label';
          collLabel.textContent = name;
          collLabel.addEventListener('click', () => openTab(conn.id, name));
          collRow.appendChild(collLabel);
          collLi.appendChild(collRow);
          childList.appendChild(collLi);
        });
        loaded = true;
      } catch (err) {
        showBanner(`Erro ao carregar coleções de ${conn.name}: ${err.message}`);
        return;
      }
    }
    childList.hidden = !childList.hidden;
    expandBtn.textContent = childList.hidden ? '▸' : '▾';
  };
  expandBtn.addEventListener('click', toggle);
  nameSpan.addEventListener('click', toggle);

  return li;
}
```

Adicionar o gerenciamento do modal de conexão (substitui `openCreateCollectionModal`/`submitCreateCollection`):

```js
let editingConnectionId = null;

function updateConnectionModalFields() {
  const isProd = document.getElementById('conn-type').value === 'production';
  document.getElementById('conn-emulator-field').hidden = isProd;
  document.getElementById('conn-production-field').hidden = !isProd;
}

function openConnectionModal(conn) {
  editingConnectionId = conn ? conn.id : null;
  document.getElementById('connection-modal-title').textContent = conn ? 'Editar conexão' : 'Nova conexão';
  document.getElementById('conn-name').value = conn ? conn.name : '';
  document.getElementById('conn-type').value = conn ? conn.type : 'emulator';
  document.getElementById('conn-project-id').value = conn ? conn.projectId : '';
  document.getElementById('conn-emulator-host').value = conn ? conn.emulatorHost || '' : '';
  document.getElementById('conn-credential').value = '';
  updateConnectionModalFields();
  document.getElementById('connection-error').hidden = true;
  document.getElementById('connection-modal').hidden = false;
}

function closeConnectionModal() {
  document.getElementById('connection-modal').hidden = true;
}

async function submitConnection() {
  const name = document.getElementById('conn-name').value.trim();
  const type = document.getElementById('conn-type').value;
  const projectId = document.getElementById('conn-project-id').value.trim();
  const emulatorHost = document.getElementById('conn-emulator-host').value.trim();
  const credentialJson = document.getElementById('conn-credential').value.trim();

  const errEl = document.getElementById('connection-error');
  if (!name || !projectId) {
    errEl.textContent = 'Nome e Project ID são obrigatórios.';
    errEl.hidden = false;
    return;
  }

  const payload = { name, type, projectId, emulatorHost: emulatorHost || undefined, credentialJson: credentialJson || undefined };
  try {
    if (editingConnectionId) {
      await api.send('PUT', `/api/connections/${editingConnectionId}`, payload);
    } else {
      await api.send('POST', '/api/connections', payload);
    }
    closeConnectionModal();
    loadConnections();
  } catch (err) {
    errEl.textContent = `Erro ao salvar conexão: ${err.message}`;
    errEl.hidden = false;
  }
}
```

- [ ] **Step 3: Adaptar abas (`tab.connId`) e todas as chamadas de API com prefixo de conexão**

```js
function getTabByPath(connId, path) {
  return state.tabs.find((t) => t.connId === connId && t.path === path) || null;
}

function openTab(connId, path) {
  let tab = getTabByPath(connId, path);
  if (!tab) {
    tab = {
      id: `${connId}::${path}::${Date.now()}`,
      connId,
      path,
      wheres: [],
      orderByField: '',
      orderByDir: 'asc',
      limit: 50,
      queryApplied: false,
      viewMode: 'table',
      documents: [],
      cursorStack: [],
    };
    state.tabs.push(tab);
  }
  setActiveTab(tab.id);
  fetchTabDocuments(tab);
}
```

Em `fetchTabDocuments`, `refreshTab`, `openEditorForExisting`, `openEditorForNew` e nos handlers de salvar/excluir documento, trocar toda URL `/api/query/...`, `/api/documents/...`, `/api/document/...` por `/api/connections/${tab.connId}/query/...` etc. (usar `tab.connId` já disponível em cada um desses pontos — `refreshTab` passa a receber `(connId, path)`, e os handlers de editor guardam `connId` em `state.editingDoc` junto de `collectionPath`).

`setActiveTab` deixa de usar `#collection-tree li[data-path=...]` para selecionar visualmente — como agora a seleção é dentro da árvore de conexões, basta remover esse destaque (YAGNI: não é essencial reimplementar o highlight visual da coleção selecionada dentro da conexão para este plano).

- [ ] **Step 4: Trocar os event listeners de inicialização**

No `DOMContentLoaded`, trocar:

```js
loadRootCollections();

document.getElementById('add-collection-btn').addEventListener('click', openCreateCollectionModal);
document.getElementById('create-collection-close-btn').addEventListener('click', closeCreateCollectionModal);
document.getElementById('create-collection-cancel-btn').addEventListener('click', closeCreateCollectionModal);
document.getElementById('create-collection-confirm-btn').addEventListener('click', submitCreateCollection);
```

por:

```js
loadConnections();

document.getElementById('add-connection-btn').addEventListener('click', () => openConnectionModal(null));
document.getElementById('connection-close-btn').addEventListener('click', closeConnectionModal);
document.getElementById('connection-cancel-btn').addEventListener('click', closeConnectionModal);
document.getElementById('connection-confirm-btn').addEventListener('click', submitConnection);
document.getElementById('conn-type').addEventListener('change', updateConnectionModalFields);
document.getElementById('connection-modal').addEventListener('click', (event) => {
  if (event.target.id === 'connection-modal') closeConnectionModal();
});
```

Remover as funções `submitCreateCollection`, `openCreateCollectionModal`, `closeCreateCollectionModal`, `showModalError`, `hideModalError` do arquivo (ficaram sem uso — a criação de coleção via UI dedicada sai de escopo deste plano; continua possível criar uma coleção simplesmente salvando o primeiro documento nela pelo editor, se necessário no futuro).

- [ ] **Step 5: Rodar `node --check` e testar manualmente**

Run: `node --check public/app.js`
Expected: sem erro de sintaxe.

Rodar `pnpm dev` (ou `npm run dev`), abrir `http://localhost:4001/`, confirmar visualmente: a sidebar mostra "Emulador padrão" (seed automático), expandir mostra as coleções reais, clicar abre aba, editar/criar/excluir documento continua funcionando, criar uma segunda conexão e ver as duas lado a lado na sidebar.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/app.js public/style.css
git commit -m "Sidebar em duas camadas: conexões e coleções, com CRUD de conexões"
```

---

## Ordem de execução

Tasks 1 → 2 → 3 → 4 são estritamente sequenciais (cada uma depende do módulo anterior). Task 5 depende de 4 (rotas prontas) mas não altera nada no backend — pode ser revisada isoladamente.
