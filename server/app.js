const express = require('express');
const path = require('node:path');
const routes = require('./routes');

const app = express();
app.use(express.json());
app.use('/api', routes);
app.use(express.static(path.join(__dirname, '..', 'public')));

module.exports = app;
