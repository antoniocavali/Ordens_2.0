import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Revisão de segurança 3.6: o PermissionGuard libera qualquer sessão quando a rota não declara nada.
 * Este teste garante que toda rota (ou o seu controller) diga explicitamente quem pode chamá-la.
 */
const MARKERS = /@(Public|RequirePermission|RequireAnyPermission|PlatformOnly|SelfService)\(/;
const ROUTE = /^\s*@(Get|Post|Put|Patch|Delete)\(/;
const src = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(controller|controllers|module)\.ts$/.test(name) ? [path] : [];
  });
}

/** Rotas sem marcação própria nem no controller que as contém. */
function unmarkedRoutes(file: string): string[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  const missing: string[] = [];
  let classMarked = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^export class \w+/.test(line)) {
      // Decorators do controller: bloco imediatamente acima da classe.
      let j = i - 1;
      const block: string[] = [];
      while (j >= 0 && lines[j]!.trim().startsWith('@')) block.push(lines[j--]!);
      classMarked = block.some((l) => MARKERS.test(l));
      continue;
    }
    if (!ROUTE.test(line) || classMarked) continue;
    // Decorators do método: do primeiro "@" acima até a assinatura.
    let start = i;
    while (start > 0 && lines[start - 1]!.trim().startsWith('@')) start--;
    let end = i;
    while (end + 1 < lines.length && lines[end + 1]!.trim().startsWith('@')) end++;
    if (!lines.slice(start, end + 1).some((l) => MARKERS.test(l))) {
      missing.push(`${relative(src, file)}:${i + 1} ${line.trim()}`);
    }
  }
  return missing;
}

describe('autorização explícita nas rotas', () => {
  it('toda rota declara Public, SelfService, PlatformOnly ou a permissão exigida', () => {
    const missing = sourceFiles(join(src, 'modules')).flatMap(unmarkedRoutes);
    expect(missing).toEqual([]);
  });
});
