# Auditoria de seguranca do backend MappaHub API

Data: 2026-05-20

Escopo revisado: codigo TypeScript em `src/`, rotas Fastify, auth, imports/exports, upload R2, billing, Places/Geocoding, configuracao e dependencias via `npm audit`.

Observacao: esta revisao e estatica, com build/lint/audit local. Ela nao substitui pentest dinamico, DAST, revisao de infraestrutura, regras reais do bucket R2, configuracao de rede, segredos em runtime ou politicas externas de Google/Stripe/Redis/Postgres.

## Resumo executivo

Apos nova verificacao, varias falhas do relatorio anterior ja foram corrigidas no codigo: tokens sensiveis agora sao hasheados, ha rate limits dedicados em auth, 2FA usa Redis, refresh token tem deteccao de reuse, Helmet foi adicionado, CORS em producao exige `CORS_ORIGIN`, exportacao neutraliza formulas, SVG foi removido do upload, respostas de usuario sao sanitizadas e billing restringe owner/super_admin.

As falhas que ainda permanecem sao:

1. Dependencia vulneravel via `pm2 -> ws`.
2. Rotas Places continuam sem `subscriptionGuard` e sem rate limit dedicado.
3. Upload de imagem ainda confia no `mimetype` informado pelo cliente.
4. Worker de importacao ainda carrega arquivo inteiro em memoria.
5. Criptografia de segredo TOTP e opcional.
6. Defaults de ambiente/SMTP ainda podem permitir configuracao fraca.
7. Lint segue quebrado.

## Achados

### Media - Dependencia vulneravel via `pm2 -> ws`

Evidencia:
- `npm audit --audit-level=low --json` retornou 2 vulnerabilidades moderadas:
  - `ws: Uninitialized memory disclosure`, GHSA-58qx-3vcg-4xpx, `>=8.0.0 <8.20.1`.
  - Afeta `pm2@>=7.0.0`; fix sugerido pelo npm: `pm2@6.0.14` como mudanca major/downgrade.

Impacto: exposicao moderada relacionada a WebSocket transitivo. A explorabilidade depende de como `pm2` e usado em runtime.

Como corrigir:
- Avaliar remover `pm2` de `dependencies` se a plataforma de deploy nao precisa dele dentro da app.
- Se precisar manter `pm2`, acompanhar release com `ws >= 8.20.1` ou testar override compativel.
- Rodar `npm audit` no CI.

### Media - Rotas Places usam chave do servidor sem `subscriptionGuard` nem limite especifico

Evidencia:
- `src/modules/places/places.routes.ts` usa apenas `authenticate` em `/autocomplete` e `/details`.
- As rotas fazem chamadas ao Google Places com `GOOGLE_MAPS_API_KEY`.

Impacto: qualquer usuario autenticado, mesmo sem assinatura ativa, pode consumir quota/custo da chave do servidor. O rate limit global de 100/min e alto para chamadas pagas.

Como corrigir:
- Aplicar `subscriptionGuard` nas rotas Places.
- Adicionar rate limit especifico e baixo por usuario/tenant/IP para autocomplete e details.
- Validar tamanho/formato de `input`, `sessiontoken` e `placeId`.
- Registrar metricas por tenant para bloqueio de abuso.

### Media - Upload de imagem confia no `mimetype` informado pelo cliente

Evidencia:
- `src/modules/tenant/tenant.service.ts` removeu SVG e permite apenas `image/jpeg`, `image/png` e `image/webp`.
- A validacao ainda e feita por `file.mimetype`, sem inspecao de magic bytes ou reprocessamento da imagem.

Impacto: um cliente malicioso pode enviar conteudo que nao corresponde ao MIME declarado. Dependendo de como o arquivo for servido pelo R2/CDN e consumido pelo frontend, isso pode causar content sniffing, quebra de renderizacao ou armazenamento de arquivo inesperado em bucket publico.

Como corrigir:
- Validar magic bytes para JPEG/PNG/WebP antes do upload.
- Considerar reprocessar a imagem para PNG/WebP no backend, descartando metadados e conteudo invalido.
- Definir `Content-Type` somente apos validacao real.
- Garantir `X-Content-Type-Options: nosniff` no dominio publico/CDN quando aplicavel.

