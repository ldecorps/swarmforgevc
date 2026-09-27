const assert = require('assert');
const { clamp } = require('./calc.js');
assert.strictEqual(clamp(5, 0, 10), 5);
assert.strictEqual(clamp(-5, 0, 10), 0);
assert.strictEqual(clamp(15, 0, 10), 10);
console.log('ok');
