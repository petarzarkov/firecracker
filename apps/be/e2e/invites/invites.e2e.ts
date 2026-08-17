import { describe, expect, test } from 'bun:test';
import { getTestContext } from '../setup/context.js';

interface InvitePage {
  data: { id: string; email: string; role: string; status: string }[];
}

const uniqueEmail = () => `invitee-${crypto.randomUUID()}@example.com`;

/**
 * The whole point of the feature is that the **code** is the credential, and it
 * never appears in a listing - so an e2e cannot read it from the API. It comes off
 * the database, which is the same thing the email would carry.
 */
const codeFor = (email: string): string =>
  getTestContext().db.inviteCodeFor(email);

describe('invitations', () => {
  test('an admin invites, and the listing never leaks the code', async () => {
    const { api } = getTestContext();
    const email = uniqueEmail();

    const created = await api.post<{ email: string; status: string }>(
      'invites',
      { email, role: 'user' },
    );
    expect(created.status).toBe(201);
    expect(created.body.email).toBe(email);
    expect(created.body.status).toBe('pending');
    // The credential must not come back on the response either.
    expect(JSON.stringify(created.body)).not.toContain(codeFor(email));

    const listed = await api.json<InvitePage>('invites?take=50');
    expect(listed.status).toBe(200);
    const mine = listed.body.data.find((row) => row.email === email);
    expect(mine?.status).toBe('pending');
    expect(JSON.stringify(listed.body)).not.toContain(codeFor(email));
  });

  test('a code creates the account, at the role it granted', async () => {
    const { api, origin } = getTestContext();
    const email = uniqueEmail();
    await api.post('invites', { email, role: 'admin' });

    const accepted = await fetch(`${origin}/api/invites/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: codeFor(email),
        password: 'a-password-123',
      }),
    });
    expect(accepted.status).toBe(201);

    // The credential is real: the invited person can sign in with it.
    const signIn = await fetch(`${origin}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'a-password-123' }),
    });
    expect(signIn.status).toBe(200);

    // ...and at the role the invitation granted, not the sign-up default.
    const token = signIn.headers.get('set-auth-token');
    const profile = await fetch(`${origin}/api/profile`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const caller = (await profile.json()) as { roles: string[] };
    expect(caller.roles).toContain('admin');
  });

  test('a code cannot be used twice', async () => {
    const { api, origin } = getTestContext();
    const email = uniqueEmail();
    await api.post('invites', { email, role: 'user' });
    const code = codeFor(email);

    const accept = () =>
      fetch(`${origin}/api/invites/accept`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, password: 'a-password-123' }),
      });

    expect((await accept()).status).toBe(201);
    // Second time the invite is `accepted`, so the lookup finds nothing usable.
    expect((await accept()).status).toBe(400);
  });

  test('an unknown code is refused, and says nothing useful about why', async () => {
    const { origin } = getTestContext();
    const response = await fetch(`${origin}/api/invites/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: 'f'.repeat(64),
        password: 'a-password-123',
      }),
    });
    const body = (await response.json()) as { message: string };

    expect(response.status).toBe(400);
    // Deliberately the same message a used or expired code gets.
    expect(body.message).toBe('That invitation is not valid');
  });

  test('inviting an address that already has an account is a 409', async () => {
    const { api } = getTestContext();
    const email = uniqueEmail();

    // Create the account first, rather than assuming a seeded address: the e2e
    // seeds `admin@e2e-test.com`, and asserting against a literal that happens not
    // to exist would make this pass for the wrong reason.
    const created = await api.post('users', {
      email,
      name: 'Already Here',
      password: 'a-strong-password',
    });
    expect(created.status).toBe(201);

    const { status } = await api.post('invites', { email, role: 'user' });
    expect(status).toBe(409);
  });

  test('the invite routes are admin-only, but accepting is public', async () => {
    const { origin } = getTestContext();

    const listed = await fetch(`${origin}/api/invites`);
    expect(listed.status).toBe(401);

    // Reaches the handler and is refused on the code, not by the guard.
    const accepted = await fetch(`${origin}/api/invites/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: 'a'.repeat(64),
        password: 'a-password-123',
      }),
    });
    expect(accepted.status).toBe(400);
  });
});
