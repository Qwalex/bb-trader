import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

import type { AuthenticatedRequestContext, AuthenticateRequestResult } from './auth.types';
import { WorkspaceBootstrapService } from './workspace-bootstrap.service';

@Injectable()
export class AuthService {
  private readonly contextCache = new Map<
    string,
    { ctx: AuthenticatedRequestContext; expiresAt: number }
  >();
  private readonly CONTEXT_CACHE_TTL_MS = 60_000;
  private readonly CONTEXT_CACHE_MAX_SIZE = 1_000;

  constructor(
    private readonly config: ConfigService,
    private readonly workspaceBootstrap: WorkspaceBootstrapService,
  ) {}

  private getCachedContext(userId: string): AuthenticatedRequestContext | null {
    const entry = this.contextCache.get(userId);
    if (!entry) return null;
    if (Date.now() < entry.expiresAt) return entry.ctx;
    this.contextCache.delete(userId);
    return null;
  }

  private setCachedContext(userId: string, ctx: AuthenticatedRequestContext): void {
    if (this.contextCache.size >= this.CONTEXT_CACHE_MAX_SIZE) {
      const firstKey = this.contextCache.keys().next().value;
      if (firstKey !== undefined) this.contextCache.delete(firstKey);
    }
    this.contextCache.set(userId, { ctx, expiresAt: Date.now() + this.CONTEXT_CACHE_TTL_MS });
  }

  private getSupabaseJwtSecret(): string | null {
    const secret = this.config.get<string>('SUPABASE_JWT_SECRET')?.trim();
    return secret && secret.length > 0 ? secret : null;
  }

  private getSupabaseUrl(): string | null {
    const url = this.config.get<string>('NEXT_PUBLIC_SUPABASE_URL')?.trim();
    return url && url.length > 0 ? url : null;
  }

  private getServiceRoleKey(): string | null {
    const key = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY_SERVER')?.trim();
    return key && key.length > 0 ? key : null;
  }

  private parseWorkspaceIdHeader(headerValue?: string | string[]): string | undefined {
    const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const v = String(raw ?? '').trim();
    return v.length > 0 ? v : undefined;
  }

  private parseBearerToken(headerValue?: string | string[]): string | null {
    const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const value = String(raw ?? '').trim();
    if (!value.toLowerCase().startsWith('bearer ')) {
      return null;
    }
    const token = value.slice(7).trim();
    return token || null;
  }

  private getSupabaseAdminClient() {
    const url = this.getSupabaseUrl();
    const serviceRoleKey = this.getServiceRoleKey();
    if (!url || !serviceRoleKey) {
      return null;
    }
    return createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  private extractJwtUserClaims(payload: jwt.JwtPayload): {
    email: string | null;
    workspaceName: string | null;
    workspaceSlug: string | null;
  } {
    const email = typeof payload.email === 'string' ? payload.email : null;
    const rawMeta = payload.user_metadata;
    const meta =
      rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)
        ? (rawMeta as Record<string, unknown>)
        : {};
    return {
      email,
      workspaceName: typeof meta.workspace_name === 'string' ? meta.workspace_name : null,
      workspaceSlug: typeof meta.workspace_slug === 'string' ? meta.workspace_slug : null,
    };
  }

  /** iss из GoTrue и NEXT_PUBLIC_SUPABASE_URL в API могут отличаться (http/127.0.0.1 vs публичный хост). */
  private issuerAllowed(issRaw: string, supabaseUrlRaw: string): boolean {
    const iss = issRaw.trim().replace(/\/+$/, '');
    const base = supabaseUrlRaw.trim().replace(/\/+$/, '');
    const allowed = new Set(['supabase', base, `${base}/auth/v1`].filter(Boolean));
    if (allowed.has(iss)) {
      return true;
    }
    if (!iss) {
      return false;
    }
    try {
      const iu = new URL(iss);
      const bu = new URL(base.startsWith('http') ? base : `https://${base}`);
      const pathOk = iu.pathname.replace(/\/$/, '') === '/auth/v1';
      return pathOk && iu.hostname === bu.hostname;
    } catch {
      return false;
    }
  }

