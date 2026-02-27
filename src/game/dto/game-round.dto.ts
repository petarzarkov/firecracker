import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageOptionsDto } from '@/core/pagination/dto/page-options.dto';
import { GameRoundStatus } from '../enum/game-round-status.enum';

export class GameRoundResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: GameRoundStatus }) status!: GameRoundStatus;
  @ApiProperty() seedHash!: string;
  @ApiProperty() nonce!: number;
  @ApiPropertyOptional({ description: 'Revealed only after crash' })
  seed?: string;
  @ApiPropertyOptional({
    description: 'Crash point — revealed only after crash',
  })
  crashPoint?: number;
  @ApiPropertyOptional({
    description:
      'Combined client seed used for crash point derivation — always public',
  })
  clientSeed?: string;
  @ApiPropertyOptional() waitingEndsAt?: Date;
  @ApiPropertyOptional() startedAt?: Date;
  @ApiPropertyOptional() crashedAt?: Date;
  @ApiProperty() createdAt!: Date;
}

export class CurrentRoundResponseDto extends GameRoundResponseDto {
  @ApiPropertyOptional({
    description: 'Current multiplier (only when RUNNING)',
  })
  multiplier?: number;
  @ApiPropertyOptional({ description: 'Elapsed ms since round started' })
  elapsed?: number;
}

export class VerifyRoundResponseDto {
  @ApiProperty({ description: 'Round UUID' }) roundId!: string;
  @ApiProperty({ description: 'Server seed (revealed after crash)' })
  serverSeed!: string;
  @ApiProperty({ description: 'Combined client seed used in derivation' })
  clientSeed!: string;
  @ApiProperty({ description: 'Per-round nonce' }) nonce!: number;
  @ApiProperty({ description: 'Derived crash point' }) crashPoint!: number;
  @ApiProperty({
    description: [
      'Verification steps:',
      '1. assert SHA256(serverSeed) === seedHash',
      '2. hash = HMAC-SHA256(key=serverSeed, msg=clientSeed + ":" + nonce)',
      '3. h = parseInt(hash.slice(0, 13), 16)',
      '4. e = 2 ** 52',
      '5. if h % 33 === 0 → crashPoint = 1.00',
      '   else → crashPoint = Math.max(1.0, Math.floor((99 * e) / (e - h)) / 100)',
    ].join('\n'),
  })
  formula!: string;
}

export class ListRoundsQueryDto extends PageOptionsDto {}
