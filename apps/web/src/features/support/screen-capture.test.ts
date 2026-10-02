import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureScreen, CaptureCancelled, captureSupported } from './screen-capture';

/** Track de vídeo falsa que registra se foi encerrada. */
function fakeStream() {
  const track = { kind: 'video', stop: vi.fn() };
  return { stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream, track };
}

function stubDom({ width = 1280, height = 720, blobSize = 1024 } = {}) {
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: vi.fn() }),
    toBlob: (cb: (b: Blob | null) => void) => cb({ size: blobSize, type: 'image/webp' } as Blob),
  };
  const video = { srcObject: null as unknown, muted: false, play: vi.fn().mockResolvedValue(undefined), videoWidth: width, videoHeight: height };
  vi.stubGlobal('document', {
    createElement: (tag: string) => (tag === 'canvas' ? canvas : video),
  });
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    cb();
    return 1;
  });
  return { canvas, video };
}

afterEach(() => vi.unstubAllGlobals());

describe('captura de tela do atendimento', () => {
  it('sem suporte do navegador, não é tratado como erro técnico', async () => {
    vi.stubGlobal('navigator', {});
    expect(captureSupported()).toBe(false);
    await expect(captureScreen()).rejects.toBeInstanceOf(CaptureCancelled);
  });

  it('usuário cancelar a escolha não vira erro e não deixa track aberta', async () => {
    const getDisplayMedia = vi.fn().mockRejectedValue(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } });
    await expect(captureScreen()).rejects.toBeInstanceOf(CaptureCancelled);
  });

  it('gera a imagem e encerra as tracks', async () => {
    const { stream, track } = fakeStream();
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: vi.fn().mockResolvedValue(stream) } });
    stubDom();

    const file = await captureScreen();
    expect(file.type).toBe('image/webp');
    expect(file.name).toMatch(/^captura-.*\.webp$/);
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('encerra as tracks mesmo quando falha no meio', async () => {
    const { stream, track } = fakeStream();
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: vi.fn().mockResolvedValue(stream) } });
    // Vídeo sem dimensão: a leitura do quadro falha depois de o stream já estar aberto.
    stubDom({ width: 0, height: 0 });

    await expect(captureScreen()).rejects.toThrow(/ler a imagem/);
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('recusa quando nem a menor qualidade cabe no limite de 10 MB', async () => {
    const { stream, track } = fakeStream();
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: vi.fn().mockResolvedValue(stream) } });
    stubDom({ blobSize: 11 * 1024 * 1024 });

    await expect(captureScreen()).rejects.toThrow(/grande demais/);
    expect(track.stop).toHaveBeenCalledTimes(1);
  });
});