### Media - Worker de importacao ainda carrega arquivo inteiro em memoria

Evidencia:
- `src/modules/import/import.routes.ts` agora faz streaming do upload para arquivo temporario, o que remove o peso do processo HTTP.
- `src/modules/import/import.worker.ts` ainda usa `readFile(filePath)` e depois `parseSpreadsheet(fileBuffer, fileName)`, carregando o arquivo inteiro em memoria no worker.

Impacto: arquivos grandes ou XLSX com expansao interna podem consumir muita memoria/CPU no worker, atrasar filas ou derrubar o processo de processamento.

Como corrigir:
- Usar parsing streaming para CSV e, se possivel, para XLSX.
- Limitar linhas, colunas, tamanho de celula e quantidade de campos dinamicos.
- Validar tamanho real do arquivo temporario antes de enfileirar/processar.
- Adicionar timeout e rejeicao de XLSX com zip ratio suspeito.
- Considerar workers isolados com limite de memoria.

### Media - Criptografia do `totpSecret` e opcional

Evidencia:
- `src/config/env.ts` define `TOTP_ENCRYPTION_KEY` como opcional.
- `src/modules/auth/auth.service.ts` cifra/decifra `totpSecret` somente quando `TOTP_ENCRYPTION_KEY` esta configurada.
- Se a chave nao estiver presente, `encryptTotpSecret` retorna o segredo em texto puro.

Impacto: em ambiente sem `TOTP_ENCRYPTION_KEY`, vazamento do banco permite gerar codigos TOTP dos usuarios com 2FA ativo. O 2FA deixa de proteger contra comprometimento do banco.

Como corrigir:
- Exigir `TOTP_ENCRYPTION_KEY` em producao.
- Falhar o boot em producao se a chave nao existir.
- Migrar segredos legados para formato cifrado.
- Documentar rotacao da chave e plano de recuperacao.

### Baixa - Defaults de ambiente e SMTP podem permitir configuracao fraca

Evidencia:
- `src/config/env.ts` ainda tem defaults para `NODE_ENV`, `APP_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM`.
- `sendMail` nao envia e-mail fora de producao.

Impacto: uma producao ou staging mal configurada pode iniciar com comportamento de desenvolvimento, URL incorreta ou SMTP vazio. Isso pode quebrar fluxos de verificacao/reset e gerar vazamento operacional em logs/configuracao.

Como corrigir:
- Criar schema condicional por `NODE_ENV`.
- Em producao, exigir `APP_URL`, `CORS_ORIGIN`, SMTP completo e `TOTP_ENCRYPTION_KEY`.
- Validar HTTPS em `APP_URL` quando `NODE_ENV=production`.
- Documentar variaveis obrigatorias no `.env.example`.

### Baixa - Lint segue quebrado

Evidencia:
- `npm run lint` retorna 19 erros.
- Os erros atuais incluem `noNonNullAssertion`, `useNodejsImportProtocol`, `useLiteralKeys`, `useTemplate` e `noUnusedTemplateLiteral`.

Impacto: a falha de lint nao e necessariamente uma vulnerabilidade direta, mas reduz confianca no CI e pode ocultar regressoes de seguranca/qualidade.

Como corrigir:
- Corrigir os 19 erros ou ajustar regras conscientemente.
- Rodar `npm run lint` no CI como bloqueante.
- Evitar `!` em caminhos sensiveis e substituir por guards explicitos.

## Resultados dos comandos

- `npm run build`: passou.
- `npm run lint`: falhou com 19 erros.
- `npm audit --audit-level=low --json`: confirmou 2 vulnerabilidades moderadas em `pm2/ws`.

## Prioridade sugerida de remediacao

1. Resolver `pm2/ws` ou remover `pm2` das dependencias da aplicacao.
2. Proteger Places com `subscriptionGuard` e rate limit dedicado.
3. Validar magic bytes/reprocessar uploads de imagem.
4. Reduzir risco de memoria no worker de importacao.
5. Exigir `TOTP_ENCRYPTION_KEY` em producao.
6. Endurecer schema de ambiente para producao.
7. Corrigir lint e torna-lo bloqueante no CI.
