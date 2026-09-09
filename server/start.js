const config = require('./config');
const app = require('./app');
const { db } = require('./firestoreClient');

async function start() {
  try {
    await db.listCollections();
  } catch (err) {
    console.error(
      `Não foi possível conectar ao emulador do Firestore em ${config.emulatorHost}: ${err.message}`
    );
  }
  app.listen(config.port, () => {
    console.log(`Firestore Studio rodando em http://localhost:${config.port}`);
  });
}

process.on("SIGHUP", function () {
  console.log("Hot Reload :: Graceful shutdown")
  process.kill(process.pid, "SIGTERM");
})


start();
