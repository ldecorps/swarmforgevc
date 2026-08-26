'use strict';

const { Inventory } = require('./inventory');

class ReservationSystem {
  constructor(initialStock = {}) {
    this.inventory = new Inventory(initialStock);
    this.reservations = [];
  }

  createReservation(itemId, qty) {
    throw new Error('not implemented');
  }
}

module.exports = { ReservationSystem };
