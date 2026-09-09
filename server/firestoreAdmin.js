const { v1 } = require('@google-cloud/firestore');
const { getConnection } = require('./connectionsStore');

const clients = new Map();

function getAdminClient(connectionId) {
  if (clients.has(connectionId)) return clients.get(connectionId);

  const conn = getConnection(connectionId);
  if (!conn) throw new Error(`Conexão não encontrada: ${connectionId}`);
  if (conn.type !== 'production') {
    throw new Error('O emulador não suporta gerenciamento de índices — ele não exige índices compostos.');
  }

  const client = new v1.FirestoreAdminClient({
    credentials: JSON.parse(conn.credentialJson),
    projectId: conn.projectId,
  });
  clients.set(connectionId, client);
  return client;
}

function collectionGroupPath(conn, collectionId) {
  return `projects/${conn.projectId}/databases/${conn.databaseId || '(default)'}/collectionGroups/${collectionId}`;
}

function toIndexSummary(index) {
  return {
    id: index.name.split('/').pop(),
    name: index.name,
    queryScope: index.queryScope,
    state: index.state,
    fields: (index.fields || [])
      .filter((f) => f.fieldPath !== '__name__')
      .map((f) => ({ fieldPath: f.fieldPath, order: f.order, arrayConfig: f.arrayConfig })),
  };
}

async function listIndexes(connectionId, collectionId) {
  const conn = getConnection(connectionId);
  const client = getAdminClient(connectionId);
  const [indexes] = await client.listIndexes({ parent: collectionGroupPath(conn, collectionId) });
  return indexes.map(toIndexSummary);
}

function validateFields(fields) {
  if (!Array.isArray(fields) || fields.length === 0) return 'É necessário informar ao menos um campo';
  for (const f of fields) {
    if (!f.fieldPath) return 'Cada campo precisa de fieldPath';
    if (f.arrayConfig && f.arrayConfig !== 'CONTAINS') return 'arrayConfig inválido';
    if (f.order && !['ASCENDING', 'DESCENDING'].includes(f.order)) return 'order inválido';
    if (!f.order && !f.arrayConfig) return `Campo "${f.fieldPath}" precisa de order ou arrayConfig`;
  }
  return null;
}

async function createIndex(connectionId, collectionId, fields) {
  const error = validateFields(fields);
  if (error) throw new Error(error);

  const conn = getConnection(connectionId);
  const client = getAdminClient(connectionId);
  await client.createIndex({
    parent: collectionGroupPath(conn, collectionId),
    index: {
      queryScope: 'COLLECTION',
      fields: fields.map((f) => ({
        fieldPath: f.fieldPath,
        ...(f.arrayConfig ? { arrayConfig: f.arrayConfig } : { order: f.order }),
      })),
    },
  });
}

async function deleteIndex(connectionId, collectionId, indexId) {
  const conn = getConnection(connectionId);
  const client = getAdminClient(connectionId);
  await client.deleteIndex({ name: `${collectionGroupPath(conn, collectionId)}/indexes/${indexId}` });
}

module.exports = { listIndexes, createIndex, deleteIndex };
