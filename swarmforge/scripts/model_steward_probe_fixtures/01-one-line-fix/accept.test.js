const assert = require('assert');
const { greet } = require('./greet.js');
assert.strictEqual(greet('Ann'), 'Hello, Ann!');
console.log('ok');
