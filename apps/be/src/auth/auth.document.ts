import { betterAuthDocument } from '@dunx/auth';
import { betterAuth } from 'better-auth';
import type { AppConfig } from '../config/env.validation.js';
import { AuthOptions } from './auth.options.js';

export class AuthDocument {
  static for(config: AppConfig) {
    return betterAuthDocument(betterAuth(AuthOptions.base(config)), {
      basePath: AuthOptions.basePath(config.app.prefix),
    });
  }
}
