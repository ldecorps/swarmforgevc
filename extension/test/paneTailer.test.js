const assert = require('node:assert/strict');
const test = require('node:test');

const { mapInputToTmuxKey, mapSpecialKeyToTmux } = require('../out/panel/paneTailer');
const { stripAnsi } = require('../out/panel/ansi');
const { getPaneCommand } = require('../out/swarm/tmuxClient');

test('getPaneCommand returns empty string for non-existent socket', () => {
  const result = getPaneCommand('/tmp/nonexistent-sfvc-socket-xyz', 'somesession:0.0');
  assert.equal(result, '');
});

test('stripAnsi removes basic SGR sequences', () => {
  assert.equal(stripAnsi('\x1b[31mred\x1b[0m'), 'red');
});

test('stripAnsi removes bold and reset sequences', () => {
  assert.equal(stripAnsi('\x1b[1mhello\x1b[0m world'), 'hello world');
});

test('stripAnsi passes plain text through unchanged', () => {
  assert.equal(stripAnsi('plain text'), 'plain text');
});

test('stripAnsi removes cursor positioning sequences', () => {
  assert.equal(stripAnsi('\x1b[2Jhello'), 'hello');
});

test('mapInputToTmuxKey maps CR to Enter', () => {
  assert.deepEqual(mapInputToTmuxKey('\r'), { key: 'Enter', literal: false });
});

test('mapInputToTmuxKey maps LF to Enter', () => {
  assert.deepEqual(mapInputToTmuxKey('\n'), { key: 'Enter', literal: false });
});

test('mapInputToTmuxKey maps DEL (0x7f) to BSpace', () => {
  assert.deepEqual(mapInputToTmuxKey('\x7f'), { key: 'BSpace', literal: false });
});

test('mapInputToTmuxKey maps BS (0x08) to BSpace', () => {
  assert.deepEqual(mapInputToTmuxKey('\b'), { key: 'BSpace', literal: false });
});

test('mapInputToTmuxKey maps tab to Tab', () => {
  assert.deepEqual(mapInputToTmuxKey('\t'), { key: 'Tab', literal: false });
});

test('mapInputToTmuxKey maps Ctrl+A (0x01) to C-a', () => {
  assert.deepEqual(mapInputToTmuxKey('\x01'), { key: 'C-a', literal: false });
});

test('mapInputToTmuxKey maps Ctrl+C (0x03) to C-c', () => {
  assert.deepEqual(mapInputToTmuxKey('\x03'), { key: 'C-c', literal: false });
});

test('mapInputToTmuxKey maps Ctrl+Z (0x1a) to C-z', () => {
  assert.deepEqual(mapInputToTmuxKey('\x1a'), { key: 'C-z', literal: false });
});

test('mapInputToTmuxKey passes printable text through as literal', () => {
  assert.deepEqual(mapInputToTmuxKey('hello'), { key: 'hello', literal: true });
});

test('mapInputToTmuxKey passes single printable char through as literal', () => {
  assert.deepEqual(mapInputToTmuxKey('a'), { key: 'a', literal: true });
});

test('mapSpecialKeyToTmux maps Enter', () => {
  assert.equal(mapSpecialKeyToTmux('Enter'), 'Enter');
});

test('mapSpecialKeyToTmux maps Backspace to BSpace', () => {
  assert.equal(mapSpecialKeyToTmux('Backspace'), 'BSpace');
});

test('mapSpecialKeyToTmux maps Tab', () => {
  assert.equal(mapSpecialKeyToTmux('Tab'), 'Tab');
});

test('mapSpecialKeyToTmux maps Escape', () => {
  assert.equal(mapSpecialKeyToTmux('Escape'), 'Escape');
});

test('mapSpecialKeyToTmux maps ArrowUp to Up', () => {
  assert.equal(mapSpecialKeyToTmux('ArrowUp'), 'Up');
});

test('mapSpecialKeyToTmux maps ArrowDown to Down', () => {
  assert.equal(mapSpecialKeyToTmux('ArrowDown'), 'Down');
});

test('mapSpecialKeyToTmux maps ArrowLeft to Left', () => {
  assert.equal(mapSpecialKeyToTmux('ArrowLeft'), 'Left');
});

test('mapSpecialKeyToTmux maps ArrowRight to Right', () => {
  assert.equal(mapSpecialKeyToTmux('ArrowRight'), 'Right');
});

test('mapSpecialKeyToTmux maps Home', () => {
  assert.equal(mapSpecialKeyToTmux('Home'), 'Home');
});

test('mapSpecialKeyToTmux maps End', () => {
  assert.equal(mapSpecialKeyToTmux('End'), 'End');
});

test('mapSpecialKeyToTmux maps PageUp to PPage', () => {
  assert.equal(mapSpecialKeyToTmux('PageUp'), 'PPage');
});

test('mapSpecialKeyToTmux maps PageDown to NPage', () => {
  assert.equal(mapSpecialKeyToTmux('PageDown'), 'NPage');
});

test('mapSpecialKeyToTmux maps Delete to DC', () => {
  assert.equal(mapSpecialKeyToTmux('Delete'), 'DC');
});

test('mapSpecialKeyToTmux returns undefined for unknown key', () => {
  assert.equal(mapSpecialKeyToTmux('F1'), undefined);
});

test('mapSpecialKeyToTmux returns undefined for empty string', () => {
  assert.equal(mapSpecialKeyToTmux(''), undefined);
});
