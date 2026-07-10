const assert = require('node:assert/strict');
const {
  emptyRegistry,
  registerDevice,
  revokeDevice,
  rotateDeviceToken,
  findDeviceByToken,
  findDeviceByControlToken,
} = require('../out/bridge/deviceRegistry');

// BL-241: the pure device-registry logic behind the bridge's hardened auth
// layer - token issuance/rotation, per-device revocation, and the
// read-vs-control scope + step-up requirement. Immutable (every mutator
// returns a new registry), so tested purely in-memory with no live bridge.

test('registerDevice adds a device with its own id and a base token', () => {
  const { registry, device } = registerDevice(emptyRegistry(), 'phone', 'read');
  assert.equal(registry.devices.length, 1);
  assert.equal(device.label, 'phone');
  assert.equal(device.scope, 'read');
  assert.ok(device.token.length > 0);
  assert.equal(device.revoked, false);
});

test('a read-scoped device has no control token at all', () => {
  const { device } = registerDevice(emptyRegistry(), 'phone', 'read');
  assert.equal(device.controlToken, undefined);
});

test('a control-scoped device gets a SEPARATE control token, distinct from its base token', () => {
  const { device } = registerDevice(emptyRegistry(), 'laptop', 'control');
  assert.ok(device.controlToken);
  assert.notEqual(device.controlToken, device.token);
});

test('two registered devices never share a token', () => {
  let registry = emptyRegistry();
  const a = registerDevice(registry, 'a', 'read');
  registry = a.registry;
  const b = registerDevice(registry, 'b', 'read');
  assert.notEqual(a.device.token, b.device.token);
});

// ── findDeviceByToken (read auth) ────────────────────────────────────────

test('findDeviceByToken finds a registered, non-revoked device by its own token', () => {
  const { registry, device } = registerDevice(emptyRegistry(), 'phone', 'read');
  const found = findDeviceByToken(registry, device.token);
  assert.equal(found.id, device.id);
});

test('findDeviceByToken returns undefined for an unknown token', () => {
  const { registry } = registerDevice(emptyRegistry(), 'phone', 'read');
  assert.equal(findDeviceByToken(registry, 'not-a-real-token'), undefined);
});

test('findDeviceByToken returns undefined for an undefined token', () => {
  const { registry } = registerDevice(emptyRegistry(), 'phone', 'read');
  assert.equal(findDeviceByToken(registry, undefined), undefined);
});

test('findDeviceByToken finds either a read- or control-scoped device - read access is scope-independent', () => {
  let registry = emptyRegistry();
  const reader = registerDevice(registry, 'reader', 'read');
  registry = reader.registry;
  const controller = registerDevice(registry, 'controller', 'control');
  registry = controller.registry;

  assert.equal(findDeviceByToken(registry, reader.device.token).id, reader.device.id);
  assert.equal(findDeviceByToken(registry, controller.device.token).id, controller.device.id);
});

// ── device-revocation-02 ──────────────────────────────────────────────────

test('revokeDevice makes that device unfindable by its token, without touching another device', () => {
  let registry = emptyRegistry();
  const alice = registerDevice(registry, 'alice', 'read');
  registry = alice.registry;
  const bob = registerDevice(registry, 'bob', 'read');
  registry = bob.registry;

  registry = revokeDevice(registry, alice.device.id);

  assert.equal(findDeviceByToken(registry, alice.device.token), undefined, 'the revoked device must no longer authenticate');
  assert.equal(findDeviceByToken(registry, bob.device.token).id, bob.device.id, 'a different device must be unaffected');
});

test('revokeDevice keeps the device in the roster (marked revoked), not removed', () => {
  const { registry, device } = registerDevice(emptyRegistry(), 'alice', 'read');
  const revoked = revokeDevice(registry, device.id);
  assert.equal(revoked.devices.length, 1);
  assert.equal(revoked.devices[0].revoked, true);
});

test('revoking an unknown device id is a no-op, not a throw', () => {
  const { registry } = registerDevice(emptyRegistry(), 'alice', 'read');
  assert.doesNotThrow(() => revokeDevice(registry, 'nonexistent-id'));
});

// ── token-rotation-01 ──────────────────────────────────────────────────────

test('rotateDeviceToken issues a fresh token; the old one stops authenticating and the new one works', () => {
  const { registry, device } = registerDevice(emptyRegistry(), 'laptop', 'read');
  const oldToken = device.token;

  const result = rotateDeviceToken(registry, device.id);

  assert.notEqual(result.device.token, oldToken);
  assert.equal(findDeviceByToken(result.registry, oldToken), undefined, 'the old token must no longer authenticate');
  assert.equal(findDeviceByToken(result.registry, result.device.token).id, device.id, 'the new token must authenticate');
});

test('rotating one device\'s token leaves every other device\'s token untouched', () => {
  let registry = emptyRegistry();
  const alice = registerDevice(registry, 'alice', 'read');
  registry = alice.registry;
  const bob = registerDevice(registry, 'bob', 'read');
  registry = bob.registry;

  const result = rotateDeviceToken(registry, alice.device.id);

  assert.equal(findDeviceByToken(result.registry, bob.device.token).id, bob.device.id);
});

test('rotating a control-scoped device\'s token also rotates its separate control token', () => {
  const { registry, device } = registerDevice(emptyRegistry(), 'laptop', 'control');
  const oldControlToken = device.controlToken;

  const result = rotateDeviceToken(registry, device.id);

  assert.notEqual(result.device.controlToken, oldControlToken);
  assert.equal(
    findDeviceByControlToken(result.registry, oldControlToken, oldControlToken),
    undefined,
    'the old control token must no longer satisfy the step-up check'
  );
});

test('rotating an unknown device id returns undefined, not a throw', () => {
  const { registry } = registerDevice(emptyRegistry(), 'alice', 'read');
  assert.equal(rotateDeviceToken(registry, 'nonexistent-id'), undefined);
});

// ── control-requires-step-up-04 / read-only-cannot-control-03 ────────────

test('findDeviceByControlToken finds a control-scoped device presenting BOTH its base and control token', () => {
  const { registry, device } = registerDevice(emptyRegistry(), 'laptop', 'control');
  const found = findDeviceByControlToken(registry, device.token, device.controlToken);
  assert.equal(found.id, device.id);
});

test('findDeviceByControlToken refuses the base token alone, without the control token', () => {
  const { registry, device } = registerDevice(emptyRegistry(), 'laptop', 'control');
  assert.equal(findDeviceByControlToken(registry, device.token, undefined), undefined);
});

test('findDeviceByControlToken refuses a read-scoped device even if it somehow presents its own base token twice', () => {
  const { registry, device } = registerDevice(emptyRegistry(), 'phone', 'read');
  assert.equal(findDeviceByControlToken(registry, device.token, device.token), undefined);
});

test('findDeviceByControlToken refuses mismatched base/control tokens from two different control devices', () => {
  let registry = emptyRegistry();
  const a = registerDevice(registry, 'a', 'control');
  registry = a.registry;
  const b = registerDevice(registry, 'b', 'control');
  registry = b.registry;

  assert.equal(findDeviceByControlToken(registry, a.device.token, b.device.controlToken), undefined);
});

test('a revoked control device can no longer pass the step-up check', () => {
  const { registry, device } = registerDevice(emptyRegistry(), 'laptop', 'control');
  const revoked = revokeDevice(registry, device.id);
  assert.equal(findDeviceByControlToken(revoked, device.token, device.controlToken), undefined);
});
