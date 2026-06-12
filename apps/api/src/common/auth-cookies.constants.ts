/** httpOnly session cookie (production Web). */
export const AUTH_SESSION_COOKIE = 'sb_auth';

/** Dev-only readable cookie; same JWT as sb_auth when set. */
export const AUTH_TOKEN_COOKIE = 'sb_auth_token';

export const AUTH_COOKIE_KEYS = [AUTH_SESSION_COOKIE, AUTH_TOKEN_COOKIE] as const;
