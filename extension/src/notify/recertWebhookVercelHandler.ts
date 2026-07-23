// BL-288: the thin Vercel serverless wrapper around BL-217/BL-248's already-
// tested handleInboundEmailWebhook core. Owns ONLY platform adaptation -
// raw-body extraction, header mapping, env-sourced deps assembly, and
// status/body -> HTTP response - never re-implements verify/parse/propose.
//
// CRITICAL (the #1 serverless-Svix pitfall): Vercel's default body parser
// JSON-parses then the framework would re-serialize on access, which
// silently breaks signature verification (svixSignature.ts checks the EXACT
// signed bytes). `config.api.bodyParser = false` below disables that, and
// readRawBody reads the untouched request stream instead.
import { IncomingMessage, ServerResponse } from 'http';
import {
  handleInboundEmailWebhook,
  HandleInboundEmailWebhookDeps,
  InboundWebhookRequest,
  InboundWebhookResponse,
} from './recertInboundWebhook';
import { SvixHeaders } from './svixSignature';
import { commitRecertProposalToRepo, RepoCommitConfig, PutFn } from './recertProposalRepoCommit';

// Vercel's Node runtime reads this to disable its automatic JSON body
// parsing for this function - see the module docstring above.
export const config = { api: { bodyParser: false } };

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

// Pure: maps raw Node HTTP headers (Node always lower-cases incoming header
// names) plus the already-extracted raw body string into the core's own
// SvixHeaders/InboundWebhookRequest shape. Never touches rawBody itself -
// it is carried through byte-for-byte, which is what recert-handler-03
// guards against regressing.
export function toWebhookRequest(rawBody: string, headers: IncomingMessage['headers']): InboundWebhookRequest {
  const svixHeaders: SvixHeaders = {
    svixId: headerValue(headers['svix-id']),
    svixTimestamp: headerValue(headers['svix-timestamp']),
    svixSignature: headerValue(headers['svix-signature']),
  };
  return { headers: svixHeaders, rawBody };
}

// Pure: a comma-separated env var into a trimmed, non-empty allowlist.
// Missing/empty input -> [] - the core's own isSenderAllowed already fails
// closed on that (BL-248), so this never needs a separate "unconfigured"
// branch of its own.
export function parseSenderAllowlist(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export interface EnvDepsOptions {
  env: NodeJS.ProcessEnv;
  nowIso: string;
  log: (message: string) => void;
  // Injectable for tests, same seam commitRecertProposalToRepo already
  // exposes (PutFn) - defaults to a real network PUT via that function's
  // own default when omitted.
  putFn?: PutFn;
}

// Deterministic given the same env/nowIso/putFn: assembles the core's
// HandleInboundEmailWebhookDeps entirely from the serverless env (the
// deployment-agnostic posture BL-217/248 designed for - this function
// cannot and does not read any local host state). An absent
// RECERT_WEBHOOK_SECRET yields secret = '', which verifySvixSignature can
// never match against a real signature, so the handler commits nothing
// (recert-handler-04) without this file needing its own separate gate.
export function depsFromEnv({ env, nowIso, log, putFn }: EnvDepsOptions): HandleInboundEmailWebhookDeps {
  const repoConfig: RepoCommitConfig = {
    owner: env.RECERT_GITHUB_OWNER ?? '',
    repo: env.RECERT_GITHUB_REPO ?? '',
    branch: env.RECERT_GITHUB_BRANCH || 'main',
    token: env.RECERT_GITHUB_TOKEN ?? '',
  };
  return {
    secret: env.RECERT_WEBHOOK_SECRET ?? '',
    nowIso,
    senderAllowlist: parseSenderAllowlist(env.RECERT_SENDER_ALLOWLIST),
    commitProposal: (proposal) => commitRecertProposalToRepo(proposal, repoConfig, Date.parse(nowIso), putFn),
    log,
  };
}

// The one impure boundary reading the platform's raw request stream -
// deliberately untested (mirrors this codebase's own "the real network
// call is the untested boundary" posture for defaultPut/default-post!)
// beyond the handler-level integration tests exercising it against a fake
// IncomingMessage.
export function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Pure: the core's {status, body} onto the platform HTTP response.
export function applyResponse(res: ServerResponse, result: InboundWebhookResponse): void {
  res.statusCode = result.status;
  res.end(result.body);
}

// The platform entry point itself - thin by construction: every step above
// is an independently exported, independently tested pure/adapter-injected
// helper; this function only sequences them (engineering "CLI main() must
// be a thin wrapper" applies to serverless handlers too, per the ticket).
// nowIso defaults to the real clock in production but is injectable so
// tests never seed a fixture timestamp against one clock while this
// function reads another (de0991e).
export async function recertWebhookHandler(
  req: IncomingMessage,
  res: ServerResponse,
  nowIso: string = new Date().toISOString()
): Promise<void> {
  const rawBody = await readRawBody(req);
  const request = toWebhookRequest(rawBody, req.headers);
  const deps = depsFromEnv({ env: process.env, nowIso, log: (message) => console.log(message) });
  const result = await handleInboundEmailWebhook(request, deps);
  applyResponse(res, result);
}
