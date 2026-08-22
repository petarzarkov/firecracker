import type {
  AvatarSource,
  AvatarUpdated,
  UploadedFile,
} from '@firecracker/contracts';
import { apiFetch } from './api';

/**
 * Choosing an avatar, which is one call for a URL and two for a file.
 *
 * The upload is `POST /api/files` - the app's own object store, the same route an
 * admin would use - and it answers with an id. Nothing about that object is an
 * avatar yet: `POST /api/profile/avatar` is where the id becomes the caller's
 * picture, and where the server checks they own the file rather than trusting the
 * id it was handed.
 *
 * The thumbnail is not waited for. A WebP encode happens in a forked child, and
 * the avatar route serves the original until it lands.
 */
const message = async (response: Response): Promise<string> => {
  const body = (await response.json().catch(() => ({}))) as {
    message?: string;
    error?: string;
  };
  return body.message ?? body.error ?? `Request failed (${response.status})`;
};

export const chooseAvatar = async (
  source: AvatarSource,
): Promise<AvatarUpdated> => {
  const response = await apiFetch('/api/profile/avatar', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(source),
  });
  if (!response.ok) throw new Error(await message(response));
  return (await response.json()) as AvatarUpdated;
};

export const uploadAvatar = async (file: File): Promise<AvatarUpdated> => {
  const form = new FormData();
  form.set('file', file);
  // The key's prefix, and grouping only - `ProfilePictureService` decides what may
  // be served, from the column that names it.
  form.set('context', 'avatars');

  // No `content-type` header: the browser has to set the multipart boundary, and
  // naming the type here is how it gets left off.
  const response = await apiFetch('/api/files', { method: 'POST', body: form });
  if (!response.ok) throw new Error(await message(response));

  const { id } = (await response.json()) as UploadedFile;
  return chooseAvatar({ fileId: id });
};
