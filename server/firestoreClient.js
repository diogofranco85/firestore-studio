const admin = require('firebase-admin');
const { getConnection } = require('./connectionsStore');

// Cada conexão define seu próprio host via settings({host}) — a env var
// global do SDK tem precedência sobre isso e sequestraria todas as
// conexões para o mesmo endereço, então ela é removida aqui.
delete process.env.FIRESTORE_EMULATOR_HOST;

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

async function resetClient(connectionId) {
  clients.delete(connectionId);
  try {
    await admin.app(connectionId).delete();
  } catch {
    // app não existia — nada a derrubar
  }
}

module.exports = { getClient, resetClient };
