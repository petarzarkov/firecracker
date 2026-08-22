import { Module } from '@dunx/core';
import { ImagesModule } from '@dunx/infra/images';
import { AppConfigService } from '../../config/app.config.service.js';

/**
 * `Bun.Image` behind an injectable `Images`, with the limits taken from validated
 * config rather than from constants scattered through a helper.
 *
 * The limits are the point of the pipeline: `maxPixels` refuses a decompression bomb
 * before pixels are allocated, and `allowedFormats` refuses a format the app does not
 * want even when Bun can decode it.
 *
 * `exports: [ImagesModule]` names the class, which resolves to the configuration
 * imported beside it.
 */
@Module({
  global: true,
  imports: [
    ImagesModule.forRootAsync({
      useFactory: (config: AppConfigService) => {
        const settings = config.get('images');
        return { quality: settings.quality, maxWidth: settings.maxWidth };
      },
      inject: [AppConfigService] as const,
    }),
  ],
  exports: [ImagesModule],
})
export class ImagesConfigModule {}
