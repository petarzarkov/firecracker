import type { TestServer } from '@dunx/testing';

/**
 * How a suite authenticates - the same way any non-browser client does.
 *
 * A test client has no cookie jar, which is what better-auth's `bearer` plugin is for:
 * the session token comes back in `set-auth-token`, and `Authorization: Bearer` is
 * accepted everywhere the cookie would be. So the suites go through the real sign-in
 * endpoint rather than a test-only door.
 */
export class TestSession {
  /** Signs in and returns the token the `bearer` plugin hands back. */
  static async signIn(
    server: TestServer,
    email: string,
    password: string,
  ): Promise<string> {
    const response = await server.request('api/auth/sign-in/email', {
      method: 'POST',
      json: { email, password },
    });
    const token = response.headers.get('set-auth-token');
    if (token === null) {
      throw new Error(
        `sign-in failed for ${email}: ${response.status} ${await response.text()}`,
      );
    }
    return token;
  }

  static bearer(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}` };
  }

  /** Creates a user through the public sign-up endpoint and signs it in. */
  static async signUp(
    server: TestServer,
    email: string,
    password: string,
    name = 'Test User',
  ): Promise<{ token: string; userId: string }> {
    const response = await server.request('api/auth/sign-up/email', {
      method: 'POST',
      json: { email, password, name },
    });
    if (!response.ok) {
      throw new Error(
        `sign-up failed for ${email}: ${response.status} ${await response.text()}`,
      );
    }
    const body = (await response.json()) as { user: { id: string } };
    return {
      token: await TestSession.signIn(server, email, password),
      userId: body.user.id,
    };
  }
}
