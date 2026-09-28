'use strict';

// Punto de entrada de la capacidad. El núcleo no importa esto: quien la usa la requiere
// desde afuera, como se hace con demo/x402.

const nucleo = require('./nucleo.js');
const capacidad = require('./capability.js');

module.exports = {
  ...nucleo,
  ...capacidad,
};
