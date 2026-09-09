const config = require('./config');
const app = require('./app');
const { db } = require('./firestoreClient');

const date = new Date();

console.log(`Inicializando Firestore studio...`)
console.log(date.toISOString())
async function start() {
  app.listen(config.port, () => {
    console.log(`Firestore Studio rodando em http://localhost:${config.port}`);
  });
}

process.on("SIGHUP", function () {
  console.log("Hot Reload :: Graceful shutdown")
  process.kill(process.pid, "SIGTERM");
})


start();
