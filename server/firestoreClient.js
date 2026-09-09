const admin = require('firebase-admin');
const config = require('./config');

process.env.FIRESTORE_EMULATOR_HOST = config.emulatorHost;

const app = admin.initializeApp({ projectId: config.projectId });
const db = admin.firestore(app);

module.exports = { db };
