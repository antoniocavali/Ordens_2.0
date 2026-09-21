import type { LoginResponse, PasskeyDto } from '@ordens/contracts';
import { browserSupportsWebAuthn, startAuthentication, startRegistration, WebAuthnError } from '@simplewebauthn/browser';
import { post } from './api';

export { browserSupportsWebAuthn };

/** Cancelamento no diálogo do aparelho não é erro: o usuário só desistiu. */
export function passkeyCancelled(err: unknown) {
  return (err instanceof WebAuthnError && err.code === 'ERROR_CEREMONY_ABORTED') || (err instanceof Error && err.name === 'NotAllowedError');
}

export async function loginWithPasskey(): Promise<LoginResponse> {
  const { challengeId, options } = await post<{ challengeId: string; options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>('/auth/passkeys/login/options', {});
  const response = await startAuthentication({ optionsJSON: options });
  return post<LoginResponse>('/auth/passkeys/login', { challengeId, response });
}

export async function registerPasskey(password: string, name: string): Promise<PasskeyDto> {
  const options = await post<Parameters<typeof startRegistration>[0]['optionsJSON']>('/auth/passkeys/register/options', { password });
  const response = await startRegistration({ optionsJSON: options });
  return post<PasskeyDto>('/auth/passkeys/register', { name, response });
}

/** Nome sugerido a partir do aparelho atual. */
export function suggestedPasskeyName() {
  if (typeof navigator === 'undefined') return 'Minha passkey';
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Aparelho';
  return `Passkey · ${os}`;
}
