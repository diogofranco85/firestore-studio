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
