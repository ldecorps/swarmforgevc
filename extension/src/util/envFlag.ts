// Shared by every operator-file-backed bridge route (bubble-config, ui-bundle)
// that reads a disabled/force-rollback flag from process.env - extracted
// rather than duplicated so the one truthy-string convention has one
// implementation.
export function boolFromEnv(value: string | undefined): boolean {
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}
