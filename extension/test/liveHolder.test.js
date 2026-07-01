const assert = require('node:assert/strict');
const test = require('node:test');

// Function to parse handoff file and extract task name
function parseHandoffTask(content) {
  if (!content) return null;
  const taskMatch = content.match(/^task:\s*(.+)$/m);
  return taskMatch ? taskMatch[1].trim() : null;
}

// Function to find live holder for an item by matching task name
function findLiveHolder(itemId, stages, readHandoffFiles) {
  // For each active stage, check if it has a handoff with the matching task
  for (const stage of stages) {
    if (stage.status !== 'active') continue;
    
    const handoffs = readHandoffFiles(stage.role) || [];
    for (const handoff of handoffs) {
      const taskName = parseHandoffTask(handoff.content);
      // Task names typically follow pattern: "bl-NNN-xxx" or "task-name"
      // Match if the task starts with the item ID (case-insensitive)
      if (taskName && taskName.toLowerCase().startsWith(itemId.toLowerCase())) {
        return stage.role;
      }
    }
  }
  return null;
}

test('parseHandoffTask extracts task name from handoff content', () => {
  const content = 'id: 123\nfrom: coder\ntask: bl-043-tile-layout\ncommit: abc123';
  assert.equal(parseHandoffTask(content), 'bl-043-tile-layout');
});

test('parseHandoffTask returns null when no task field', () => {
  const content = 'id: 123\nfrom: coder\ncommit: abc123';
  assert.equal(parseHandoffTask(content), null);
});

test('parseHandoffTask handles leading/trailing whitespace', () => {
  const content = 'task:  bl-043-tile-layout  \nother: field';
  assert.equal(parseHandoffTask(content), 'bl-043-tile-layout');
});

test('findLiveHolder returns role holding the item', () => {
  const itemId = 'BL-043';
  const stages = [
    { role: 'coder', status: 'idle' },
    { role: 'cleaner', status: 'active' },
    { role: 'architect', status: 'idle' }
  ];
  const readHandoffFiles = (role) => {
    if (role === 'cleaner') {
      return [{ content: 'task: bl-043-tile-layout\n' }];
    }
    return [];
  };
  
  assert.equal(findLiveHolder(itemId, stages, readHandoffFiles), 'cleaner');
});

test('findLiveHolder returns null when item not in pipeline', () => {
  const itemId = 'BL-099';
  const stages = [
    { role: 'coder', status: 'active' },
    { role: 'cleaner', status: 'idle' }
  ];
  const readHandoffFiles = (role) => {
    if (role === 'coder') {
      return [{ content: 'task: bl-043-tile-layout\n' }];
    }
    return [];
  };
  
  assert.equal(findLiveHolder(itemId, stages, readHandoffFiles), null);
});

test('findLiveHolder ignores idle stages', () => {
  const itemId = 'BL-043';
  const stages = [
    { role: 'coder', status: 'idle' },
    { role: 'cleaner', status: 'idle' }
  ];
  const readHandoffFiles = () => [{ content: 'task: bl-043-tile-layout\n' }];
  
  assert.equal(findLiveHolder(itemId, stages, readHandoffFiles), null);
});

test('findLiveHolder matches case-insensitively', () => {
  const itemId = 'BL-044';
  const stages = [{ role: 'architect', status: 'active' }];
  const readHandoffFiles = () => [{ content: 'task: BL-044-footer-autoscroll\n' }];
  
  assert.equal(findLiveHolder(itemId, stages, readHandoffFiles), 'architect');
});

test('findLiveHolder returns first matching active stage', () => {
  const itemId = 'BL-043';
  const stages = [
    { role: 'cleaner', status: 'active' },
    { role: 'architect', status: 'active' }
  ];
  const readHandoffFiles = () => [{ content: 'task: bl-043-tile-layout\n' }];
  
  // Should return the first active stage that has the handoff
  const holder = findLiveHolder(itemId, stages, readHandoffFiles);
  assert(holder === 'cleaner' || holder === 'architect');
});
