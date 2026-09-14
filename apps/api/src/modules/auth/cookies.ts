import type { Response } from 'express';
import type { SessionService } from './session.service.js';

/** Grava cookie de sessão (HttpOnly) e cookie de CSRF legível pelo front. */
export function setSessionCookies(res: Response, sessions: SessionService, token: string, sessionId: string, persistent: boolean) {
  const base = { secure: sessions.cookieSecure, sameSite: 'lax' as const, path: '/' };
  const maxAge = persistent ? sessions.absoluteMaxAgeMs : undefined;
  res.cookie(sessions.cookieName, token, { ...base, httpOnly: true, maxAge });
  res.cookie(sessions.csrfCookieName, sessions.csrfTokenFor(sessionId), { ...base, httpOnly: false, maxAge });
}

export function clearSessionCookies(res: Response, sessions: SessionService) {
  const base = { secure: sessions.cookieSecure, sameSite: 'lax' as const, path: '/' };
  res.clearCookie(sessions.cookieName, { ...base, httpOnly: true });
  res.clearCookie(sessions.csrfCookieName, base);
}
