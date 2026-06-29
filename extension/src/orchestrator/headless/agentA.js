// Mock agent A: writes a handoff message to agent B's inbox and exits.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const targetPath = process.argv[2];
if (!targetPath) { process.exit(1); }

const dir = path.join(targetPath, '.swarmforge', 'messages');
fs.mkdirSync(dir, { recursive: true });

const msg = { id: crypto.randomUUID(), from: 'agent-a', to: 'agent-b', subject: 'work', body: 'do-something', status: 'pending' };
const file = path.join(dir, `${msg.id}.json`);
const tmp = `${file}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(msg));
fs.renameSync(tmp, file);

console.log(`agent-a: wrote handoff ${msg.id}`);
process.exit(0);
