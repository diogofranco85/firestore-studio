const express = require('express');
const path = require('node:path');
const routes = require('./routes');

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || 'Internal error' });
});

module.exports = app;
