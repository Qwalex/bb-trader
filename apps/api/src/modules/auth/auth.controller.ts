import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/public.decorator';
import { AuthService } from './auth.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @ApiOperation({ summary: 'Логин общего аккаунта' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['login', 'password'],
      properties: {
        login: { type: 'string' },
        password: { type: 'string' },
      },
    },
  })
  @ApiOkResponse({ description: 'Токен выдан' })
  @Public()
  @Post('register')
  register(
    @Body() body: { login?: string; password?: string; telegramUserId?: string },
  ) {
    return this.auth.register({
      login: String(body.login ?? ''),
      password: String(body.password ?? ''),
      telegramUserId: body.telegramUserId,
    });
  }

  @Public()
  @ApiOperation({ summary: 'Логин пользователя' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['login', 'password'],
      properties: {
        login: { type: 'string' },
        password: { type: 'string' },
      },
    },
  })
  @ApiOkResponse({ description: 'Токен выдан' })
  @Post('login')
  login(@Body() body: { login?: string; password?: string }) {
    return this.auth.login({
      login: String(body.login ?? ''),
      password: String(body.password ?? ''),
    });
  }

  @Public()
  @ApiOperation({ summary: 'Запрос кода восстановления в Telegram' })
  @Post('password-reset/request')
  requestPasswordReset(@Body() body: { login?: string }) {
    return this.auth.requestPasswordReset({
      login: String(body.login ?? ''),
    });
  }

  @Public()
  @ApiOperation({ summary: 'Подтверждение сброса пароля кодом' })
  @Post('password-reset/confirm')
  confirmPasswordReset(
    @Body() body: { login?: string; code?: string; newPassword?: string },
  ) {
    return this.auth.confirmPasswordReset({
      login: String(body.login ?? ''),
      code: String(body.code ?? ''),
      newPassword: String(body.newPassword ?? ''),
    });
  }

  @ApiOperation({ summary: 'Проверка токена текущего пользователя' })
  @ApiOkResponse({ description: 'Токен валиден' })
  @Get('me')
  me(
    @Req()
    req: {
      auth?: {
        userId?: string;
        login?: string;
        role?: string;
        iat?: number;
        exp?: number;
      };
    },
  ) {
    const payload = req.auth;
    return {
      ok: true,
      userId: payload?.userId ?? null,
      login: payload?.login ?? null,
      role: payload?.role ?? null,
      iat: payload?.iat ?? null,
      exp: payload?.exp ?? null,
    };
  }

  @ApiOperation({ summary: 'Ручная разблокировка пользователя (admin)' })
  @Post('users/unlock')
  unlockUser(
    @Body() body: { login?: string },
    @Req()
    req: {
      auth?: {
        userId?: string;
        role?: string;
      };
    },
  ) {
    return this.auth.unlockUser({
      login: String(body.login ?? ''),
      actorUserId: String(req.auth?.userId ?? ''),
    });
  }
}

