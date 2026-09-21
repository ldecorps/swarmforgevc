import { OAuth2Client } from 'google-auth-library';

export class OAuth2Authenticator {
  private client: OAuth2Client;

  constructor(clientId: string, clientSecret: string) {
    this.client = new OAuth2Client(clientId, clientSecret);
  }

  async authenticate(code: string): Promise<string> {
    const token = await this.client.getToken(code);
    return token.accessToken;
  }
}
