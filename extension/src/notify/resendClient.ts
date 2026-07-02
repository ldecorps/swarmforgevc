// Thin wrapper around the Resend REST API (BL-073). The extension host owns
// this I/O; postFn is injectable so tests never make a real network call and
// never need a real API key.
const RESEND_API_URL = 'https://api.resend.com/emails';

export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
}

export interface SendEmailResult {
  success: boolean;
  error?: string;
}

export interface PostResponse {
  ok: boolean;
  status: number;
}

export type PostFn = (url: string, body: string, apiKey: string) => Promise<PostResponse>;

async function defaultPost(url: string, body: string, apiKey: string): Promise<PostResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body,
  });
  return { ok: res.ok, status: res.status };
}

// Never includes apiKey (or any header) in the returned result: failures must
// be logged and diagnosable without leaking the secret (constitution + BL-073
// non-behavioral gate).
export async function sendResendEmail(
  apiKey: string,
  message: EmailMessage,
  postFn: PostFn = defaultPost
): Promise<SendEmailResult> {
  const body = JSON.stringify({
    from: message.from,
    to: [message.to],
    subject: message.subject,
    text: message.text,
  });

  try {
    const res = await postFn(RESEND_API_URL, body, apiKey);
    if (!res.ok) {
      return { success: false, error: `Resend API responded with status ${res.status}` };
    }
    return { success: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error';
    return { success: false, error: `Resend request failed: ${detail}` };
  }
}
