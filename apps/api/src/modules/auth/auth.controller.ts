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
  @Post('login')
  login(@Body() body: { login?: string; password?: string }) {
    return this.auth.login({
      login: String(body.login ?? ''),
      password: String(body.password ?? ''),
    });
  }

  @ApiOperation({ summary: 'Проверка токена текущего пользователя' })
  @ApiOkResponse({ description: 'Токен валиден' })
  @Get('me')
  me(
    @Req()
    req: {
      headers?: Record<string, string | string[] | undefined>;
    },
  ) {
    const rawHeader = req.headers?.authorization;
    const authHeader = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const token = String(authHeader ?? '')
      .replace(/^Bearer\s+/i, '')
      .trim();
    const payload = this.auth.verifyAccessToken(token);
    return {
      ok: true,
      login: payload.login,
      iat: payload.iat,
      exp: payload.exp,
    };
  }
}

