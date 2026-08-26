'use strict';

class Inventory {
  constructor(initialStock = {}) {
    this.stock = { ...initialStock };
  }

  available(itemId) {
    throw new Error('not implemented');
  }

  reserve(itemId, qty) {
    throw new Error('not implemented');
  }
}

module.exports = { Inventory };
