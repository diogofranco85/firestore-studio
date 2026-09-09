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

function validateConnectionInput({ name, type, projectId, emulatorHost, credentialJson }) {
  if (!name || !type || !projectId) {
    return 'name, type e projectId são obrigatórios';
  }
  if (type === 'emulator' && !emulatorHost) {
    return 'emulatorHost é obrigatório para conexões de emulador';
  }
  if (type === 'production' && !credentialJson) {
    return 'credentialJson é obrigatório para conexões de produção';
  }
  return null;
}

router.post('/connections', (req, res) => {
  const { name, type, projectId, emulatorHost, credentialJson } = req.body;
  const error = validateConnectionInput(req.body);
  if (error) return res.status(400).json({ error });
  const created = store.createConnection({ name, type, projectId, emulatorHost, credentialJson });
  const { credentialJson: _omit, ...safe } = created;
  res.status(201).json(safe);
});

router.put('/connections/:id', async (req, res) => {
  try {
    const current = store.getConnection(req.params.id);
    if (!current) return res.status(404).json({ error: 'Conexão não encontrada' });
    const merged = { ...current, ...req.body };
    const error = validateConnectionInput(merged);
    if (error) return res.status(400).json({ error });
    const updated = store.updateConnection(req.params.id, req.body);
    await resetClient(req.params.id);
    const { credentialJson: _omit, ...safe } = updated;
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/connections/:id', async (req, res) => {
  try {
    const ok = store.deleteConnection(req.params.id);
    await resetClient(req.params.id);
    res.json({ ok });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
