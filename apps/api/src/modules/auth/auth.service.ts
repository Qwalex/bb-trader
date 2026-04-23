import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';

import {
  issueSharedAuthToken,
  verifySharedAuthToken,
} from '../../common/shared-auth-token';

@Injectable()
export class AuthService {
  constructor(private readonly config: ConfigService) {}

  private getExpectedLogin(): string {
    return this.config.get<string>('SHARED_ACCOUNT_LOGIN')?.trim() || 'admin';
  }

  private getExpectedPassword(): string {
    const password = this.config.get<string>('SHARED_ACCOUNT_PASSWORD')?.trim();
    if (!password) {
      throw new UnauthorizedException(
        'SHARED_ACCOUNT_PASSWORD is not configured',
      );
    }
    return password;
  }

  private getTokenSecret(): string {
    const secret =
      this.config.get<string>('AUTH_JWT_SECRET')?.trim() ||
      this.config.get<string>('API_ACCESS_TOKEN')?.trim();
    if (!secret) {
      throw new UnauthorizedException(
        'AUTH_JWT_SECRET (or API_ACCESS_TOKEN) is not configured',
      );
    }
    return secret;
  }

  private getTokenTtlSeconds(): number {
    const raw = Number(this.config.get<string>('AUTH_TOKEN_TTL_SECONDS') ?? 28_800);
    if (!Number.isFinite(raw) || raw < 60) {
      return 28_800;
    }
    return Math.floor(raw);
  }

  private safeEqual(a: string, b: string): boolean {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  }

  login(params: { login: string; password: string }): {
    accessToken: string;
    expiresInSeconds: number;
    login: string;
  } {
    const expectedLogin = this.getExpectedLogin();
    const expectedPassword = this.getExpectedPassword();
    const login = String(params.login ?? '').trim();
    const password = String(params.password ?? '').trim();
    if (!this.safeEqual(login, expectedLogin) || !this.safeEqual(password, expectedPassword)) {
      throw new UnauthorizedException('Invalid login or password');
    }
    const ttl = this.getTokenTtlSeconds();
    const accessToken = issueSharedAuthToken({
      login,
      secret: this.getTokenSecret(),
      ttlSeconds: ttl,
      subject: 'shared-account',
    });
    return {
      accessToken,
      expiresInSeconds: ttl,
      login,
    };
  }

  verifyAccessToken(token: string): { login: string; exp: number; iat: number } {
    const payload = verifySharedAuthToken({
      token,
      secret: this.getTokenSecret(),
    });
    if (!payload) {
      throw new UnauthorizedException('Invalid access token');
    }
    return { login: payload.login, exp: payload.exp, iat: payload.iat };
  }
}

