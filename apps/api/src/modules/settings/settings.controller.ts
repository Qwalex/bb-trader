import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { SettingsService } from './settings.service';
import { pickRequestedCabinetId } from '../../common/cabinet-request.util';
import { CabinetContextService } from '../cabinet/cabinet-context.service';
import { CabinetService } from '../cabinet/cabinet.service';

type AuthReq = {
  headers?: Record<string, string | string[] | undefined>;
  auth?: { userId?: string; role?: string };
};

const ADMIN_ONLY_GLOBAL_KEYS = new Set<string>([
  'NAV_MENU_HIDDEN',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL_DEFAULT',
  'OPENROUTER_MODEL_TEXT',
  'OPENROUTER_MODEL_AI_ADVISOR',
  'OPENROUTER_MODEL_TEXT_FALLBACK_1',
  'OPENROUTER_MODEL_IMAGE',
  'OPENROUTER_MODEL_IMAGE_FALLBACK_1',
  'OPENROUTER_MODEL_AUDIO',
  'OPENROUTER_MODEL_AUDIO_FALLBACK_1',
  'OPENROUTER_MODEL_HISTORY',
  'DIAGNOSTIC_BATCH_SIZE',
  'DIAGNOSTIC_MAX_LOG_LINES',
  'APPLOG_ENABLED',
  'APPLOG_LOG_NOISY_EVENTS',
  'OPENROUTER_DIAGNOSTIC_MODELS',
  'MIN_CAPITAL_AMOUNT',
  'DEFAULT_ORDER_USD',
  'BUMP_TO_MIN_EXCHANGE_LOT',
  'DEFAULT_LEVERAGE_ENABLED',
  'DEFAULT_LEVERAGE',
  'FORCED_LEVERAGE',
  'LEVERAGE_RANGE_MODE',
  'MIN_ALLOWED_LEVERAGE',
  'MAX_ALLOWED_LEVERAGE',
  'SOURCE_MARTINGALE_DEFAULT_MULTIPLIER',
  'POLLING_INTERVAL_MS',
  'TP_SL_STEP_START',
  'TP_SL_STEP_RANGE',
]);

@ApiTags('Settings')
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly cabinets: CabinetService,
    private readonly cabinetContext: CabinetContextService,
  ) {}

  private async runWithCabinet<T>(
    req: AuthReq,
    queryCabinetId: string | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    const requested = pickRequestedCabinetId({
      queryCabinetId,
      headers: req.headers,
    });
    const userId = String(req.auth?.userId ?? '').trim() || null;
    const cabinetId = await this.cabinets.resolveCabinetIdForUser(userId, requested);
    return this.cabinetContext.runWithCabinet(cabinetId, fn);
  }

  private isAdmin(req: AuthReq): boolean {
    return String(req.auth?.role ?? '').trim().toLowerCase() === 'admin';
  }

  @ApiOperation({ summary: 'Список настроек (секреты замаскированы)' })
  @ApiOkResponse({ description: 'Настройки получены' })
  @Get()
  async list(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId?: string,
  ) {
    const rows = await this.runWithCabinet(req, cabinetId, () => this.settings.list());
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
  async listRaw(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId?: string,
  ) {
    const settings = await this.runWithCabinet(req, cabinetId, () => this.settings.list());
    return { settings };
  }

  @ApiOperation({ summary: 'Заметки / todo дашборда (из БД)' })
  @ApiOkResponse({ description: 'Список пунктов' })
  @Get('dashboard-todos')
  async dashboardTodosGet(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId?: string,
  ) {
    const items = await this.runWithCabinet(req, cabinetId, () =>
      this.settings.getDashboardTodos(),
    );
    return { items };
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
  async dashboardTodosPut(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Body() body: { items?: unknown },
  ) {
    const items = this.settings.normalizeDashboardTodosPayload(body?.items);
    await this.runWithCabinet(req, cabinetId, () => this.settings.setDashboardTodos(items));
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
  async upsert(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Body() body: { key: string; value: string },
  ) {
    if (ADMIN_ONLY_GLOBAL_KEYS.has(body.key) && !this.isAdmin(req)) {
      throw new ForbiddenException('Этот ключ может изменять только администратор');
    }
    await this.runWithCabinet(req, cabinetId, () => this.settings.set(body.key, body.value));
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
  async resetDatabase(
    @Req() req: AuthReq,
    @Body() body: { confirm?: boolean },
  ) {
    if (!this.isAdmin(req)) {
      throw new ForbiddenException('Сброс базы доступен только администратору');
    }
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
  async purgeCompromisedSecrets(
    @Req() req: AuthReq,
    @Body() body: { confirm?: boolean },
  ) {
    if (!this.isAdmin(req)) {
      throw new ForbiddenException('Очистка секретов доступна только администратору');
    }
    if (body?.confirm !== true) {
      throw new BadRequestException(
        'Укажите { "confirm": true } для очистки скомпрометированных секретов',
      );
    }
    const result = await this.settings.purgeCompromisedSecrets();
    return { ok: true, ...result };
  }
}
