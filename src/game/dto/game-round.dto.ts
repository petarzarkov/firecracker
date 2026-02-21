import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageOptionsDto } from '@/core/pagination/dto/page-options.dto';
import { GameRoundStatus } from '../enum/game-round-status.enum';

export class GameRoundResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: GameRoundStatus }) status!: GameRoundStatus;
  @ApiProperty() seedHash!: string;
  @ApiPropertyOptional({ description: 'Revealed only after crash' })
  seed?: string;
  @ApiPropertyOptional({
    description: 'Crash point — revealed only after crash',
  })
  crashPoint?: number;
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

export class ListRoundsQueryDto extends PageOptionsDto {}
