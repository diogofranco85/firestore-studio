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
