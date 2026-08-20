import { Module } from '@dunx/core';
import { ImagesModule } from '@dunx/infra/images';
import { AppConfigService } from '../../config/app.config.service.js';

/** Hoisted, so the decorator below can both import and re-export one reference. */
const images = ImagesModule.forRootAsync({
  useFactory: (config: AppConfigService) => {
    const settings = config.get('images');
    return { quality: settings.quality, maxWidth: settings.maxWidth };
  },
  inject: [AppConfigService] as const,
});

/**
 * `Bun.Image` behind an injectable `Images`, with the limits taken from validated
 * config rather than from constants scattered through a helper.
 *
 * The NestJS template read image dimensions with `new Bun.Image(buffer).metadata()`
 * inside a `@Global()` helpers service and had no resize, no re-encode and no
 * thumbnails. This has the same native engine and adds a pipeline: `maxPixels`
 * refuses a decompression bomb before pixels are allocated, and `allowedFormats`
 * refuses a format the app does not want even when Bun can decode it.
 */
@Module({ global: true, imports: [images], exports: [images] })
export class ImagesConfigModule {}
