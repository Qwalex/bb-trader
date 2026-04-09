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
    const sensitiveName = /(secret|key|token|password|session|hash)/i;
    const redacted = rows.map((r) =>
      sensitiveName.test(r.key)
        ? { key: r.key, value: r.value ? '***' : '' }
        : { key: r.key, value: r.value },
    );
    return { settings: redacted };
  }

  /** Full values for local dashboard (guarded by API auth). */
  @ApiOperation({ summary: 'Список настроек без маскировки (raw)' })
  @ApiOkResponse({ description: 'Raw-настройки получены' })
  @Get('raw')
  async listRaw() {
    return { settings: await this.settings.list() };
  }

  @ApiOperation({ summary: 'Заметки / todo дашборда (из БД)' })
  @ApiOkResponse({ description: 'Список пунктов' })
  @Get('dashboard-todos')
  async dashboardTodosGet() {
    return { items: await this.settings.getDashboardTodos() };
  }

  @ApiOperation({ summary: 'Сохранить заметки дашборда' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'text'],
            properties: {
              id: { type: 'string' },
              text: { type: 'string' },
            },
          },
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Сохранено' })
  @Put('dashboard-todos')
  async dashboardTodosPut(@Body() body: { items?: unknown }) {
    const items = this.settings.normalizeDashboardTodosPayload(body?.items);
    await this.settings.setDashboardTodos(items);
    return { ok: true };
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

  @ApiOperation({ summary: 'Очистить скомпрометированные секреты (после incident)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { confirm: { type: 'boolean', example: true } },
    },
  })
  @ApiBadRequestResponse({ description: 'Не передано confirm=true' })
  @ApiOkResponse({ description: 'Секреты очищены' })
  @Post('incident/purge-secrets')
  async purgeCompromisedSecrets(@Body() body: { confirm?: boolean }) {
    if (body?.confirm !== true) {
      throw new BadRequestException(
        'Укажите { "confirm": true } для очистки скомпрометированных секретов',
      );
    }
    const result = await this.settings.purgeCompromisedSecrets();
    return { ok: true, ...result };
  }
}
