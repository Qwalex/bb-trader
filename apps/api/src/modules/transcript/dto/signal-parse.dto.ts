import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class SignalParseDto {
  @IsString()
  pair!: string;

  @IsIn(['long', 'short'])
  direction!: 'long' | 'short';

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  @Type(() => Number)
  entries?: number[];

  @IsNumber()
  stopLoss!: number;

  @IsArray()
  @IsNumber({}, { each: true })
  @Type(() => Number)
  takeProfits!: number[];

  @IsNumber()
  @Min(1)
  leverage!: number;

  /** Номинал в USDT; 0 = не задано в USDT (тогда % или дефолт из DEFAULT_ORDER_USD) */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  orderUsd?: number;

  /** Режим «доля депозита»; если не используется — 0 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  capitalPercent?: number;

  @IsOptional()
  @IsString()
  source?: string;
}
