import * as http from 'http';
import type { DeviceRegistry } from './deviceRegistry';
import {
  AGENT_NOTE_USER_MESSAGE_MAX_LEN,
  decideAgentNoteSend,
  isAgentNoteRequestShape,
} from './agentNotesCore';

export const AGENT_NOTES_WRITE_MAX_BODY_BYTES = 4 * 1024;

export function isAgentNotesWriteRoute(req: http.IncomingMessage, url: string): boolean {
  return req.method === 'POST' && url === '/agent-notes';
}

export interface AgentNotesRoute {
  matches: (req: http.IncomingMessage, url: string) => boolean;
  handle: (req: http.IncomingMessage, res: http.ServerResponse, targetPath: string, registry: DeviceRegistry) => void;
}

export function createAgentNotesRoutes(
  requireControlAuth: (req: http.IncomingMessage, res: http.ServerResponse, registry: DeviceRegistry) => boolean,
  respond: (res: http.ServerResponse, status: number, body: unknown) => void,
  readValidatedBody: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    maxBytes: number,
    isShape: (value: unknown) => value is { role: string; message: string },
    shapeErrorReason: string
  ) => Promise<{ role: string; message: string } | null>
): AgentNotesRoute[] {
  return [
    {
      matches: isAgentNotesWriteRoute,
      handle: (req, res, targetPath, registry) => {
        if (!requireControlAuth(req, res, registry)) {
          return;
        }
        readValidatedBody(
          req,
          res,
          AGENT_NOTES_WRITE_MAX_BODY_BYTES,
          isAgentNoteRequestShape,
          'expected a JSON body of {role, message}'
        ).then(async (value) => {
          if (!value) {
            return;
          }
          const result = await decideAgentNoteSend(targetPath, value);
          if (!result.success) {
            respond(res, 400, { success: false, reason: result.reason });
            return;
          }
          respond(res, 200, {
            success: true,
            role: result.role,
            message: result.message,
            userMessageMaxLen: AGENT_NOTE_USER_MESSAGE_MAX_LEN,
          });
        });
      },
    },
  ];
}
