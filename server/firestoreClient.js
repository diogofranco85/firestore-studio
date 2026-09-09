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
