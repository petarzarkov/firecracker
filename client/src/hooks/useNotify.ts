import { toaster } from '@/components/Toaster';

export const useNotify = () => {
  const notify = (
    title: string,
    description?: string,
    type: 'success' | 'error' | 'info' = 'info',
  ) => {
    toaster.create({
      title,
      description,
      type,
    });
  };

  return { notify };
};
