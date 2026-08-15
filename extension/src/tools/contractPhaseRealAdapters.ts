#!/usr/bin/env node
/**
 * BL-624: the REAL, untested-boundary implementation of
 * contractPhaseRelay.ts's ContractPhaseAdapters - clone, survey, propose,
 * negotiate, gate-check and commit+push, exactly the CLIs the ticket names
 * (contractSurvey/propose-onboarding-contract.js's own building blocks,
 * negotiate-onboarding-contract.js's runObject/runApprove, the compiled
 * onboarding-contract-gate.js), chained rather than reimplemented. Every
 * method is keyed by targetRepoUrl; the deterministic local clone directory
 * is derived the same way onboarderStateStore.ts derives its own per-target
 * state file path (slugifyTargetRepoUrl), so this file never needs a path
 * threaded through it from the caller.
 *
 * This is the ONE file in this slice that ever shells to git/claude/node -
 * unit tests fake ContractPhaseAdapters entirely (per the ticket's own
 * "clone/push effects faked in unit tests, real in the live QA pass"), so
 * nothing here needs (or gets) example-test coverage beyond what a live
 * onboarding run exercises.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { ContractPhaseAdapters, CloneResult, CommitAndPushResult } from '../onboarding/contractPhaseRelay';
import { GateDecision, ProposedContract, RepoSurveyFacts } from '../onboarding/contractTypes';
import { ApproveContractResult, ObjectToContractResult } from '../onboarding/negotiationTelegramRelay';
import { proposeContractFromSurvey } from '../onboarding/contractSurvey';
import { deriveUseCaseInventory } from '../onboarding/useCaseInventory';
import { parseContractYaml } from '../onboarding/contractView';
import { initializeTargetContract, initializeTargetUseCaseInventory } from '../config/targetBootstrap';
import { slugifyTargetRepoUrl } from '../onboarding/onboarderStateStore';
import { parseRepoSurveyFacts } from './propose-onboarding-contract';
import { runObjectAsOutcome, runApproveAsOutcome } from './negotiationOutcomeAdapters';

const CLAUDE_SURVEY_TIMEOUT_MS = 5 * 60 * 1000;

export function targetCloneDir(swarmRepoRoot: string, targetRepoUrl: string): string {
  return path.join(swarmRepoRoot, '.swarmforge', 'onboarding-clones', slugifyTargetRepoUrl(targetRepoUrl));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isAlreadyClonedRepo(localPath: string): boolean {
  return fs.existsSync(path.join(localPath, '.git'));
}

// Idempotent: a target already cloned (a retried "proceed" after an earlier
// failure downstream of the clone) is a no-op success, never a second
// clone attempt into a non-empty directory.
async function defaultCloneTarget(swarmRepoRoot: string, targetRepoUrl: string): Promise<CloneResult> {
  const localPath = targetCloneDir(swarmRepoRoot, targetRepoUrl);
  if (isAlreadyClonedRepo(localPath)) {
    return { ok: true };
  }
  try {
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    execFileSync('git', ['clone', targetRepoUrl, localPath], { stdio: 'pipe' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

function surveyPrompt(): string {
  return [
    'You are surveying a freshly cloned repository at the current working directory for SwarmForge onboarding.',
    "Read the repo's languages, top-level layout and README, and identify real use cases evidenced in its OWN code (never inferred from the README alone).",
    'No human-supplied project vision or backlog is available yet - write your own best short summary of the repo\'s apparent purpose (seedVision) and suggested first backlog items (initialBacklogSummary).',
    'Reply with ONLY a single JSON object, no prose, no code fence, matching exactly this shape:',
    '{"languages": string[], "layoutSummary": string, "readmeSummary": string, "seedVision": string, "initialBacklogSummary": string, "useCaseObservations": [{"name": string, "summary": string, "locations": string[]}]}',
  ].join('\n');
}

interface ClaudeCliPrintResult {
  is_error?: boolean;
  result?: string;
}

// Exported (behavior-preserving) so its parsing branches - clean JSON,
// prose-wrapped JSON needing the regex fallback, and no-JSON-found - are
// unit-testable directly, without shelling out to `claude` the way
// defaultSurveyRepo (its only caller) does.
export function extractJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = /\{[\s\S]*\}/.exec(text);
    if (!match) {
      throw new Error('no JSON object found in the survey output');
    }
    return JSON.parse(match[0]);
  }
}

// BL-624 architect bounce (backlog/evidence/BL-624-onboarder-survey-untrusted-agent-bounce-20260815.md):
// unlike claudeCliExecutor.ts's own --dangerously-skip-permissions (safe
// only because its cwd is always a disposable scratch copy), this agent's
// cwd is the real, untrusted onboarding target's clone, which later
// receives a real push with the box's own git credentials. Never blanket-
// skip permissions here - scope the agent to read-only tools instead, so
// adversarial content in the surveyed repo cannot make it exec commands,
// write/push files, or reach the network.
export function surveyCliArgs(): string[] {
  return ['-p', surveyPrompt(), '--output-format', 'json', '--allowedTools', 'Read,Glob,Grep'];
}

// The one genuinely agent-performed step (per contractSurvey.ts's own
// header: gathering RepoSurveyFacts is swarm/agent behavior, not a
// deterministic function) - mirrors pipelineReviewOracle.ts's own
// execFileSync('claude', ['-p', ..., '--output-format', 'json', ...]) call,
// except scoped read-only per surveyCliArgs() above rather than
// --dangerously-skip-permissions.
async function defaultSurveyRepo(swarmRepoRoot: string, targetRepoUrl: string): Promise<RepoSurveyFacts> {
  const localPath = targetCloneDir(swarmRepoRoot, targetRepoUrl);
  const stdout = execFileSync('claude', surveyCliArgs(), {
    cwd: localPath,
    encoding: 'utf8',
    timeout: CLAUDE_SURVEY_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout) as ClaudeCliPrintResult;
  if (parsed.is_error) {
    throw new Error('the survey agent reported an error');
  }
  const factsRaw = extractJsonObject(parsed.result ?? '');
  return parseRepoSurveyFacts(factsRaw, `claude survey of ${targetRepoUrl}`);
}

// Calls the SAME building blocks propose-onboarding-contract.ts's own
// main() calls - never a subprocess round-trip through a temp facts file,
// since the facts are already in memory here.
async function defaultProposeContract(swarmRepoRoot: string, targetRepoUrl: string, facts: RepoSurveyFacts): Promise<ProposedContract> {
  const localPath = targetCloneDir(swarmRepoRoot, targetRepoUrl);
  const contract = proposeContractFromSurvey(facts);
  await initializeTargetContract(localPath, contract);
  const inventory = deriveUseCaseInventory(facts);
  await initializeTargetUseCaseInventory(localPath, inventory);
  return contract;
}

async function defaultReadCurrentContract(swarmRepoRoot: string, targetRepoUrl: string): Promise<ProposedContract | undefined> {
  const localPath = targetCloneDir(swarmRepoRoot, targetRepoUrl);
  try {
    const raw = fs.readFileSync(path.join(localPath, '.swarmforge', 'contract.yaml'), 'utf8');
    return parseContractYaml(raw) ?? undefined;
  } catch {
    return undefined;
  }
}

// Wraps negotiationOutcomeAdapters.ts's own runObjectAsOutcome/
// runApproveAsOutcome, itself a wrapper over negotiate-onboarding-contract.ts's
// own runObject/runApprove (BL-381 invariant: this is the ONE real writer of
// negotiation state, never a second engine) - shared with buildRelayAdapters'
// own already-ended translation rather than duplicating it.
async function defaultNegotiateObject(swarmRepoRoot: string, targetRepoUrl: string, objection: string): Promise<ObjectToContractResult> {
  const localPath = targetCloneDir(swarmRepoRoot, targetRepoUrl);
  return runObjectAsOutcome(localPath, objection);
}

async function defaultNegotiateApprove(swarmRepoRoot: string, targetRepoUrl: string): Promise<ApproveContractResult> {
  const localPath = targetCloneDir(swarmRepoRoot, targetRepoUrl);
  return runApproveAsOutcome(localPath);
}

// Literally shells to the compiled onboarding-contract-gate.js, per the
// ticket's own wording ("the check shells to the existing onboarding
// contract gate") - a sibling file in this SAME compiled out/tools
// directory, so __dirname needs no repo-root math the way a cross-
// directory script reference (e.g. launchNegotiationRelayScriptPath) would.
function gateCliPath(): string {
  return path.join(__dirname, 'onboarding-contract-gate.js');
}

async function defaultCheckGate(swarmRepoRoot: string, targetRepoUrl: string): Promise<GateDecision> {
  const localPath = targetCloneDir(swarmRepoRoot, targetRepoUrl);
  try {
    const stdout = execFileSync('node', [gateCliPath(), localPath], { encoding: 'utf8' });
    return JSON.parse(stdout) as GateDecision;
  } catch (err) {
    return { decision: 'hold', reason: `the build-start gate check failed to run: ${errorMessage(err)}` };
  }
}

// BL-624 invariant 2: the ONLY caller of this adapter method is
// contractPhaseRelay.ts's runNegotiateApprove, and only after the gate
// itself has just returned 'allow' - this function has no opinion of its
// own about agreement state, it only pushes what is already committed
// locally (runApprove's own commit, via updateTargetContract) to the
// target's GitHub remote.
async function defaultCommitAndPush(swarmRepoRoot: string, targetRepoUrl: string): Promise<CommitAndPushResult> {
  const localPath = targetCloneDir(swarmRepoRoot, targetRepoUrl);
  try {
    execFileSync('git', ['-C', localPath, 'push'], { stdio: 'pipe' });
    const commitSha = execFileSync('git', ['-C', localPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    return { ok: true, commitSha };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export function createRealContractPhaseAdapters(swarmRepoRoot: string): ContractPhaseAdapters {
  return {
    cloneTarget: (targetRepoUrl) => defaultCloneTarget(swarmRepoRoot, targetRepoUrl),
    surveyRepo: (targetRepoUrl) => defaultSurveyRepo(swarmRepoRoot, targetRepoUrl),
    proposeContract: (targetRepoUrl, facts) => defaultProposeContract(swarmRepoRoot, targetRepoUrl, facts),
    readCurrentContract: (targetRepoUrl) => defaultReadCurrentContract(swarmRepoRoot, targetRepoUrl),
    negotiateObject: (targetRepoUrl, objection) => defaultNegotiateObject(swarmRepoRoot, targetRepoUrl, objection),
    negotiateApprove: (targetRepoUrl) => defaultNegotiateApprove(swarmRepoRoot, targetRepoUrl),
    checkGate: (targetRepoUrl) => defaultCheckGate(swarmRepoRoot, targetRepoUrl),
    commitAndPush: (targetRepoUrl) => defaultCommitAndPush(swarmRepoRoot, targetRepoUrl),
  };
}
