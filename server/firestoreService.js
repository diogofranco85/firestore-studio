const { FieldPath } = require('firebase-admin/firestore');
const { toWire, fromWire } = require('./serialize');

async function listCollections(db, parentPath) {
  try{
  const ref = parentPath ? db.doc(parentPath) : db;
  const collections = await ref.listCollections();
  return collections.map((c) => c.id);
  }catch(error){
    console.error("List collections", error)
    throw error
  }
}

async function listDocuments(db, collectionPath, { pageSize = 50, cursorDocId } = {}) {
  try{
    let query = db.collection(collectionPath).orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursorDocId) {
      const cursorSnap = await db.collection(collectionPath).doc(cursorDocId).get();
      query = query.startAfter(cursorSnap);
    }
  const snapshot = await query.get();
  return snapshot.docs.map((doc) => ({ id: doc.id, data: toWire(doc.data()) }));
  }catch(error){
    console.error("List Documents", error)
    throw error
  }
 
}

async function queryDocuments(db, collectionPath, { wheres = [], orderBy, limit = 50 } = {}) {
  try{
    let query = wheres.reduce((q, { field, op, value }) => q.where(field, op, value), db.collection(collectionPath));
    if (orderBy && orderBy.field) query = query.orderBy(orderBy.field, orderBy.dir === 'desc' ? 'desc' : 'asc');
    query = query.limit(limit);
    const snapshot = await query.get();
    return snapshot.docs.map((doc) => ({ id: doc.id, data: toWire(doc.data()) }));
    }catch(error){
    console.error("Query Document", error)
    throw error
  }
}

async function getDocument(db, docPath) {
  try{
    const snap = await db.doc(docPath).get();
    if (!snap.exists) return null;
    const subcollections = await snap.ref.listCollections();
    return {
      id: snap.id,
      data: toWire(snap.data()),
      subcollections: subcollections.map((c) => c.id),
    };
  }catch(error){
    console.error("Get Document", error)
    throw error
  }
  
}

async function createDocument(db, collectionPath, { id, data }) {
   try{
    const converted = fromWire(data, db);
    const colRef = db.collection(collectionPath);
    const docRef = id ? colRef.doc(id) : colRef.doc();
    await docRef.set(converted);
    return docRef.id;
   }catch(error){
    console.error("Create Document", error)
    throw error
  }

}

async function updateDocument(db, docPath, data) {
   try{
    const converted = fromWire(data, db);
    await db.doc(docPath).set(converted);
   }catch(error){
    console.error("Update Document", error)
    throw error
  }
}

async function deleteDocument(db, docPath) {
   try{
    await db.doc(docPath).delete();
   }catch(error){
    console.error("Delete Document", error)
    throw error
  }
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
