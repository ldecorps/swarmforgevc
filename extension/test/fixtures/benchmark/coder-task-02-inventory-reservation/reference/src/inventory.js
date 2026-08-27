'use strict';

class Inventory {
  constructor(initialStock = {}) {
    this.stock = { ...initialStock };
  }

  available(itemId) {
    return this.stock[itemId] || 0;
  }

  reserve(itemId, qty) {
    this.stock[itemId] = this.available(itemId) - qty;
    return true;
  }
}

module.exports = { Inventory };
