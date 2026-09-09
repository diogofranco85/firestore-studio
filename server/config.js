require('dotenv').config();

const config = {
  projectId: process.env.FIRESTORE_PROJECT_ID || 'floci-gcp',
  emulatorHost: process.env.FIRESTORE_EMULATOR_HOST || 'localhost:4588',
  port: parseInt(process.env.PORT, 10) || 4001,
};

module.exports = config;
