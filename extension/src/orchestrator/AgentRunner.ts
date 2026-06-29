import { SwarmOrchestrator } from './SwarmOrchestrator';

export interface RoleConfig {
  role: string;
  displayName: string;
  command: string;
  args: string[];
}

export class AgentRunner {
  private readonly orchestrator: SwarmOrchestrator;
  private readonly roles: { role: string; displayName: string }[];

  constructor(roleConfigs: RoleConfig[]) {
    this.orchestrator = new SwarmOrchestrator();
    this.roles = roleConfigs.map((rc) => ({ role: rc.role, displayName: rc.displayName }));
    for (const rc of roleConfigs) {
      this.orchestrator.add({ role: rc.role, command: rc.command, args: rc.args });
    }
  }

  start(): void {
    this.orchestrator.start();
  }

  stop(): void {
    this.orchestrator.stop();
  }

  getOrchestrator(): SwarmOrchestrator {
    return this.orchestrator;
  }

  getRoles(): { role: string; displayName: string }[] {
    return this.roles;
  }
}
