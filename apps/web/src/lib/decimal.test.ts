import { describe, expect, it } from 'vitest';
import { addDec, cmpDec, mulDec, subDec } from './decimal';
import { parseDecimalInput, toDecimalInput } from './format';

describe('decimal (sem float)', () => {
  it('multiplica com arredondamento half-up', () => {
    expect(mulDec('500', '1250', 2)).toBe('625000');
    expect(mulDec('0.1', '0.2', 2)).toBe('0.02');
    expect(mulDec('1.005', '1', 2)).toBe('1.01');
    expect(mulDec('99999999999999.9999', '2', 4)).toBe('199999999999999.9998');
  });

  it('soma, subtrai e compara', () => {
    expect(addDec('0.1', '0.2')).toBe('0.3');
    expect(subDec('1000', '350.5')).toBe('649.5');
    expect(subDec('100', '150')).toBe('-50');
    expect(cmpDec('10.50', '10.5')).toBe(0);
    expect(cmpDec('2', '10')).toBe(-1);
  });

  it('converte entrada pt-BR', () => {
    expect(parseDecimalInput('1.250,50')).toBe('1250.50');
    expect(parseDecimalInput('abc')).toBe('');
    expect(toDecimalInput('1250000.5')).toBe('1.250.000,5');
  });
});
