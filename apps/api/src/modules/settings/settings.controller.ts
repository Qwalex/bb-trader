import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
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

import { requireWorkspaceId } from '../../common/require-workspace-id';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedRequestContext } from '../auth/auth.types';
import {
  NAV_MENU_IN_BURGER_KEY,
  SETTINGS_KEYS_ADMIN_ONLY_KEY,
  SettingsService,
} from './settings.service';

@ApiTags('Settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @ApiOperation({ summary: 'Список настроек (секреты замаскированы)' })
  @ApiOkResponse({ description: 'Настройки получены' })
  @Get()
  async list(@CurrentUser() user: AuthenticatedRequestContext | null) {
    const workspaceId = requireWorkspaceId(user);
    const rows = await this.settings.list(workspaceId);
    const adminSet = await this.settings.buildAdminOnlySettingKeysSet(workspaceId);
    const isAdmin = user?.appRole === 'admin';
    const visible = isAdmin ? rows : rows.filter((r) => !adminSet.has(r.key));
    const redacted = visible.map((r) => ({
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
  async listSelected(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Query('keys') keysRaw?: string,
  ) {
    const workspaceId = requireWorkspaceId(user);
    const keys = String(keysRaw ?? '')
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key.length > 0);
    if (keys.length === 0) {
      throw new BadRequestException('Укажите query-параметр keys=KEY1,KEY2');
    }
    const adminSet = await this.settings.buildAdminOnlySettingKeysSet(workspaceId);
    const isAdmin = user?.appRole === 'admin';
    const allowedKeys = keys.filter((k) => isAdmin || !adminSet.has(k));
    const rows = await this.settings.getManyResolved(allowedKeys, workspaceId);
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
  async listUiSettings(@CurrentUser() user: AuthenticatedRequestContext | null) {
    const workspaceId = requireWorkspaceId(user);
    const adminSet = await this.settings.buildAdminOnlySettingKeysSet(workspaceId);
    const navMenuInBurger = await this.settings.getNavMenuInBurgerIds(workspaceId);
    return {
      settings: await this.settings.getManyResolved(
        [
          'SOURCE_LIST',
          'SOURCE_EXCLUDE_LIST',
          'DEFAULT_ORDER_USD',
          'DEFAULT_LEVERAGE',
          'SOURCE_MARTINGALE_DEFAULT_MULTIPLIER',
          'BUMP_TO_MIN_EXCHANGE_LOT',
        ],
        workspaceId,
      ),
      appRole: user?.appRole === 'admin' ? 'admin' : 'user',
      navMenuInBurger,
      settingsKeysAdminOnly: [...adminSet].sort((a, b) => a.localeCompare(b, 'en')),
    };
  }

  @ApiOperation({ summary: 'Статусы чувствительных настроек' })
  @ApiOkResponse({ description: 'Статусы секретов получены' })
  @Get('sensitive-status')
  async listSensitiveStatus(@CurrentUser() user: AuthenticatedRequestContext | null) {
    const workspaceId = requireWorkspaceId(user);
    const rows = await this.settings.list(workspaceId);
    const adminSet = await this.settings.buildAdminOnlySettingKeysSet(workspaceId);
    const isAdmin = user?.appRole === 'admin';
    return {
      settings: rows
        .filter((row) => SettingsService.isSensitiveKey(row.key))
        .filter((row) => isAdmin || !adminSet.has(row.key))
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
  async upsert(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Body() body: { key: string; value: string },
  ) {
    const workspaceId = requireWorkspaceId(user);
    const key = String(body?.key ?? '').trim();
    if (!key) {
      throw new BadRequestException('key обязателен');
    }
    if (!SettingsService.canWriteKey(key)) {
      throw new BadRequestException(`Ключ ${key} не поддерживается для записи`);
    }
    const valueStr = String(body?.value ?? '');
    if (key === NAV_MENU_IN_BURGER_KEY && valueStr.trim() !== '') {
      try {
        SettingsService.validateNavMenuInBurgerJson(valueStr);
      } catch (e) {
        throw new BadRequestException(e instanceof Error ? e.message : 'Некорректное меню');
      }
    }
    if (key === SETTINGS_KEYS_ADMIN_ONLY_KEY && valueStr.trim() !== '') {
      try {
        SettingsService.validateSettingsKeysAdminOnlyJson(valueStr);
      } catch (e) {
        throw new BadRequestException(
          e instanceof Error ? e.message : 'Некорректный список ключей',
        );
      }
    }
    const adminOnlySet = await this.settings.buildAdminOnlySettingKeysSet(workspaceId);
    if (adminOnlySet.has(key) && user?.appRole !== 'admin') {
      throw new ForbiddenException('Только администратор может менять эту настройку');
    }
    await this.settings.set(key, valueStr, workspaceId);
    return { ok: true };
  }

  /**
   * Сброс данных текущего workspace в БД. Только для панели настроек.
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
  async resetDatabase(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Body() body: { confirm?: boolean },
  ) {
    const workspaceId = requireWorkspaceId(user);
    if (body?.confirm !== true) {
      throw new BadRequestException(
        'Укажите { "confirm": true } для подтверждения сброса базы',
      );
    }
    if (user?.appRole !== 'admin') {
      throw new ForbiddenException('Только администратор приложения может сбросить базу данных');
    }
    await this.settings.resetAllData(workspaceId);
    return { ok: true };
  }
}
