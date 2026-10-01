import { SUPPORT_ATTACHMENT_MAX_BYTES } from '@ordens/contracts';

/** Largura máxima da imagem enviada: acima disso só aumenta o arquivo, sem ajudar a leitura. */
const MAX_WIDTH = 1920;
/** Qualidades tentadas, da melhor para a pior, até o arquivo caber no limite. */
const QUALITIES = [0.9, 0.75, 0.6, 0.45];

export const captureSupported = () => typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia);

/** O usuário fechou o seletor do navegador sem escolher nada: desistência, não erro. */
export class CaptureCancelled extends Error {
  constructor() {
    super('Captura cancelada');
    this.name = 'CaptureCancelled';
  }
}

const toBlob = (canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));

/**
 * Captura uma imagem da aba, janela ou monitor que o usuário escolher no diálogo do navegador.
 *
 * A escolha é sempre do usuário — nunca há captura automática — e o stream é encerrado assim que o
 * quadro é lido, inclusive quando algo falha no meio: deixar a track viva manteria o navegador
 * avisando que a tela está sendo compartilhada.
 */
export async function captureScreen(): Promise<File> {
  if (!captureSupported()) throw new CaptureCancelled();

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch {
    // NotAllowedError/AbortError: o usuário cancelou ou negou. Nada a relatar como falha técnica.
    throw new CaptureCancelled();
  }

  const video = document.createElement('video');
  try {
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    // Um quadro depois de o vídeo começar: antes disso o tamanho ainda pode ser 0.
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) throw new Error('Não foi possível ler a imagem da tela.');

    const scale = Math.min(1, MAX_WIDTH / width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Não foi possível preparar a imagem.');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    for (const quality of QUALITIES) {
      const blob = await toBlob(canvas, quality);
      if (blob && blob.size <= SUPPORT_ATTACHMENT_MAX_BYTES) {
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        return new File([blob], `captura-${stamp}.webp`, { type: 'image/webp' });
      }
    }
    throw new Error('A captura ficou grande demais. Recorte a área e anexe como imagem.');
  } finally {
    // Sempre: um erro no meio não pode deixar a tela sendo compartilhada.
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  }
}
