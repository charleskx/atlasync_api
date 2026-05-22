import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret } from '../src/shared/crypto'
import { AppError } from '../src/shared/errors'
import { defineAbilityFor } from '../src/shared/permissions'
import { hashToken } from '../src/shared/token-hash'
import { generateToken, slugify } from '../src/shared/utils'

describe('shared utilities', () => {
  it('slugifies text with accents and punctuation', () => {
    expect(slugify(' São Paulo / Região #1  ')).toBe('sao-paulo-regiao-1')
    expect(slugify('---A---B---')).toBe('a-b')
  })

  it('generates hex tokens with the requested byte length', () => {
    expect(generateToken(4)).toMatch(/^[0-9a-f]{8}$/)
    expect(generateToken()).toHaveLength(64)
  })

  it('hashes tokens deterministically with HMAC', () => {
    const first = hashToken('token', 'secret')
    expect(first).toBe(hashToken('token', 'secret'))
    expect(first).not.toBe(hashToken('token', 'other-secret'))
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })

  it('encrypts and decrypts secrets', () => {
    const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    const encrypted = encryptSecret('totp-secret', key)
    expect(encrypted).toMatch(/^enc:v1:/)
    expect(encrypted).not.toContain('totp-secret')
    expect(decryptSecret(encrypted, key)).toBe('totp-secret')
  })

  it('returns legacy plaintext secrets unchanged', () => {
    const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    expect(decryptSecret('legacy-secret', key)).toBe('legacy-secret')
  })

  it('throws for malformed encrypted payloads', () => {
    const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    expect(() => decryptSecret('enc:v1:broken', key)).toThrow('Formato de ciphertext inválido')
  })

  it('keeps AppError metadata', () => {
    const error = new AppError('FORBIDDEN', 403, 'Sem permissão')
    expect(error.name).toBe('AppError')
    expect(error.code).toBe('FORBIDDEN')
    expect(error.statusCode).toBe(403)
    expect(error.message).toBe('Sem permissão')
  })
})

describe('permissions', () => {
  it('grants super admin full access', () => {
    const ability = defineAbilityFor({ role: 'super_admin' })
    expect(ability.can('delete', 'Tenant')).toBe(true)
    expect(ability.can('manage', 'all')).toBe(true)
  })

  it('grants owner workspace management without Tenant management', () => {
    const ability = defineAbilityFor({ role: 'owner' })
    expect(ability.can('manage', 'Billing')).toBe(true)
    expect(ability.can('delete', 'Tenant')).toBe(false)
  })

  it('grants admin operational access but not billing', () => {
    const ability = defineAbilityFor({ role: 'admin' })
    expect(ability.can('manage', 'Partner')).toBe(true)
    expect(ability.can('manage', 'Billing')).toBe(false)
    expect(ability.can('delete', 'Map')).toBe(false)
  })

  it('keeps employee mostly read-only with partner creation', () => {
    const ability = defineAbilityFor({ role: 'employee' })
    expect(ability.can('read', 'Partner')).toBe(true)
    expect(ability.can('create', 'Partner')).toBe(true)
    expect(ability.can('update', 'Partner')).toBe(false)
  })
})
