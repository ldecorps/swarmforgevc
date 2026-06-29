import { ShellBackend } from './ShellBackend';

export interface AgentConfig {
  role: string;
  command: string;
  args: string[];
}

type OutputHandler = (role: string, chunk: string) => void;
type ExitHandler = (role: string, code: number | null) => void;

export class SwarmOrchestrator {
  private configs: AgentConfig[] = [];
  private backends: ShellBackend[] = [];
  private outputHandlers: OutputHandler[] = [];
  private exitHandlers: ExitHandler[] = [];

  onOutput(handler: OutputHandler): void {
    this.outputHandlers.push(handler);
  }

  onAgentExit(handler: ExitHandler): void {
    this.exitHandlers.push(handler);
  }

  add(config: AgentConfig): void {
    this.configs.push(config);
  }

  start(): void {
    for (const cfg of this.configs) {
      const backend = new ShellBackend(cfg.command, cfg.args);
      backend.onData((chunk) => {
        for (const h of this.outputHandlers) {
          h(cfg.role, chunk);
        }
      });
      backend.onExit((code) => {
        for (const h of this.exitHandlers) {
          h(cfg.role, code);
        }
      });
      this.backends.push(backend);
    }
  }

  stop(): void {
    for (const b of this.backends) {
      b.kill();
    }
  }

  waitAll(): Promise<void> {
    if (this.backends.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let remaining = this.backends.length;
      const dec = () => {
        remaining -= 1;
        if (remaining === 0) {
          resolve();
        }
      };
      for (const b of this.backends) {
        b.onExit(dec);
      }
    });
  }
}