  private async resolveWorkspaceContext(
    userId: string,
    jwtClaims: { email: string | null; workspaceName: string | null; workspaceSlug: string | null },
  ): Promise<AuthenticatedRequestContext> {
    const cached = this.getCachedContext(userId);
    if (cached) return cached;

    let ctx: AuthenticatedRequestContext;

    const admin = this.getSupabaseAdminClient();
    if (admin) {
      try {
        const userResult = await admin.auth.admin.getUserById(userId);
        const user = userResult.data.user;
        if (user) {
          const metadata = user.user_metadata ?? {};
          const bootstrap = await this.workspaceBootstrap.ensureBootstrapWorkspace({
            userId,
            email: user.email ?? null,
            workspaceName:
              typeof metadata.workspace_name === 'string' ? metadata.workspace_name : null,
            workspaceSlug:
              typeof metadata.workspace_slug === 'string' ? metadata.workspace_slug : null,
          });
          ctx = {
            userId,
            email: user.email ?? null,
            workspaceId: bootstrap.workspaceId,
            role: bootstrap.role,
            appRole: bootstrap.appRole,
          };
          this.setCachedContext(userId, ctx);
          return ctx;
        }
      } catch {
        // сеть / неверный service role URL — не рвём сессию, берём claims из JWT
      }
    }

    const bootstrap = await this.workspaceBootstrap.ensureBootstrapWorkspace({
      userId,
      email: jwtClaims.email,
      workspaceName: jwtClaims.workspaceName,
      workspaceSlug: jwtClaims.workspaceSlug,
    });
    ctx = {
      userId,
      email: jwtClaims.email,
      workspaceId: bootstrap.workspaceId,
      role: bootstrap.role,
      appRole: bootstrap.appRole,
    };
    this.setCachedContext(userId, ctx);
    return ctx;
  }

  async authenticateRequest(input: {
    authorizationHeader?: string | string[] | undefined;
    workspaceIdHeader?: string | string[] | undefined;
  }): Promise<AuthenticateRequestResult> {
    const token = this.parseBearerToken(input.authorizationHeader);
    const jwtSecret = this.getSupabaseJwtSecret();
    if (!token || !jwtSecret) {
      return { ok: false, reason: 'unauthorized' };
    }
    let payload: string | jwt.JwtPayload;
    try {
      payload = jwt.verify(token, jwtSecret, {
        audience: 'authenticated',
      });
    } catch {
      return { ok: false, reason: 'unauthorized' };
    }
    if (typeof payload === 'string') {
      return { ok: false, reason: 'unauthorized' };
    }
    const userId = typeof payload.sub === 'string' ? payload.sub : null;
    if (!userId) {
      return { ok: false, reason: 'unauthorized' };
    }
    const issuer = typeof payload.iss === 'string' ? payload.iss.trim().replace(/\/+$/, '') : '';
    const supabaseUrl = this.getSupabaseUrl()?.replace(/\/+$/, '') ?? '';
    if (issuer && supabaseUrl && !this.issuerAllowed(issuer, supabaseUrl)) {
      return { ok: false, reason: 'unauthorized' };
    }
    const jwtClaims = this.extractJwtUserClaims(payload);
    const base = await this.resolveWorkspaceContext(userId, jwtClaims);
    const requested = this.parseWorkspaceIdHeader(input.workspaceIdHeader);
    if (requested) {
      const member = await this.workspaceBootstrap.findMembership(userId, requested);
      if (member) {
        return {
          ok: true,
          user: {
            userId,
            email: base.email,
            workspaceId: member.workspaceId,
            role: member.role,
            appRole: base.appRole,
          },
        };
      }
      // устаревший или поддельный id в localStorage — не блокируем API, используем кабинет по умолчанию
    }
    return { ok: true, user: base };
  }

  getAllowedCorsOrigins(): string[] {
    const configured = this.config.get<string>('WEB_CORS_ORIGINS') ?? '';
    const values = configured
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    if (values.length > 0) {
      return Array.from(new Set(values));
    }
    const webOrigin = this.config.get<string>('WEB_ORIGIN')?.trim();
    const defaults: string[] = [webOrigin].filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
    if (process.env.NODE_ENV !== 'production') {
      defaults.push(
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:3003',
        'http://127.0.0.1:3003',
      );
    }
    return Array.from(new Set(defaults));
  }
}
