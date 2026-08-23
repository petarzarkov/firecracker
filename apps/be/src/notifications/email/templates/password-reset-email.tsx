import { Button, Section, Text } from '@react-email/components';
import { EmailLayout } from '../email-layout.js';
import { button, code, section, text } from '../email-styles.js';

export interface PasswordResetEmailProps {
  readonly name: string;
  /** better-auth's one-time link, already carrying the token and `redirectTo`. */
  readonly resetUrl: string;
}

export const PasswordResetEmail = ({
  name,
  resetUrl,
}: PasswordResetEmailProps) => (
  <EmailLayout
    preview="Choose a new Firecracker password."
    heading={`Hello ${name},`}
  >
    <Text style={text}>
      Somebody asked to reset the password on this account. If that was you,
      choose a new one with the button below. The link works once, and stops
      working within the hour.
    </Text>
    <Section style={section}>
      <Button style={button} href={resetUrl}>
        Reset password
      </Button>
    </Section>
    <Text style={text}>
      If the button does nothing, paste this into your browser:
    </Text>
    <Text style={code}>{resetUrl}</Text>
    <Text style={text}>
      If it was not you, ignore this message - nothing changes until the link is
      used, and your current password still works.
    </Text>
  </EmailLayout>
);

PasswordResetEmail.PreviewProps = {
  name: 'Ada',
  resetUrl:
    'http://localhost:3001/api/auth/reset-password/2f8c1b?callbackURL=%2F',
} satisfies PasswordResetEmailProps;

export default PasswordResetEmail;
