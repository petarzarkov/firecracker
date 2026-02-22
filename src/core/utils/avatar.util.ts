export const getRandomBTTVEmote = async (size = '3x'): Promise<string> => {
  try {
    const response = await fetch(
      'https://api.betterttv.net/3/emotes/shared/trending?offset=0&limit=50',
    );
    const emotes = await response.json();

    if (Array.isArray(emotes) && emotes.length > 0) {
      const randomEmote = emotes[Math.floor(Math.random() * emotes.length)];
      if (randomEmote?.emote?.id) {
        return `https://cdn.betterttv.net/emote/${randomEmote.emote.id}/${size}`;
      }
    }
  } catch (error) {
    console.error('Failed to fetch BTTV emote:', error);
  }

  // Fallback to a default emote
  return 'https://cdn.betterttv.net/emote/5ada077451d4120ea3918426/3x';
};

export const getTrendingBTTVEmotes = async (limit = 20): Promise<string[]> => {
  try {
    const response = await fetch(
      `https://api.betterttv.net/3/emotes/shared/trending?limit=${limit}`,
    );
    const emotes = await response.json();

    if (Array.isArray(emotes)) {
      return emotes
        .filter(item => item?.emote?.id)
        .map(item => `https://cdn.betterttv.net/emote/${item.emote.id}/3x`);
    }
  } catch (error) {
    console.error('Failed to fetch trending BTTV emotes:', error);
  }

  return [];
};
