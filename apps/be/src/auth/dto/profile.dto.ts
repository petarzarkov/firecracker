import type { RouteSchemas } from '@dunx/http';
import { z } from 'zod';

/**
 * Where a new avatar comes from.
 *
 * A union rather than two optional fields, so "both" and "neither" are shapes the
 * route cannot be sent. `fileId` names an object the caller uploaded through
 * `POST /api/files` - the server checks who owns it, because this is an id the
 * client chose. `url` is the other half of the same picker: the trending BetterTTV
 * emotes and the custom-URL field have always written a URL into `users.image`, and
 * sign-up still does through better-auth.
 */
export const AvatarSource = z
  .union([
    z.object({ fileId: z.uuid() }),
    z.object({
      // `http(s)` only. `new URL()` - and so `z.url()` - accepts `javascript:`, and
      // this string is handed to other players' browsers as an image source.
      url: z.url({ protocol: /^https?$/ }).max(2048),
    }),
  ])
  .meta({
    id: 'AvatarSource',
    title: 'An object the caller owns, or a URL they chose',
  });
export type AvatarSource = z.infer<typeof AvatarSource>;

export const AvatarUpdated = z
  .object({ picture: z.string() })
  .meta({ id: 'AvatarUpdated', title: 'The caller’s avatar after the change' });
export type AvatarUpdated = z.infer<typeof AvatarUpdated>;

/**
 * The handler answers a `Response` of its own - better-auth's refreshed session
 * cookie has to ride back with it - so `response` is the only thing that documents
 * the body. dunx never validates it, which is why the shape is also the return type
 * of what builds it.
 */
export const setAvatar = {
  body: AvatarSource,
  status: 200,
  response: { 200: AvatarUpdated },
} as const satisfies RouteSchemas;

/**
 * The **file** id, not a user id, and that is what keeps a replaced avatar out of
 * a browser cache: a new object is a new URL, so the old one is never asked for
 * again.
 */
export const avatarFile = {
  params: z.object({ fileId: z.uuid() }),
} as const satisfies RouteSchemas;
