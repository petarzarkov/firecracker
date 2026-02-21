import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';

interface ProviderModels {
  provider: string;
  models: string[];
}

export function useAIModels() {
  const [providers, setProviders] = useState<ProviderModels[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const token = useAuthStore(state => state.token);

  useEffect(() => {
    const fetchModels = async () => {
      if (!token) {
        setError('Not authenticated');
        setLoading(false);
        return;
      }

      try {
        const response = await fetch('/api/ai/models', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data: ProviderModels[] = await response.json();
          setProviders(data);
          setError(null);
        } else {
          setError('Failed to fetch models');
        }
      } catch (err) {
        console.error('Failed to fetch AI models:', err);
        setError('Network error');
      } finally {
        setLoading(false);
      }
    };

    fetchModels();
  }, [token]);

  return { providers, loading, error };
}
