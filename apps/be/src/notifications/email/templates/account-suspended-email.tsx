import { Text } from '@react-email/components';
import { EmailLayout } from '../email-layout.js';
import { code, text } from '../email-styles.js';

export interface AccountSuspendedEmailProps {
  readonly name: string;
  /** The administrator's own words, from `UsersService.ban`. */
  readonly reason: string;
}

/**
 * No button. Every other template ends in an action, and the action here would be
 * a link into a lobby this account can no longer enter.
 */
export const AccountSuspendedEmail = ({
  name,
  reason,
}: AccountSuspendedEmailProps) => (
  <EmailLayout
    preview="Your Firecracker account has been suspended."
    heading={`${name}, your account has been suspended`}
  >
    <Text style={text}>
      An administrator has suspended this account. You cannot sign in or place a
      bet while the suspension stands. Any settled round stays settled, and your
      balance is untouched.
    </Text>
    <Text style={text}>The reason given was:</Text>
    <Text style={code}>{reason}</Text>
    <Text style={text}>
      Reply to this message if you believe it was a mistake.
    </Text>
  </EmailLayout>
);

AccountSuspendedEmail.PreviewProps = {
  name: 'Ada',
  reason: 'Automated betting from a scripted client.',
} satisfies AccountSuspendedEmailProps;

export default AccountSuspendedEmail;
