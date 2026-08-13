import { useEffect, useState } from 'react';

export function useDominantColor(
  imageUrl?: string | null,
  defaultColor = '#3498db',
) {
  const [color, setColor] = useState(defaultColor);

  useEffect(() => {
    if (!imageUrl) {
      setColor(defaultColor);
      return;
    }

    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = imageUrl;

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // 3. Squash image to 1x1 pixel to get the average color
      canvas.width = 1;
      canvas.height = 1;
      ctx.drawImage(img, 0, 0, 1, 1);

      // 4. Read the color data
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      setColor(`rgb(${r},${g},${b})`);
    };

    img.onerror = () => {
      console.warn('Failed to extract color from avatar');
      setColor(defaultColor);
    };
  }, [imageUrl, defaultColor]);

  return color;
}
