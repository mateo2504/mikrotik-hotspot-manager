import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  displayMbps,
  formatMbpsToken,
  formatSimpleQueueMaxLimit,
  normalizeMbps,
  parseMaxLimit
} from './mbps'

describe('megas vs bits en simplequeue', () => {
  it('deja megas como megas', () => {
    assert.equal(normalizeMbps('3'), '3')
    assert.equal(normalizeMbps('8M'), '8')
    assert.equal(normalizeMbps('10m'), '10')
    assert.equal(normalizeMbps('1000M'), '1000')
    assert.equal(formatMbpsToken('3'), '3M')
    assert.equal(formatSimpleQueueMaxLimit('3', '8'), '3M/8M')
    assert.equal(formatSimpleQueueMaxLimit('3M', '8M'), '3M/8M')
  })

  it('no convierte megas a bits y vuelve a pegar M (3000000M)', () => {
    assert.equal(formatSimpleQueueMaxLimit('3000000', '8000000'), '3M/8M')
    assert.equal(formatSimpleQueueMaxLimit('3000000M', '8000000M'), '3M/8M')
    assert.equal(parseMaxLimit('3000000/8000000').uploadMbps, '3')
    assert.equal(parseMaxLimit('3000000/8000000').downloadMbps, '8')
    assert.equal(parseMaxLimit('3000000M/8000000M').uploadMbps, '3')
    assert.equal(parseMaxLimit('3M/8M').uploadMbps, '3')
    assert.equal(parseMaxLimit('3M/8M').downloadMbps, '8')
    assert.notEqual(formatSimpleQueueMaxLimit('3', '8'), '3000000M/8000000M')
  })

  it('muestra 3M en tabla, no 3000000M', () => {
    assert.equal(displayMbps('3'), '3M')
    assert.equal(displayMbps('3M'), '3M')
    assert.equal(displayMbps('3000000'), '3M')
    assert.equal(displayMbps('3000000M'), '3M')
    assert.equal(displayMbps(''), '—')
  })
})
