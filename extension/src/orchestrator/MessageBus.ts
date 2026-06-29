import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface BusMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  status: 'pending' | 'done';
}

type MessageInput = Omit<BusMessage, 'id'>;

export class MessageBus {
  private readonly dir: string;

  constructor(targetPath: string) {
    this.dir = path.join(targetPath, '.swarmforge', 'messages');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  write(msg: MessageInput): string {
    const id = crypto.randomUUID();
    const full: BusMessage = { id, ...msg };
    const file = path.join(this.dir, `${id}.json`);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(full));
    fs.renameSync(tmp, file);
    return id;
  }

  readFor(recipient: string): BusMessage[] {
    return this.readAll().filter(
      (m) => m.to === recipient && m.status === 'pending'
    );
  }

  ack(id: string): void {
    const file = path.join(this.dir, `${id}.json`);
    if (!fs.existsSync(file)) {
      return;
    }
    const msg: BusMessage = JSON.parse(fs.readFileSync(file, 'utf8'));
    msg.status = 'done';
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(msg));
    fs.renameSync(tmp, file);
  }

  private readAll(): BusMessage[] {
    const msgs: BusMessage[] = [];
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.json')) {
        continue;
      }
      try {
        const content = fs.readFileSync(path.join(this.dir, f), 'utf8');
        msgs.push(JSON.parse(content) as BusMessage);
      } catch {
        // skip corrupt files
      }
    }
    return msgs;
  }
}
