import { AppError } from '@dunx/core';

/**
 * Boot fails with whatever `validate` throws, so this is the whole "config is wrong"
 * story - there is no hook to register and no second exception type.
 */
export class ConfigValidationError extends AppError {
  override name = 'ConfigValidationError';
}
