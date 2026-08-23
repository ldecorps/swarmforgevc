import * as os from 'os';
import * as path from 'path';
import { isPathInside, tryRealpath } from '../util/pathContainment';

export type NamedModelCatalog = readonly string[];

export type NamedModelEndpointStatus = 'healthy' | 'missing' | 'unhealthy';

export interface NamedModelEndpointProbe {
  endpointStatus: NamedModelEndpointStatus;
  endpointUrl: string;
  reason?: string;
}

export interface NamedModelHealth {
  ready: boolean;
  endpointUrl: string;
  reason: string;
}

export interface NamedModelPullOptions {
  repoRoot?: string;
  modelStorePath?: string;
  presentModelIds?: NamedModelCatalog;
  availableModelIds?: NamedModelCatalog;
}

export interface NamedModelPullPlan {
  modelId: string;
  modelStorePath: string;
  environment: Readonly<Record<string, string>>;
  writePaths: readonly string[];
  command: string | null;
  shouldDownload: boolean;
  ready: boolean;
  message: string;
}

export interface NamedModelServeOptions {
  endpointUrl?: string;
}

export interface NamedModelServePlan {
  modelId: string;
  endpointUrl: string;
  command: string | null;
  shouldStartServer: boolean;
  ready: boolean;
  message: string;
}

const DEFAULT_MODEL_STORE_PATH = path.join(os.homedir(), '.swarmforge', 'models', 'ollama');
export const DEFAULT_NAMED_MODEL_ENDPOINT_URL = 'http://127.0.0.1:11434';
export const NAMED_MODEL_STORE_ENV = 'OLLAMA_MODELS';
export const NAMED_MODEL_HOST_ENV = 'OLLAMA_HOST';

function normalizeModelId(modelId: string): string {
  const trimmed = String(modelId ?? '').trim();
  if (!trimmed) {
    throw new Error('Named model id must not be blank');
  }
  return trimmed;
}

function normalizeStorePath(modelStorePath?: string): string {
  return path.resolve(modelStorePath ?? DEFAULT_MODEL_STORE_PATH);
}

function normalizeEndpointUrl(endpointUrl?: string): string {
  return (endpointUrl ?? DEFAULT_NAMED_MODEL_ENDPOINT_URL).trim();
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function endpointHostPort(endpointUrl: string): string {
  try {
    return new URL(endpointUrl).host;
  } catch {
    return endpointUrl.replace(/^https?:\/\//, '');
  }
}

function ensureStorePathOutsideRepo(repoRoot: string | undefined, modelStorePath: string): void {
  if (!repoRoot) {
    return;
  }
  const canonicalRepoRoot = tryRealpath(repoRoot);
  const canonicalStorePath = tryRealpath(modelStorePath);
  if (isPathInside(canonicalStorePath, canonicalRepoRoot)) {
    throw new Error(
      `Named model store must live outside the tracked worktree: ${canonicalStorePath} is inside ${canonicalRepoRoot}`
    );
  }
}

export function buildNamedModelPullPlan(
  modelId: string,
  options: NamedModelPullOptions = {}
): NamedModelPullPlan {
  const normalizedModelId = normalizeModelId(modelId);
  const modelStorePath = normalizeStorePath(options.modelStorePath);
  ensureStorePathOutsideRepo(options.repoRoot, modelStorePath);

  if (options.availableModelIds && !options.availableModelIds.includes(normalizedModelId)) {
    throw new Error(`Unknown named model "${normalizedModelId}"`);
  }

  const ready = options.presentModelIds?.includes(normalizedModelId) ?? false;
  const environment = { [NAMED_MODEL_STORE_ENV]: modelStorePath };

  if (ready) {
    return {
      modelId: normalizedModelId,
      modelStorePath,
      environment,
      writePaths: [modelStorePath],
      command: null,
      shouldDownload: false,
      ready: true,
      message: `Model "${normalizedModelId}" is already present at ${modelStorePath}`,
    };
  }

  return {
    modelId: normalizedModelId,
    modelStorePath,
    environment,
    writePaths: [modelStorePath],
    command: `${NAMED_MODEL_STORE_ENV}=${shellQuote(modelStorePath)} ollama pull ${shellQuote(normalizedModelId)}`,
    shouldDownload: true,
    ready: false,
    message: `Pull model "${normalizedModelId}" into ${modelStorePath}`,
  };
}

export function isNamedModelHealthy(probe: NamedModelEndpointProbe): NamedModelHealth {
  const endpointUrl = normalizeEndpointUrl(probe.endpointUrl);
  if (probe.endpointStatus === 'healthy') {
    return {
      ready: true,
      endpointUrl,
      reason: 'OpenAI-compatible loopback endpoint is ready',
    };
  }
  return {
    ready: false,
    endpointUrl,
    reason:
      probe.reason ??
      (probe.endpointStatus === 'missing'
        ? `could not reach ${endpointUrl}`
        : `endpoint ${endpointUrl} is not healthy`),
  };
}

export function formatNamedModelStatus(health: NamedModelHealth): string {
  return health.ready
    ? `ready at ${health.endpointUrl}`
    : `not ready: could not reach ${health.endpointUrl}${health.reason ? ` (${health.reason})` : ''}`;
}

export function buildNamedModelServePlan(
  modelId: string,
  probe: NamedModelEndpointProbe,
  options: NamedModelServeOptions = {}
): NamedModelServePlan {
  const normalizedModelId = normalizeModelId(modelId);
  const health = isNamedModelHealthy({
    endpointStatus: probe.endpointStatus,
    endpointUrl: normalizeEndpointUrl(options.endpointUrl ?? probe.endpointUrl),
    reason: probe.reason,
  });

  if (health.ready) {
    return {
      modelId: normalizedModelId,
      endpointUrl: health.endpointUrl,
      command: null,
      shouldStartServer: false,
      ready: true,
      message: formatNamedModelStatus(health),
    };
  }

  return {
    modelId: normalizedModelId,
    endpointUrl: health.endpointUrl,
    command: `${NAMED_MODEL_HOST_ENV}=${shellQuote(endpointHostPort(health.endpointUrl))} ollama serve`,
    shouldStartServer: true,
    ready: false,
    message: formatNamedModelStatus(health),
  };
}
