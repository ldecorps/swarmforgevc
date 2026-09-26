const assert = require('assert');
const { double, triple } = require('./util.js');
assert.strictEqual(double(4), 8);
assert.strictEqual(triple(4), 12);
console.log('ok');
