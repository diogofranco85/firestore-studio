const test = require('node:test');
const assert = require('node:assert');

test('uses default values when env vars are not set', () => {
  delete process.env.FIRESTORE_PROJECT_ID;
  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.PORT;
  delete require.cache[require.resolve('../server/config')];
  const config = require('../server/config');
  assert.strictEqual(config.projectId, 'floci-gcp');
  assert.strictEqual(config.emulatorHost, 'localhost:4588');
  assert.strictEqual(config.port, 4001);
});

test('uses env vars when set', () => {
  process.env.FIRESTORE_PROJECT_ID = 'other-project';
  process.env.FIRESTORE_EMULATOR_HOST = 'localhost:9999';
  process.env.PORT = '5000';
  delete require.cache[require.resolve('../server/config')];
  const config = require('../server/config');
  assert.strictEqual(config.projectId, 'other-project');
  assert.strictEqual(config.emulatorHost, 'localhost:9999');
  assert.strictEqual(config.port, 5000);
  delete process.env.FIRESTORE_PROJECT_ID;
  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.PORT;
});
