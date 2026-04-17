import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

function coerceOptionalNonNegNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

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

  /** Одна зона входа [low, high], не DCA */
  @IsOptional()
  @IsBoolean()
  entryIsRange?: boolean;

  @IsNumber()
  stopLoss!: number;

  @IsArray()
  @IsNumber({}, { each: true })
  @Type(() => Number)
  takeProfits!: number[];

  @IsNumber()
  @Min(1)
  leverage!: number;

  /** Диапазон плеча [min, max], если источник дал интервал вместо одного значения. */
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  @Type(() => Number)
  leverageRange?: number[];

  /** Номинал в USDT; 0 = не задано в USDT (тогда % или дефолт из DEFAULT_ORDER_USD) */
  @IsOptional()
  @Transform(({ value }) => coerceOptionalNonNegNumber(value))
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  orderUsd?: number;

  /** Режим «доля депозита»; если не используется — 0; см. BybitService при >100 */
  @IsOptional()
  @Transform(({ value }) => coerceOptionalNonNegNumber(value))
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  @Type(() => Number)
  capitalPercent?: number;

  @IsOptional()
  @IsString()
  source?: string;
}
