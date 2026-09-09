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
