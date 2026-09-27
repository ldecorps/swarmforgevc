const assert = require('assert');
const { parseCount } = require('./parse.js');
assert.strictEqual(parseCount('42'), 42);
assert.throws(() => parseCount('abc'), /not a number/);
console.log('ok');
