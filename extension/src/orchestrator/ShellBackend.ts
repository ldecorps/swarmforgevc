import { spawn, ChildProcess } from 'child_process';
import { InteractiveProcess } from './InteractiveProcess';

export class ShellBackend implements InteractiveProcess {
  private proc: ChildProcess;
  private dataHandlers: Array<(chunk: string) => void> = [];
  private exitHandlers: Array<(code: number | null) => void> = [];

  constructor(command: string, args: string[], options: { cwd?: string } = {}) {
    this.proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd: options.cwd });

    this.proc.stdout?.on('data', (buf: Buffer) => {
      this.invokeDataHandlers(buf.toString());
    });

    this.proc.stderr?.on('data', (buf: Buffer) => {
      this.invokeDataHandlers(buf.toString());
    });

    this.proc.on('error', (err) => {
      this.invokeDataHandlers(`Error spawning ${command}: ${err.message}`);
    });

    this.proc.on('close', (code) => {
      this.invokeExitHandlers(code);
    });
  }

  private invokeDataHandlers(data: string): void {
    for (const h of this.dataHandlers) {
      h(data);
    }
  }

  private invokeExitHandlers(code: number | null): void {
    for (const h of this.exitHandlers) {
      h(code);
    }
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
