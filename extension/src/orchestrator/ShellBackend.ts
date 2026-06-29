import { spawn, ChildProcess } from 'child_process';
import { InteractiveProcess } from './InteractiveProcess';

export class ShellBackend implements InteractiveProcess {
  private proc: ChildProcess;
  private dataHandlers: Array<(chunk: string) => void> = [];
  private exitHandlers: Array<(code: number | null) => void> = [];

  constructor(command: string, args: string[], options: { cwd?: string } = {}) {
    this.proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd: options.cwd });

    this.proc.stdout?.on('data', (buf: Buffer) => {
      const text = buf.toString();
      for (const h of this.dataHandlers) {
        h(text);
      }
    });

    this.proc.stderr?.on('data', (buf: Buffer) => {
      const text = buf.toString();
      for (const h of this.dataHandlers) {
        h(text);
      }
    });

    this.proc.on('error', (err) => {
      const msg = `Error spawning ${command}: ${err.message}`;
      for (const h of this.dataHandlers) {
        h(msg);
      }
    });

    this.proc.on('close', (code) => {
      for (const h of this.exitHandlers) {
        h(code);
      }
    });
  }

  onData(handler: (chunk: string) => void): void {
    this.dataHandlers.push(handler);
  }

  onExit(handler: (code: number | null) => void): void {
    this.exitHandlers.push(handler);
  }

  write(data: string): void {
    this.proc.stdin?.write(data);
  }

  kill(): void {
    this.proc.kill();
  }
}
