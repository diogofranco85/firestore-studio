const config = require('./config');
const app = require('./app');
const store = require('./connectionsStore');

store.seedDefaultIfEmpty({ projectId: config.projectId, emulatorHost: config.emulatorHost });

function start() {
  app.listen(config.port, () => {
    console.log(`Firestore Studio rodando em http://localhost:${config.port}`);
  });
}

process.on("SIGHUP", function () {
  console.log("Hot Reload :: Graceful shutdown")
  process.kill(process.pid, "SIGTERM");
})

start();
