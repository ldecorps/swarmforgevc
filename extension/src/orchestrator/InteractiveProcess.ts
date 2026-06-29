export interface InteractiveProcess {
  onData(handler: (chunk: string) => void): void;
  onExit(handler: (code: number | null) => void): void;
  write(data: string): void;
  kill(): void;
}
