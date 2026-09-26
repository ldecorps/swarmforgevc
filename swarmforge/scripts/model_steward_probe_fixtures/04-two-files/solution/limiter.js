const config = require('./config.js');

function withinLimit(n) {
  return n <= config.MAX;
}

module.exports = { withinLimit };
