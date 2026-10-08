import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROLES } from '@ordens/contracts';
import { describe, expect, it } from 'vitest';
import { GUIDE_GROUPS, GUIDE_PROFILES, profileForUser } from './guide-content';
import { SLIDES } from './presentation-content';

const shotExists = (file: string) => existsSync(path.resolve(import.meta.dirname, '../../../public/guia', `${file}.webp`));

describe('guia de uso', () => {
  it('toda captura citada no guia e na apresentação existe em public/guia', () => {
    const cited = [...GUIDE_PROFILES.flatMap((p) => p.tasks.flatMap((t) => (t.shot ? [t.shot.file] : []))), ...SLIDES.flatMap((s) => s.frames.map((f) => f.file))];
    expect([...new Set(cited)].filter((f) => !shotExists(f))).toEqual([]);
  });

  it('capítulos e tarefas têm identificadores únicos e grupos conhecidos', () => {
    const slugs = GUIDE_PROFILES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const p of GUIDE_PROFILES) {
      expect(GUIDE_GROUPS).toContain(p.group);
      const ids = p.tasks.map((t) => t.id);
      expect(new Set(ids).size, p.slug).toBe(ids.length);
      expect(p.tasks.length, p.slug).toBeGreaterThan(0);
    }
  });

  it('cada papel de Matriz, Fazenda e Comprador tem o seu capítulo', () => {
    for (const [code, role] of Object.entries(ROLES)) {
      if (!['MATRIZ', 'FARM', 'BUYER'].includes(role.scope)) continue;
      const profile = profileForUser([code], role.scope);
      expect(profile?.roleCodes, code).toContain(code);
      expect(profile?.name, code).toBe(role.name);
    }
  });

  it('papel personalizado cai no capítulo do tipo de organização', () => {
    expect(profileForUser(['CUSTOM_X'], 'FARM')?.slug).toBe('operador-fazenda');
    expect(profileForUser(['CUSTOM_X'], 'BUYER')?.slug).toBe('comprador');
    expect(profileForUser(undefined, undefined)).toBeUndefined();
  });
});
