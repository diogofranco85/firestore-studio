const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { Timestamp, GeoPoint } = require('firebase-admin/firestore');

const dbPath = path.join(__dirname, '.tmp-serialize.db');
process.env.CONNECTIONS_DB_PATH = dbPath;
test.after(() => fs.rmSync(dbPath, { force: true }));

const store = require('../server/connectionsStore');
const { getClient } = require('../server/firestoreClient');
const config = require('../server/config');
const { toWire, fromWire, setDb } = require('../server/serialize');

let db;

test.before(async () => {
  const conn = store.createConnection({
    name: 'Serialize Test',
    type: 'emulator',
    projectId: config.projectId,
    emulatorHost: config.emulatorHost,
  });
  db = await getClient(conn.id);
  setDb(db);
});

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
