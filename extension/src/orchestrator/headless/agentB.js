// Mock agent B: polls for messages, acks one, and exits.
const fs = require('fs');
const path = require('path');

const targetPath = process.argv[2];
if (!targetPath) { process.exit(1); }

const dir = path.join(targetPath, '.swarmforge', 'messages');

function readPending() {
  if (!fs.existsSync(dir)) { return []; }
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } })
    .filter((m) => m && m.to === 'agent-b' && m.status === 'pending');
}

const POLL_INTERVAL = 50;
const TIMEOUT = 5000;
const start = Date.now();

const poll = setInterval(() => {
  const msgs = readPending();
  if (msgs.length > 0) {
    clearInterval(poll);
    const msg = msgs[0];
    msg.status = 'done';
    const file = path.join(dir, `${msg.id}.json`);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(msg));
    fs.renameSync(tmp, file);
    console.log(`agent-b: acked handoff ${msg.id}`);
    process.exit(0);
  }
  if (Date.now() - start > TIMEOUT) {
    clearInterval(poll);
    console.error('agent-b: timed out waiting for handoff');
    process.exit(1);
  }
}, POLL_INTERVAL);
