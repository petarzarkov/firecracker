import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageOptionsDto } from '@/core/pagination/dto/page-options.dto';
import { GameBetStatus } from '../enum/game-bet-status.enum';

export class GameBetResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() roundId!: string;
  @ApiProperty() userId!: string;
  @ApiProperty() betAmountCents!: number;
  @ApiProperty({ enum: GameBetStatus }) status!: GameBetStatus;
  @ApiPropertyOptional() cashedOutAt?: number;
  @ApiPropertyOptional() payoutCents?: number;
  @ApiProperty() createdAt!: Date;
}

export class ListMyBetsQueryDto extends PageOptionsDto {}
