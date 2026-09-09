const { Timestamp, GeoPoint, DocumentReference } = require('firebase-admin/firestore');

let db = null;

function toWire(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Timestamp) {
    return { __type: 'timestamp', value: value.toDate().toISOString() };
  }
  if (value instanceof GeoPoint) {
    return { __type: 'geopoint', lat: value.latitude, lng: value.longitude };
  }
  if (value instanceof DocumentReference) {
    return { __type: 'reference', path: value.path };
  }
  if (Buffer.isBuffer(value)) {
    return { __type: 'bytes', base64: value.toString('base64') };
  }
  if (Array.isArray(value)) {
    return value.map(toWire);
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) out[key] = toWire(val);
    return out;
  }
  return value;
}

function fromWire(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(fromWire);
  if (typeof value === 'object') {
    if (value.__type === 'timestamp') return Timestamp.fromDate(new Date(value.value));
    if (value.__type === 'geopoint') return new GeoPoint(value.lat, value.lng);
    if (value.__type === 'reference') return db.doc(value.path);
    if (value.__type === 'bytes') return Buffer.from(value.base64, 'base64');
    const out = {};
    for (const [key, val] of Object.entries(value)) out[key] = fromWire(val);
    return out;
  }
  return value;
}

function setDb(dbInstance) {
  db = dbInstance;
}

module.exports = { toWire, fromWire, setDb };
