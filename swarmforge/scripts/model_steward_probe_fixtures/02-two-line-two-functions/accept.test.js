const assert = require('assert');
const { area, perimeter } = require('./shapes.js');
assert.strictEqual(area(3, 4), 12);
assert.strictEqual(perimeter(3, 4), 14);
console.log('ok');
