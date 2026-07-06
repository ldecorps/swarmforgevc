const assert = require('node:assert/strict');
const {
  PIPELINE_CHAIN,
  resolveActivePack,
  nextActiveRole,
  dormantRoles,
  describePack,
} = require('../out/swarm/rolePack');

// BL-064 role-pack-01: a ticket with a pinned pack skips dormant roles.
test('resolveActivePack returns the pinned subset in chain order', () => {
  const pack = resolveActivePack(['documenter', 'coder', 'cleaner']);
  assert.deepEqual(pack, ['coder', 'cleaner', 'documenter', 'QA']);
});

test('nextActiveRole flows coder -> cleaner -> documenter -> QA, skipping architect and hardender', () => {
  const pack = resolveActivePack(['coder', 'cleaner', 'documenter']);
  assert.equal(nextActiveRole(pack, 'coder'), 'cleaner');
  assert.equal(nextActiveRole(pack, 'cleaner'), 'documenter');
  assert.equal(nextActiveRole(pack, 'documenter'), 'QA');
});

test('dormantRoles lists architect and hardender for a lean pack', () => {
  const pack = resolveActivePack(['coder', 'cleaner', 'documenter']);
  assert.deepEqual(dormantRoles(pack), ['specifier', 'architect', 'hardender']);
});

// BL-064 role-pack-02: QA gates every parcel regardless of pack.
test('resolveActivePack always includes QA even when a pin omits it', () => {
  const pack = resolveActivePack(['coder', 'cleaner']);
  assert.ok(pack.includes('QA'));
});

test('nextActiveRole reaches QA as the final active stage for a minimal pack', () => {
  const pack = resolveActivePack(['coder']);
  assert.equal(nextActiveRole(pack, 'coder'), 'QA');
  assert.equal(nextActiveRole(pack, 'QA'), null);
});

// BL-064 role-pack-03: unpinned tickets run the full default chain.
test('resolveActivePack returns the full chain when no pack is pinned', () => {
  assert.deepEqual(resolveActivePack(undefined), [...PIPELINE_CHAIN]);
  assert.deepEqual(resolveActivePack([]), [...PIPELINE_CHAIN]);
});

test('nextActiveRole visits every role in order for an unpinned ticket', () => {
  const pack = resolveActivePack(undefined);
  assert.equal(nextActiveRole(pack, 'specifier'), 'coder');
  assert.equal(nextActiveRole(pack, 'coder'), 'cleaner');
  assert.equal(nextActiveRole(pack, 'cleaner'), 'architect');
  assert.equal(nextActiveRole(pack, 'architect'), 'hardender');
  assert.equal(nextActiveRole(pack, 'hardender'), 'documenter');
  assert.equal(nextActiveRole(pack, 'documenter'), 'QA');
});

// BL-064 role-pack-05: pack routing is visible.
test('describePack renders a readable routing summary', () => {
  const pack = resolveActivePack(['coder', 'cleaner', 'documenter']);
  assert.equal(describePack(pack), 'coder -> cleaner -> documenter -> QA');
});

test('describePack renders the full chain for an unpinned ticket', () => {
  assert.equal(
    describePack(resolveActivePack(undefined)),
    'specifier -> coder -> cleaner -> architect -> hardender -> documenter -> QA'
  );
});

// Edge cases
test('resolveActivePack ignores unknown role names in a pin', () => {
  const pack = resolveActivePack(['coder', 'not-a-real-role']);
  assert.deepEqual(pack, ['coder', 'QA']);
});

test('resolveActivePack dedupes a pin that names the same role twice', () => {
  const pack = resolveActivePack(['coder', 'coder', 'cleaner']);
  assert.deepEqual(pack, ['coder', 'cleaner', 'QA']);
});

test('nextActiveRole returns null for a role not in the chain', () => {
  const pack = resolveActivePack(undefined);
  assert.equal(nextActiveRole(pack, 'not-a-real-role'), null);
});
