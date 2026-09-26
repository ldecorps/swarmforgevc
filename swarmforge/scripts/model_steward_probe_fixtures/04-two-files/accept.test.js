const assert = require('assert');
const { withinLimit } = require('./limiter.js');
assert.strictEqual(withinLimit(10), true);
console.log('ok');
