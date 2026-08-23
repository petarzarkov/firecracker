import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Text,
} from '@react-email/components';
import type { ReactNode } from 'react';
import { brand, container, footer, h1, hr, main } from './email-styles.js';

export interface EmailLayoutProps {
  /**
   * The line an inbox shows next to the subject. Written per template, because the
   * default - whatever the first `<Text>` happens to start with - is how a preview
   * ends up reading "Hello {name}, we received a request to".
   */
  readonly preview: string;
  readonly heading: string;
  readonly children: ReactNode;
}

/**
 * The chrome every message shares, kept **out of `templates/`** on purpose: the
 * preview server treats every file in that directory as an email to render, and a
 * layout has no props of its own to render with.
 */
export const EmailLayout = ({
  preview,
  heading,
  children,
}: EmailLayoutProps) => (
  <Html lang="en">
    <Head />
    <Preview>{preview}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>Firecracker</Text>
        <Heading style={h1}>{heading}</Heading>
        {children}
        <Hr style={hr} />
        <Text style={footer}>
          Firecracker is a provably-fair crash game. Every round publishes its
          server seed once it has settled, so the result can be re-run.
        </Text>
      </Container>
    </Body>
  </Html>
);
