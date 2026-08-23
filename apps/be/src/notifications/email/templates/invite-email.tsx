import { Button, Section, Text } from '@react-email/components';
import type { UserRole } from '@firecracker/contracts';
import { EmailLayout } from '../email-layout.js';
import { button, code, label, section, text, value } from '../email-styles.js';

export interface InviteEmailProps {
  readonly email: string;
  readonly inviteCode: string;
  readonly role: UserRole;
  /** Where the code is redeemed. Built by the caller, so the route can move. */
  readonly inviteUrl: string;
}

/**
 * **Nothing sends this yet.** The dunx tree has no invite table, no
 * `JOBS.USER_INVITED` and no controller to issue a code - the NestJS version did,
 * and this template is the half of it that was worth carrying across. It renders in
 * `bun run email` and is covered by `email.test.ts`; wiring it is a feature, not a
 * fix.
 */
export const InviteEmail = ({
  email,
  inviteCode,
  role,
  inviteUrl,
}: InviteEmailProps) => (
  <EmailLayout
    preview="You have been invited to Firecracker."
    heading="You have been invited"
  >
    <Text style={text}>
      Somebody invited {email} to Firecracker. Sign up with the code below and
      the account is created with the access it was invited for.
    </Text>
    <Text style={label}>Invite code</Text>
    <Text style={code}>{inviteCode}</Text>
    <Text style={label}>Access</Text>
    <Text style={value}>{role}</Text>
    <Section style={section}>
      <Button style={button} href={inviteUrl}>
        Accept the invite
      </Button>
    </Section>
  </EmailLayout>
);

InviteEmail.PreviewProps = {
  email: 'ada@example.com',
  inviteCode: 'FC-7Q2M-8XKD',
  role: 'user',
  inviteUrl: 'http://localhost:3001/?inviteCode=FC-7Q2M-8XKD',
} satisfies InviteEmailProps;

export default InviteEmail;
