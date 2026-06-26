import {
  capturePane,
  paneTarget,
  readSwarmRoles,
  readTmuxSocket,
  sendKeys,
  SwarmRole,
  getPaneBaseIndex,
} from './tmuxClient';

export interface TileOutput {
  role: string;
  displayName: string;
  text: string;
  full: boolean;
}

export class PaneTailer {
  private interval: ReturnType<typeof setInterval> | undefined;
  private lastLineCounts = new Map<string, number>();
  private paneBaseIndex = 0;
  private roles: SwarmRole[] = [];
  private socketPath = '';

  constructor(
    private readonly targetPath: string,
    private readonly onOutput: (updates: TileOutput[]) => void
  ) {}

  start(pollMs = 200): void {
    this.stop();
    this.refreshState();

    this.interval = setInterval(() => {
      this.poll();
    }, pollMs);
    this.poll();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  refreshState(): void {
    this.socketPath = readTmuxSocket(this.targetPath) ?? '';
    this.roles = readSwarmRoles(this.targetPath);
    if (this.socketPath) {
      this.paneBaseIndex = getPaneBaseIndex(this.socketPath);
    }
  }

  getRoles(): SwarmRole[] {
    return this.roles;
  }

  private poll(): void {
    if (!this.socketPath) {
      this.refreshState();
      if (!this.socketPath) {
        return;
      }
    }

    const updates: TileOutput[] = [];

    for (const role of this.roles) {
      const target = paneTarget(
        role.session,
        role.displayName,
        this.paneBaseIndex
      );
      const lastLines = this.lastLineCounts.get(role.role) ?? -1;
      const result = capturePane(this.socketPath, target, lastLines + 1);

      if (result.exitCode !== 0) {
        continue;
      }

      if (result.stdout.length > 0) {
        updates.push({
          role: role.role,
          displayName: role.displayName,
          text: result.stdout,
          full: lastLines < 0,
        });
      }

      const fullCapture = capturePane(this.socketPath, target);
      if (fullCapture.exitCode === 0) {
        const lineCount = fullCapture.stdout.split('\n').length;
        this.lastLineCounts.set(role.role, lineCount);
      }
    }

    if (updates.length > 0) {
      this.onOutput(updates);
    }
  }

  forwardInput(roleName: string, data: string): void {
    if (!this.socketPath) {
      return;
    }

    const role = this.roles.find((r) => r.role === roleName);
    if (!role) {
      return;
    }

    const target = paneTarget(
      role.session,
      role.displayName,
      this.paneBaseIndex
    );

    if (data === '\r' || data === '\n') {
      sendKeys(this.socketPath, target, 'Enter');
      return;
    }

    if (data === '\x7f' || data === '\b') {
      sendKeys(this.socketPath, target, 'BSpace');
      return;
    }

    if (data === '\t') {
      sendKeys(this.socketPath, target, 'Tab');
      return;
    }

    if (data.length === 1 && data.charCodeAt(0) < 32) {
      const ctrl = String.fromCharCode(data.charCodeAt(0) + 64).toLowerCase();
      sendKeys(this.socketPath, target, `C-${ctrl}`);
      return;
    }

    sendKeys(this.socketPath, target, data, true);
  }

  forwardSpecialKey(roleName: string, key: string): void {
    if (!this.socketPath) {
      return;
    }

    const role = this.roles.find((r) => r.role === roleName);
    if (!role) {
      return;
    }

    const target = paneTarget(
      role.session,
      role.displayName,
      this.paneBaseIndex
    );

    const keyMap: Record<string, string> = {
      Enter: 'Enter',
      Backspace: 'BSpace',
      Tab: 'Tab',
      Escape: 'Escape',
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      Home: 'Home',
      End: 'End',
      PageUp: 'PPage',
      PageDown: 'NPage',
      Delete: 'DC',
    };

    const tmuxKey = keyMap[key];
    if (tmuxKey) {
      sendKeys(this.socketPath, target, tmuxKey);
    }
  }
}
