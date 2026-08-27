const assert = require('node:assert/strict');
const { readDeviceRegistry, writeDeviceRegistry, DEVICE_REGISTRY_SECRET_KEY } = require('../out/bridge/deviceRegistryStore');
const { emptyRegistry, registerDevice } = require('../out/bridge/deviceRegistry');

// BL-241: the device registry persists in VS Code SecretStorage only - the
// same secrets rule notify/secrets.ts's RESEND/OPENAI/MISTRAL keys follow.
// Tested with a fake SecretStorage (mirrors secrets.test.js's own
// fakeSecrets convention) - no real VS Code needed.

function fakeSecrets(initial) {
  const store = new Map(initial ? Object.entries(initial) : []);
  return {
    store,
    secrets: {
      get: async (key) => store.get(key),
      store: async (key, value) => {
        store.set(key, value);
      },
    },
  };
}

test('DEVICE_REGISTRY_SECRET_KEY is the stable SecretStorage key (a mismatch would silently split reads/writes across two slots)', () => {
  assert.equal(DEVICE_REGISTRY_SECRET_KEY, 'swarmforge.bridgeDeviceRegistry');
});

test('readDeviceRegistry returns an empty registry when nothing is stored yet', async () => {
  const { secrets } = fakeSecrets();
  assert.deepEqual(await readDeviceRegistry(secrets), emptyRegistry());
});

test('writeDeviceRegistry then readDeviceRegistry round-trips the same devices', async () => {
  const { secrets } = fakeSecrets();
  // A control-scoped device (every field a real value) - a read-scoped
  // device's controlToken is explicitly `undefined`, which JSON.stringify
  // drops the key for entirely; that's a harmless serialization quirk
  // (nothing ever distinguishes "key absent" from "key undefined" for this
  // shape), not a round-trip fidelity bug this test needs to chase.
  const { registry } = registerDevice(emptyRegistry(), 'laptop', 'control');

  await writeDeviceRegistry(secrets, registry);
  const read = await readDeviceRegistry(secrets);

  assert.deepEqual(read, registry);
});

test('writeDeviceRegistry never writes the registry anywhere but SecretStorage (no fs/target-repo write)', async () => {
  const { secrets, store } = fakeSecrets();
  const { registry } = registerDevice(emptyRegistry(), 'phone', 'control');

  await writeDeviceRegistry(secrets, registry);

  assert.equal(store.size, 1);
  assert.ok(store.has(DEVICE_REGISTRY_SECRET_KEY));
});

test('readDeviceRegistry recovers to empty instead of throwing on corrupt stored JSON', async () => {
  const { secrets } = fakeSecrets({ [DEVICE_REGISTRY_SECRET_KEY]: '{not valid json' });
  assert.deepEqual(await readDeviceRegistry(secrets), emptyRegistry());
});

test('readDeviceRegistry recovers to empty for a validly-parsed but wrongly-shaped stored value', async () => {
  const { secrets } = fakeSecrets({ [DEVICE_REGISTRY_SECRET_KEY]: JSON.stringify({ notDevices: [] }) });
  assert.deepEqual(await readDeviceRegistry(secrets), emptyRegistry());
});
