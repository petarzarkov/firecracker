import { Button, Section, Text } from '@react-email/components';
import { EmailLayout } from '../email-layout.js';
import { button, section, text } from '../email-styles.js';

export interface WelcomeEmailProps {
  readonly name: string;
  readonly webUrl: string;
}

export const WelcomeEmail = ({ name, webUrl }: WelcomeEmailProps) => (
  <EmailLayout
    preview="Your Firecracker account is ready."
    heading={`Welcome aboard, ${name}`}
  >
    <Text style={text}>
      Your account is ready. Every round opens with a betting window, the
      multiplier climbs, and it pays whatever it had reached when you cashed out
      - or nothing, if you were still holding when it blew.
    </Text>
    <Text style={text}>
      There is a demo balance waiting, so you can learn the curve before any of
      it costs you.
    </Text>
    <Section style={section}>
      <Button style={button} href={webUrl}>
        Enter the lobby
      </Button>
    </Section>
  </EmailLayout>
);

/**
 * What `bun run email` renders this with. A static object, not a sample drawn from
 * the database - the preview server runs with no container and no connection.
 */
WelcomeEmail.PreviewProps = {
  name: 'Ada',
  webUrl: 'http://localhost:3001',
} satisfies WelcomeEmailProps;

export default WelcomeEmail;
