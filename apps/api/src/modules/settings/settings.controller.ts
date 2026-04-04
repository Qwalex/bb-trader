import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { SettingsService } from './settings.service';

@ApiTags('Settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @ApiOperation({ summary: 'Список настроек (секреты замаскированы)' })
  @ApiOkResponse({ description: 'Настройки получены' })
  @Get()
  async list() {
    const rows = await this.settings.list();
    const redacted = rows.map((r) => ({
      key: r.key,
      value: SettingsService.redactValue(r.key, r.value),
    }));
    return { settings: redacted };
  }

  @ApiOperation({ summary: 'Получить выборку настроек по ключам' })
  @ApiQuery({
    name: 'keys',
    required: true,
    description: 'Список ключей через запятую',
  })
  @ApiOkResponse({ description: 'Настройки получены' })
  @Get('selected')
  async listSelected(@Query('keys') keysRaw?: string) {
    const keys = String(keysRaw ?? '')
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key.length > 0);
    if (keys.length === 0) {
      throw new BadRequestException('Укажите query-параметр keys=KEY1,KEY2');
    }
    const rows = await this.settings.getManyResolved(keys);
    return {
      settings: rows.map((row) => ({
        key: row.key,
        value: SettingsService.isSensitiveKey(row.key) ? '' : row.value,
        sensitive: SettingsService.isSensitiveKey(row.key),
        configured: row.value.trim().length > 0,
      })),
    };
  }

  @ApiOperation({ summary: 'Получить публичные настройки для UI' })
  @ApiOkResponse({ description: 'UI-настройки получены' })
  @Get('ui')
  async listUiSettings() {
    return {
      settings: await this.settings.getManyResolved([
        'SOURCE_LIST',
        'SOURCE_EXCLUDE_LIST',
        'DEFAULT_ORDER_USD',
        'DEFAULT_LEVERAGE',
        'SOURCE_MARTINGALE_DEFAULT_MULTIPLIER',
        'BUMP_TO_MIN_EXCHANGE_LOT',
      ]),
    };
  }

  @ApiOperation({ summary: 'Статусы чувствительных настроек' })
  @ApiOkResponse({ description: 'Статусы секретов получены' })
  @Get('sensitive-status')
  async listSensitiveStatus() {
    const rows = await this.settings.list();
    return {
      settings: rows
        .filter((row) => SettingsService.isSensitiveKey(row.key))
        .map((row) => ({
          key: row.key,
          configured: row.value.trim().length > 0,
        })),
    };
  }

  @ApiOperation({ summary: 'Создать/обновить одну настройку' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['key', 'value'],
      properties: {
        key: { type: 'string' },
        value: { type: 'string' },
      },
    },
  })
  @ApiOkResponse({ description: 'Настройка сохранена' })
  @Put()
  async upsert(@Body() body: { key: string; value: string }) {
    const key = String(body?.key ?? '').trim();
    if (!key) {
      throw new BadRequestException('key обязателен');
    }
    if (!SettingsService.canWriteKey(key)) {
      throw new BadRequestException(`Ключ ${key} не поддерживается для записи`);
    }
    await this.settings.set(key, String(body?.value ?? ''));
    return { ok: true };
  }

  /**
   * Сброс локальной БД (SQLite). Только для панели настроек; без отдельной auth.
   * Тело: `{ "confirm": true }`.
   */
  @ApiOperation({ summary: 'Сброс локальной базы данных' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { confirm: { type: 'boolean', example: true } },
    },
  })
  @ApiBadRequestResponse({ description: 'Не передано confirm=true' })
  @ApiOkResponse({ description: 'База сброшена' })
  @Post('reset-database')
  @HttpCode(200)
  async resetDatabase(@Body() body: { confirm?: boolean }) {
    if (body?.confirm !== true) {
      throw new BadRequestException(
        'Укажите { "confirm": true } для подтверждения сброса базы',
      );
    }
    await this.settings.resetAllData();
    return { ok: true };
  }
}
