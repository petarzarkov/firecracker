import { z } from 'zod';

/**
 * Outbound email, through Resend.
 *
 * A vendor SDK rather than the webhook `POST` this used to be, because the thing
 * being sent is no longer a string: a template is a React tree, and rendering it to
 * HTML *and* a plain-text alternative is work every provider needs done and none of
 * them does for you. Resend takes both in one call.
 *
 * Absent by default, and `EmailService` degrades rather than failing - so the queue
 * still demonstrably delivers a job to a worker on a machine with nothing set up,
 * and a fresh clone boots.
 */
export const notificationVarsSchema = z.object({
  RESEND_API_KEY: z
    .string()
    .optional()
    .describe(
      'Unset logs that a message would have been sent, and sends nothing.',
    ),
  /**
   * `onboarding@resend.dev` is Resend's shared sandbox sender: it needs no verified
   * domain and delivers **only to the account owner's own address**, which is what
   * makes it a usable default and an unusable production value.
   */
  EMAIL_SENDER: z
    .string()
    .default('Firecracker <onboarding@resend.dev>')
    .describe('The `From` header. `Name <address>` is accepted.'),

  /**
   * Slack, for service notices. Both halves or nothing: a token with no channel
   * has nowhere to post, so `SlackService` reports itself unconfigured either way.
   */
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_CHANNEL: z.string().optional(),
});
