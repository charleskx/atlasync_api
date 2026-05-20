#!/usr/bin/env node
/**
 * Script de release automático
 *
 * Uso:
 *   npm run release          → pergunta patch / minor / major
 *   npm run release patch    → bump automático sem perguntar
 *   npm run release minor
 *   npm run release major
 *   npm run release 2.1.0    → versão específica
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

// ── helpers ──────────────────────────────────────────────────────────────────

const run = (cmd, silent = false) =>
  execSync(cmd, { encoding: 'utf8', stdio: silent ? 'pipe' : 'pipe' }).trim()

const ask = (question) =>
  new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (ans) => { rl.close(); resolve(ans.trim()) })
  })

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
}
const c = (color, text) => `${colors[color]}${text}${colors.reset}`
const log = (msg) => console.log(msg)
const step = (msg) => console.log(`\n${c('cyan', '→')} ${c('bold', msg)}`)
const ok = (msg) => console.log(`${c('green', '✓')} ${msg}`)
const warn = (msg) => console.log(`${c('yellow', '!')} ${msg}`)
const err = (msg) => { console.error(`${c('red', '✗')} ${msg}`); process.exit(1) }

// ── commit type → seção do changelog ─────────────────────────────────────────

const SECTIONS = {
  feat:     'Adicionado',
  fix:      'Corrigido',
  perf:     'Performance',
  refactor: 'Refatorado',
  security: 'Segurança',
  docs:     'Documentação',
  chore:    'Alterações internas',
}

// Tipos que valem a pena aparecer no changelog (chore de release é ignorado)
const VISIBLE = ['feat', 'fix', 'perf', 'refactor', 'security', 'docs']

function parseCommits(raw) {
  const grouped = {}

  for (const line of raw.split('\n').filter(Boolean)) {
    // formato: <hash> <mensagem>
    const [, msg] = line.match(/^[a-f0-9]+ (.+)$/) ?? []
    if (!msg) continue

    // Ignora commits de release anteriores
    if (/^chore: release v/.test(msg)) continue

    // Conventional commits: tipo(escopo)!: descrição  ou  tipo: descrição
    const match = msg.match(/^(\w+)(?:\([^)]+\))?!?:\s*(.+)$/)
    if (!match) {
      // Commit sem padrão — agrupa em "outros"
      if (!grouped.other) grouped.other = []
      grouped.other.push(msg)
      continue
    }

    const [, type, desc] = match
    const section = SECTIONS[type] ?? null
    if (!section) continue
    if (!VISIBLE.includes(type)) continue

    if (!grouped[section]) grouped[section] = []
    void grouped.other // limpeza — não usado aqui
    grouped[section].push(desc.charAt(0).toUpperCase() + desc.slice(1))
  }

  return grouped
}

function buildChangelogSection(version, date, grouped) {
  const lines = [`## [${version}] - ${date}`, '']

  const sectionOrder = Object.values(SECTIONS).filter(s => grouped[s]?.length)
  if (grouped.other?.length) sectionOrder.push('Outros')

  if (sectionOrder.length === 0) {
    lines.push('- Melhorias e correções internas')
    lines.push('')
    return lines.join('\n')
  }

  for (const section of sectionOrder) {
    const items = grouped[section] ?? []
    if (!items.length) continue
    lines.push(`### ${section}`)
    for (const item of items) lines.push(`- ${item}`)
    lines.push('')
  }

  return lines.join('\n')
}

// ── bump de versão ────────────────────────────────────────────────────────────

function bumpVersion(current, type) {
  const [maj, min, pat] = current.split('.').map(Number)
  if (type === 'major') return `${maj + 1}.0.0`
  if (type === 'minor') return `${maj}.${min + 1}.0`
  if (type === 'patch') return `${maj}.${min}.${pat + 1}`
  // versão explícita
  if (/^\d+\.\d+\.\d+$/.test(type)) return type
  err(`Tipo inválido: "${type}". Use patch, minor, major ou uma versão como 2.1.0`)
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  log('')
  log(c('bold', '🚀 MappaHub API — Release'))
  log(c('gray', '─'.repeat(40)))

  // 1. Verificações
  step('Verificando estado do repositório')

  const branch = run('git rev-parse --abbrev-ref HEAD')
  if (branch !== 'main') err(`Você está na branch "${branch}". Faça o release a partir da main.`)
  ok('Branch: main')

  const dirty = run('git status --porcelain')
  if (dirty) err('Há arquivos não commitados. Faça commit ou stash antes de continuar.')
  ok('Working tree limpa')

  run('git fetch --tags --quiet')
  ok('Tags atualizadas')

  // 2. Versão atual e última tag
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const currentVersion = pkg.version
  let lastTag = ''
  try { lastTag = run('git describe --tags --abbrev=0') } catch { /* sem tags ainda */ }

  log(c('gray', `   Versão atual: ${currentVersion}  |  Última tag: ${lastTag || 'nenhuma'}`))

  // 3. Tipo de bump
  let bumpType = process.argv[2]

  if (!bumpType) {
    log('')
    log('  Tipo de versão:')
    log(c('gray', `    [1] patch  → ${bumpVersion(currentVersion, 'patch')}`))
    log(c('gray', `    [2] minor  → ${bumpVersion(currentVersion, 'minor')}`))
    log(c('gray', `    [3] major  → ${bumpVersion(currentVersion, 'major')}`))
    log('')
    const choice = await ask('  Escolha (1/2/3) ou digite a versão: ')
    bumpType = choice === '1' ? 'patch' : choice === '2' ? 'minor' : choice === '3' ? 'major' : choice
  }

  const newVersion = bumpVersion(currentVersion, bumpType)
  log('')
  ok(`Nova versão: ${c('bold', `v${newVersion}`)}`)

  // 4. Coletar commits desde a última tag
  step('Coletando commits')

  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD'
  const rawCommits = run(`git log ${range} --oneline --no-merges`)

  if (!rawCommits) warn('Nenhum commit novo desde a última tag.')

  const grouped = parseCommits(rawCommits)
  const totalItems = Object.values(grouped).flat().length
  ok(`${totalItems} mudança(s) encontrada(s)`)

  // 5. Gerar bloco do changelog
  step('Gerando CHANGELOG')

  const today = new Date().toISOString().split('T')[0]
  const newSection = buildChangelogSection(newVersion, today, grouped)

  const changelog = readFileSync('CHANGELOG.md', 'utf8')
  const updated = changelog.replace(
    '## [Unreleased]',
    `## [Unreleased]\n\n${newSection}`,
  )
  writeFileSync('CHANGELOG.md', updated)
  ok('CHANGELOG.md atualizado')

  // Prévia
  log('')
  log(c('gray', '┌─ Prévia das notas ─────────────────────────'))
  for (const line of newSection.split('\n').slice(0, 12)) {
    log(c('gray', `│ ${line}`))
  }
  if (newSection.split('\n').length > 12) log(c('gray', '│ ...'))
  log(c('gray', '└────────────────────────────────────────────'))

  // 6. Atualizar package.json
  step('Atualizando package.json')
  pkg.version = newVersion
  writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`)
  ok(`version: ${newVersion}`)

  // 7. Confirmar
  log('')
  const confirm = await ask(c('yellow', `  Criar e publicar v${newVersion}? (s/N) `))
  if (!['s', 'S', 'y', 'Y'].includes(confirm)) {
    warn('Release cancelado. Os arquivos foram modificados mas nada foi commitado.')
    process.exit(0)
  }

  // 8. Commit + tag + push
  step('Criando commit e tag')
  run('git add CHANGELOG.md package.json')
  run(`git commit -m "chore: release v${newVersion}"`)
  ok('Commit criado')

  run(`git tag v${newVersion}`)
  ok(`Tag v${newVersion} criada`)

  step('Fazendo push')
  run('git push origin main')
  ok('Branch main enviada')

  run(`git push origin v${newVersion}`)
  ok(`Tag v${newVersion} enviada`)

  log('')
  log(c('green', c('bold', `✅ Release v${newVersion} publicado com sucesso!`)))
  log(c('gray', '   GitHub Actions está criando o Release e acionando o deploy no Coolify.'))
  log(c('gray', '   Acompanhe em: https://github.com/charleskx/mappahub-api/actions'))
  log('')
}

main().catch((e) => { console.error(e); process.exit(1) })
