import {
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsEmailDecorator } from '@/core/decorators/email.decorator';
import { PasswordDecorator } from '@/core/decorators/password.decorator';

export class RegisterWithEmailDto {
  @IsEmailDecorator()
  email!: string;

  @PasswordDecorator()
  password!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  displayName?: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  picture?: string;
}
