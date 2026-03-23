import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
} from '@nestjs/common';

import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

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
  @Get('raw')
  async listRaw() {
    return { settings: await this.settings.list() };
  }

  @Put()
  async upsert(@Body() body: { key: string; value: string }) {
    await this.settings.set(body.key, body.value);
    return { ok: true };
  }

  /**
   * Сброс локальной БД (SQLite). Только для панели настроек; без отдельной auth.
   * Тело: `{ "confirm": true }`.
   */
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
