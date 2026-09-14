import { describe, expect, it } from 'vitest';
import { asksForAgent, classifySupportText, findOrderNumber } from './schemas/support.js';

describe('assistente de atendimento', () => {
  it.each([
    ['A NF-e da carga veio com valor errado', 'BILLING'],
    ['Preciso da segunda via do boleto', 'BILLING'],
    ['Cobrança duplicada no mês', 'BILLING'],
    ['Não consigo fazer login, senha não funciona', 'SUPPORT'],
    ['A tela de cargas travou e deu erro', 'SUPPORT'],
    ['USUÁRIO SEM PERMISSÃO para cadastrar', 'SUPPORT'],
  ])('classifica "%s" como %s', (text, queue) => {
    expect(classifySupportText(text)).toBe(queue);
  });

  it('não chuta quando não há sinal claro', () => {
    expect(classifySupportText('Olá, bom dia')).toBeNull();
    expect(classifySupportText('erro no boleto')).toBeNull();
  });

  it('reconhece pedido de atendente humano', () => {
    expect(asksForAgent('Quero falar com um atendente')).toBe(true);
    expect(asksForAgent('bom dia')).toBe(false);
  });

  it('encontra número de OC', () => {
    expect(findOrderNumber('Problema na ordem 2026/00033, carga C02')).toBe('2026/00033');
    expect(findOrderNumber('sem ordem')).toBeNull();
  });
});
