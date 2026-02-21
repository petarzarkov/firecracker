import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { PageOptionsDto } from '@/core/pagination/dto/page-options.dto';
import { WalletTransactionType } from '../enum/wallet-transaction-type.enum';

export class CreateDepositSessionDto {
  @ApiProperty({ description: 'Amount to deposit in cents (min $1 = 100)' })
  @IsInt()
  @Min(100)
  @Max(10_000_00) // $10,000 max deposit
  amountCents!: number;
}

export class WithdrawDto {
  @ApiProperty({ description: 'Amount to withdraw in cents (min $1 = 100)' })
  @IsInt()
  @Min(100)
  amountCents!: number;
}

export class WalletResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() userId!: string;
  @ApiProperty({ description: 'Current balance in cents' })
  balanceCents!: number;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class DepositSessionResponseDto {
  @ApiProperty({
    description: 'Stripe PaymentIntent client secret for Stripe.js',
  })
  clientSecret!: string;
}

export class WalletTransactionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() walletId!: string;
  @ApiProperty({ enum: WalletTransactionType }) type!: WalletTransactionType;
  @ApiProperty() amountCents!: number;
  @ApiProperty() balanceAfterCents!: number;
  @ApiPropertyOptional() stripePaymentIntentId?: string;
  @ApiPropertyOptional() gameBetId?: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty() createdAt!: Date;
}

export class ListTransactionsQueryDto extends PageOptionsDto {}
