import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
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
    const redacted = rows.map((r) =>
      r.key.toLowerCase().includes('secret') ||
      r.key.toLowerCase().includes('key') ||
      r.key.toLowerCase().includes('token')
        ? { key: r.key, value: r.value ? '***' : '' }
        : { key: r.key, value: r.value },
    );
    return { settings: redacted };
  }

  /** Full values for local dashboard (no auth in plan). */
  @ApiOperation({ summary: 'Список настроек без маскировки (raw)' })
  @ApiOkResponse({ description: 'Raw-настройки получены' })
  @Get('raw')
  async listRaw() {
    return { settings: await this.settings.list() };
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
    await this.settings.set(body.key, body.value);
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
