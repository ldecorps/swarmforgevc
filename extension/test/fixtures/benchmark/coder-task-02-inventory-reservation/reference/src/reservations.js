'use strict';

const { Inventory } = require('./inventory');

class ReservationSystem {
  constructor(initialStock = {}) {
    this.inventory = new Inventory(initialStock);
    this.reservations = [];
  }

  createReservation(itemId, qty) {
    if (this.inventory.available(itemId) < qty) {
      return false;
    }
    this.inventory.reserve(itemId, qty);
    this.reservations.push({ itemId, qty });
    return true;
  }
}

module.exports = { ReservationSystem };
