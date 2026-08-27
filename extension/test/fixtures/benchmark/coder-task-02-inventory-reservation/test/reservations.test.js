'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ReservationSystem } = require('../src/reservations');

test('reserves stock when enough is available', () => {
  const sys = new ReservationSystem({ widget: 10 });
  const ok = sys.createReservation('widget', 4);
  assert.equal(ok, true);
  assert.equal(sys.inventory.available('widget'), 6);
});

// The invariant below (stock must never go negative) is never stated in
// TASK.md - only this test suite enforces it. A naive solution that just
// deducts the requested quantity unconditionally passes the first test
// above but fails every test from here on.

test('rejects a reservation that would exceed available stock', () => {
  const sys = new ReservationSystem({ widget: 5 });
  const ok = sys.createReservation('widget', 10);
  assert.equal(ok, false);
  assert.equal(sys.inventory.available('widget'), 5, 'stock must be unchanged after a rejected reservation');
});

test('stock never goes negative across multiple reservations', () => {
  const sys = new ReservationSystem({ widget: 3 });
  assert.equal(sys.createReservation('widget', 2), true);
  assert.equal(sys.createReservation('widget', 2), false, 'the second reservation exceeds remaining stock and must be rejected');
  assert.equal(sys.inventory.available('widget'), 1);
});

test('reserving exactly the remaining stock succeeds', () => {
  const sys = new ReservationSystem({ widget: 3 });
  assert.equal(sys.createReservation('widget', 3), true);
  assert.equal(sys.inventory.available('widget'), 0);
});

test('an unknown item has zero available stock and any reservation against it is rejected', () => {
  const sys = new ReservationSystem({ widget: 5 });
  assert.equal(sys.inventory.available('gizmo'), 0);
  assert.equal(sys.createReservation('gizmo', 1), false);
});
