// BL-217: commits a recertification proposal into a durable, committed repo
// location (backlog/recert-inbox/<scenarioId>-<timestamp>.json, one file per
// change) via GitHub's Contents API - the serverless function has no access
// to the local host's .swarmforge/ state, so this is a git-write, not a
// filesystem write. bridgeRecertProposals (bridge-recert-proposals.ts) is
// the host-side counterpart that ingests these into BL-150's existing
// .swarmforge/recert_proposals/ seam.
//
// putFn is injectable, mirroring resendClient.ts's PostFn seam - tests never
// make a real network call and never need a real token.

import { RecertProposal } from '../docs/recertification';

export interface RepoCommitConfig {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

export interface PutResponse {
  ok: boolean;
  status: number;
}

export type PutFn = (url: string, body: string, token: string) => Promise<PutResponse>;

async function defaultPut(url: string, body: string, token: string): Promise<PutResponse> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body,
  });
  return { ok: res.ok, status: res.status };
}

export function recertProposalCommitPath(proposal: RecertProposal, nowMs: number): string {
  const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-');
  return `backlog/recert-inbox/${proposal.scenarioId}-${stamp}.json`;
}

export async function commitRecertProposalToRepo(
  proposal: RecertProposal,
  config: RepoCommitConfig,
  nowMs: number = Date.now(),
  putFn: PutFn = defaultPut
): Promise<void> {
  const path = recertProposalCommitPath(proposal, nowMs);
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`;
  const content = Buffer.from(JSON.stringify(proposal, null, 2), 'utf8').toString('base64');
  const body = JSON.stringify({
    message: `Recert proposal: ${proposal.outcome} ${proposal.scenarioId}`,
    content,
    branch: config.branch,
  });

  const res = await putFn(url, body, config.token);
  if (!res.ok) {
    // Never include the token in a thrown message (constitution secrets
    // rule + resendClient.ts's own precedent) - only status is safe to echo.
    throw new Error(`GitHub contents API responded with status ${res.status}`);
  }
}
