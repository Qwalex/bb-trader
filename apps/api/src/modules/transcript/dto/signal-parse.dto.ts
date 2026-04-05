import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
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
  @Min(0.0000001, { each: true })
  @Type(() => Number)
  entries?: number[];

  /** Одна зона входа [low, high], не DCA */
  @IsOptional()
  @IsBoolean()
  entryIsRange?: boolean;

  @IsNumber()
  @Min(0.0000001)
  stopLoss!: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsNumber({}, { each: true })
  @Min(0.0000001, { each: true })
  @Type(() => Number)
  takeProfits!: number[];

  @IsNumber()
  @Min(1)
  @Transform(({ value }) => (typeof value === 'number' ? Math.round(value) : value))
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
  @Max(100)
  @Type(() => Number)
  capitalPercent?: number;

  @IsOptional()
  @IsString()
  source?: string;
}
