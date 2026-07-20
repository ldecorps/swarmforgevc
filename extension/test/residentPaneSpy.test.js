const assert = require('node:assert/strict');
const {
  formatResidentSpyHeader,
  renderResidentPaneSpyBody,
  inferRoleLabelFromPane,
} = require('../out/concierge/residentPaneSpy');

test('inferRoleLabelFromPane reads the SwarmForge banner role name', () => {
  const pane = 'SwarmForge Cleaner\n> doing work';
  assert.equal(inferRoleLabelFromPane(pane), 'Cleaner');
});

test('formatResidentSpyHeader includes model when present', () => {
  assert.equal(
    formatResidentSpyHeader({ roleLabel: 'coder', modelLabel: 'Sonnet 4.6' }),
    'Resident: coder on Sonnet 4.6'
  );
});

test('formatResidentSpyHeader keeps session target in parentheses', () => {
  assert.equal(
    formatResidentSpyHeader({
      roleLabel: 'Cleaner',
      modelLabel: 'Haiku 4.5',
      sessionTarget: 'swarmforge-coder:0.0',
    }),
    'Resident: Cleaner on Haiku 4.5 (swarmforge-coder:0.0)'
  );
});

test('formatResidentSpyHeader omits model clause when unknown', () => {
  assert.equal(formatResidentSpyHeader({ roleLabel: 'Coder' }), 'Resident: Coder');
});

test('renderResidentPaneSpyBody puts header above pane text', () => {
  const body = renderResidentPaneSpyBody({
    roleLabel: 'coder',
    modelLabel: 'Sonnet 4.6',
    paneText: 'hello',
  });
  assert.match(body, /^Resident: coder on Sonnet 4\.6\n\nhello$/);
});
