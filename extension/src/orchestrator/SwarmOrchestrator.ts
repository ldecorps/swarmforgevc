import { ShellBackend } from './ShellBackend';

export interface AgentConfig {
  role: string;
  displayName?: string;
  command: string;
  args: string[];
  cwd?: string;
}

type OutputHandler = (role: string, chunk: string, displayName: string) => void;
type ExitHandler = (role: string, code: number | null) => void;

export class SwarmOrchestrator {
  private configs: AgentConfig[] = [];
  private backends: Map<string, ShellBackend> = new Map();
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

  getRoles(): AgentConfig[] {
    return this.configs.map((c) => ({ ...c, displayName: this.getDisplayName(c) }));
  }

  start(): void {
    for (const cfg of this.configs) {
      const backend = new ShellBackend(cfg.command, cfg.args, { cwd: cfg.cwd });
      const displayName = this.getDisplayName(cfg);
      backend.onData((chunk) => {
        for (const h of this.outputHandlers) {
          h(cfg.role, chunk, displayName);
        }
      });
      backend.onExit((code) => {
        for (const h of this.exitHandlers) {
          h(cfg.role, code);
        }
      });
      this.backends.set(cfg.role, backend);
    }
  }

  private getDisplayName(config: AgentConfig): string {
    return config.displayName ?? config.role;
  }

  write(role: string, data: string): void {
    this.backends.get(role)?.write(data);
  }

  stop(): void {
    for (const b of this.backends.values()) {
      b.kill();
    }
  }

  waitAll(): Promise<void> {
    if (this.backends.size === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let remaining = this.backends.size;
      const dec = () => {
        remaining -= 1;
        if (remaining === 0) {
          resolve();
        }
      };
      for (const b of this.backends.values()) {
        b.onExit(dec);
      }
    });
  }
}
