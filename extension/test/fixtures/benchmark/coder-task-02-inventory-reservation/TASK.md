You are working in this repository. Implement a simple inventory
reservation system across two files:

- `src/inventory.js` exports an `Inventory` class, constructed with an
  initial stock map (`{ itemId: quantity }`). It has:
  - `available(itemId)` — returns the current available quantity for an
    item (0 if the item is unknown).
  - `reserve(itemId, qty)` — reduces the available quantity for `itemId`
    by `qty` and returns `true`.

- `src/reservations.js` exports a `ReservationSystem` class, constructed
  the same way (an initial stock map), which owns an `Inventory` instance
  (`this.inventory`). It has:
  - `createReservation(itemId, qty)` — attempts to reserve `qty` units of
    `itemId` against the system's inventory, returning whether the
    reservation succeeded.

Both files are given to you as stubs; fill in the implementation. Do not
add any dependencies. Do not modify the test file.

When you are done, the existing test suite in
`test/reservations.test.js` must pass when run with
`node --test test/reservations.test.js`. Do not stop until it passes, and
do not report success without actually running the tests yourself.
