// Shared fetch-call construction for the two Authorization-header POST
// clients (notify/resendClient.ts, i18n/mtEngine.ts) - each keeps its own
// PostFn/PostResponse injectable-seam type and response mapping (their
// shapes differ: mtEngine's needs a json() passthrough, resendClient's
// doesn't), so only the actual duplicated fetch() construction moves here.
export async function authenticatedPost(url: string, body: string, authHeader: string): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body,
  });
}
