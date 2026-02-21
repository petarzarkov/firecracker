import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { SanitizedUser } from '@/users/entity/user.entity';

export class AuthResponseDto {
  @ApiProperty({
    description: 'jwt token',
  })
  @IsString()
  accessToken!: string;

  @ApiProperty({
    description: 'authenticated user',
    type: () => SanitizedUser,
  })
  user!: SanitizedUser;
}
