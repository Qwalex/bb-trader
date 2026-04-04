import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

import type { AuthenticatedRequestContext } from './auth.types';
import { WorkspaceBootstrapService } from './workspace-bootstrap.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly workspaceBootstrap: WorkspaceBootstrapService,
  ) {}

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

  private async resolveWorkspaceContext(userId: string): Promise<AuthenticatedRequestContext | null> {
    const admin = this.getSupabaseAdminClient();
    if (!admin) {
      return {
        userId,
        email: null,
        workspaceId: null,
        role: null,
      };
    }
    const userResult = await admin.auth.admin.getUserById(userId);
    const user = userResult.data.user;
    if (!user) {
      return null;
    }
    const metadata = user.user_metadata ?? {};
    const bootstrap = await this.workspaceBootstrap.ensureBootstrapWorkspace({
      userId,
      email: user.email ?? null,
      workspaceName:
        typeof metadata.workspace_name === 'string' ? metadata.workspace_name : null,
      workspaceSlug:
        typeof metadata.workspace_slug === 'string' ? metadata.workspace_slug : null,
    });
    return {
      userId,
      email: user.email ?? null,
      workspaceId: bootstrap.workspaceId,
      role: bootstrap.role,
    };
  }

  async authenticateRequest(input: {
    authorizationHeader?: string | string[] | undefined;
  }): Promise<AuthenticatedRequestContext | null> {
    const token = this.parseBearerToken(input.authorizationHeader);
    const jwtSecret = this.getSupabaseJwtSecret();
    if (!token || !jwtSecret) {
      return null;
    }
    let payload: string | jwt.JwtPayload;
    try {
      payload = jwt.verify(token, jwtSecret, {
        audience: 'authenticated',
      });
    } catch {
      return null;
    }
    if (typeof payload === 'string') {
      return null;
    }
    const userId = typeof payload.sub === 'string' ? payload.sub : null;
    if (!userId) {
      return null;
    }
    const issuer = typeof payload.iss === 'string' ? payload.iss.trim().replace(/\/+$/, '') : '';
    const supabaseUrl = this.getSupabaseUrl()?.replace(/\/+$/, '') ?? '';
    const allowedIssuers = new Set(
      ['supabase', supabaseUrl, supabaseUrl ? `${supabaseUrl}/auth/v1` : ''].filter(Boolean),
    );
    if (issuer && !allowedIssuers.has(issuer)) {
      return null;
    }
    return this.resolveWorkspaceContext(userId);
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
    const defaults = [
      webOrigin,
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3003',
      'http://127.0.0.1:3003',
    ].filter((v): v is string => typeof v === 'string' && v.length > 0);
    return Array.from(new Set(defaults));
  }
}
