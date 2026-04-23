import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

import {
  issueSharedAuthToken,
  verifySharedAuthToken,
} from '../../common/shared-auth-token';
import { PrismaService } from '../../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class AuthService {
  private readonly lockThreshold = 3;
  private readonly firstLockHours = 24;
  private readonly resetCodeMinutes = 10;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

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

  private getEnvAdminUserIds(): string[] {
    const raw = this.config.get<string>('AUTH_ADMIN_USER_IDS')?.trim() ?? '';
    if (!raw) return [];
    return raw
      .split(/[,\s]+/)
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }

  private isEnvAdminUser(userId: string): boolean {
    const id = String(userId ?? '').trim();
    if (!id) return false;
    return this.getEnvAdminUserIds().includes(id);
  }

  private safeEqual(a: string, b: string): boolean {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  }

  private hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `scrypt$${salt}$${hash}`;
  }

  private verifyPassword(password: string, storedHash: string): boolean {
    const raw = String(storedHash ?? '');
    const [kind, salt, hashHex] = raw.split('$');
    if (kind !== 'scrypt' || !salt || !hashHex) {
      return false;
    }
    const computed = scryptSync(password, salt, 64).toString('hex');
    return this.safeEqual(computed, hashHex);
  }

  private createResetCode(): string {
    const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
    return String(n).padStart(6, '0');
  }

  private hashResetCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  private issueAccessToken(user: {
    id: string;
    login: string;
    role: string;
  }): { accessToken: string; expiresInSeconds: number; login: string; role: string } {
    const ttl = this.getTokenTtlSeconds();
    const effectiveRole = this.isEnvAdminUser(user.id) ? 'admin' : user.role;
    return {
      accessToken: issueSharedAuthToken({
        userId: user.id,
        login: user.login,
        role: effectiveRole,
        secret: this.getTokenSecret(),
        ttlSeconds: ttl,
        subject: user.id,
      }),
      expiresInSeconds: ttl,
      login: user.login,
      role: effectiveRole,
    };
  }

  async register(params: {
    login: string;
    password: string;
    telegramUserId?: string | null;
  }): Promise<{ id: string; login: string; role: string }> {
    const login = String(params.login ?? '').trim().toLowerCase();
    const password = String(params.password ?? '').trim();
    const telegramUserId = String(params.telegramUserId ?? '').trim() || null;
    if (!login || !password) {
      throw new UnauthorizedException('Login and password are required');
    }
    if (password.length < 8) {
      throw new UnauthorizedException('Password must be at least 8 characters');
    }
    const role = 'user';
    const created = await this.prisma.authUser.create({
      data: {
        login,
        passwordHash: this.hashPassword(password),
        telegramUserId,
        role,
      },
      select: { id: true, login: true, role: true },
    });
    return created;
  }

  async login(params: { login: string; password: string }): Promise<{
    accessToken: string;
    expiresInSeconds: number;
    login: string;
    role: string;
  }> {
    const login = String(params.login ?? '').trim().toLowerCase();
    const password = String(params.password ?? '').trim();
    const resolvedUser = await this.prisma.authUser.findUnique({
      where: { login },
    });
    if (!login || !password) {
      throw new UnauthorizedException('Invalid login or password');
    }
    if (!resolvedUser) {
      throw new UnauthorizedException('Invalid login or password');
    }
    const now = new Date();
    if (resolvedUser.manualLock) {
      throw new ForbiddenException({
        code: 'account_locked_manual',
        message: 'Account is manually locked',
      });
    }
    if (resolvedUser.firstLockUntil && resolvedUser.firstLockUntil > now) {
      throw new ForbiddenException({
        code: 'account_locked_24h',
        message: 'Account is locked for 24 hours',
        lockedUntil: resolvedUser.firstLockUntil.toISOString(),
      });
    }

    const validPassword = this.verifyPassword(password, resolvedUser.passwordHash);
    if (!validPassword) {
      const nextFailed = resolvedUser.failedLoginCount + 1;
      const hasPast24hLock =
        resolvedUser.firstLockUntil != null && resolvedUser.firstLockUntil <= now;
      if (nextFailed >= this.lockThreshold) {
        if (hasPast24hLock) {
          await this.prisma.authUser.update({
            where: { id: resolvedUser.id },
            data: { failedLoginCount: nextFailed, manualLock: true },
          });
          throw new ForbiddenException({
            code: 'account_locked_manual',
            message: 'Account is manually locked',
          });
        }
        const lockUntil = new Date(now.getTime() + this.firstLockHours * 60 * 60 * 1000);
        await this.prisma.authUser.update({
          where: { id: resolvedUser.id },
          data: { failedLoginCount: nextFailed, firstLockUntil: lockUntil },
        });
        throw new ForbiddenException({
          code: 'account_locked_24h',
          message: 'Account is locked for 24 hours',
          lockedUntil: lockUntil.toISOString(),
        });
      }
      await this.prisma.authUser.update({
        where: { id: resolvedUser.id },
        data: { failedLoginCount: nextFailed },
      });
      throw new UnauthorizedException('Invalid login or password');
    }

    await this.prisma.authUser.update({
      where: { id: resolvedUser.id },
      data: { failedLoginCount: 0 },
    });
    return this.issueAccessToken(resolvedUser);
  }

  verifyAccessToken(token: string): {
    userId: string;
    login: string;
    role: string;
    exp: number;
    iat: number;
  } {
    const payload = verifySharedAuthToken({
      token,
      secret: this.getTokenSecret(),
    });
    if (!payload) {
      throw new UnauthorizedException('Invalid access token');
    }
    return {
      userId: String(payload.userId ?? payload.sub ?? ''),
      login: payload.login,
      role: String(payload.role ?? 'user'),
      exp: payload.exp,
      iat: payload.iat,
    };
  }

  async unlockUser(params: { actorUserId: string; login: string }): Promise<{ ok: true }> {
    const actorUserId = String(params.actorUserId ?? '').trim();
    if (!this.isEnvAdminUser(actorUserId)) {
      throw new ForbiddenException('Admin role required');
    }
    const login = String(params.login ?? '').trim().toLowerCase();
    if (!login) {
      throw new UnauthorizedException('Login is required');
    }
    await this.prisma.authUser.update({
      where: { login },
      data: {
        manualLock: false,
        failedLoginCount: 0,
        firstLockUntil: null,
      },
    });
    return { ok: true };
  }

  async requestPasswordReset(params: { login: string }): Promise<{ ok: true }> {
    const login = String(params.login ?? '').trim().toLowerCase();
    if (!login) {
      throw new UnauthorizedException('Login is required');
    }
    const user = await this.prisma.authUser.findUnique({ where: { login } });
    if (!user || !user.telegramUserId) {
      throw new UnauthorizedException('Password reset is unavailable for this account');
    }
    await this.prisma.authPasswordReset.updateMany({
      where: {
        userId: user.id,
        consumedAt: null,
      },
      data: { consumedAt: new Date() },
    });
    const code = this.createResetCode();
    const expiresAt = new Date(Date.now() + this.resetCodeMinutes * 60 * 1000);
    await this.prisma.authPasswordReset.create({
      data: {
        userId: user.id,
        codeHash: this.hashResetCode(code),
        expiresAt,
      },
    });
    const sent = await this.telegram.sendPasswordResetCode({
      telegramUserId: user.telegramUserId,
      login: user.login,
      code,
      expiresInMinutes: this.resetCodeMinutes,
    });
    if (!sent.ok) {
      throw new UnauthorizedException(sent.error ?? 'Failed to send reset code');
    }
    return { ok: true };
  }

  async confirmPasswordReset(params: {
    login: string;
    code: string;
    newPassword: string;
  }): Promise<{ ok: true }> {
    const login = String(params.login ?? '').trim().toLowerCase();
    const code = String(params.code ?? '').trim();
    const newPassword = String(params.newPassword ?? '').trim();
    if (!login || !code || !newPassword) {
      throw new UnauthorizedException('Login, code and newPassword are required');
    }
    if (newPassword.length < 8) {
      throw new UnauthorizedException('Password must be at least 8 characters');
    }
    const user = await this.prisma.authUser.findUnique({ where: { login } });
    if (!user) {
      throw new UnauthorizedException('Reset code is invalid');
    }
    const candidate = await this.prisma.authPasswordReset.findFirst({
      where: {
        userId: user.id,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!candidate) {
      throw new UnauthorizedException('Reset code is invalid');
    }
    if (!this.safeEqual(candidate.codeHash, this.hashResetCode(code))) {
      throw new UnauthorizedException('Reset code is invalid');
    }
    await this.prisma.$transaction([
      this.prisma.authUser.update({
        where: { id: user.id },
        data: {
          passwordHash: this.hashPassword(newPassword),
          failedLoginCount: 0,
          firstLockUntil: null,
        },
      }),
      this.prisma.authPasswordReset.update({
        where: { id: candidate.id },
        data: { consumedAt: new Date() },
      }),
    ]);
    return { ok: true };
  }
}

