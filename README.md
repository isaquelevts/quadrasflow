# QuadrasFlow

Plataforma multiempresa para operação de arenas esportivas. A aplicação foi portada para uma stack TypeScript com interface web, API REST e banco relacional.

## Stack

- Interface: React, TypeScript, Vite, Tailwind CSS e componentes Shadcn.
- API: Node.js 24, TypeScript, Fastify e documentação OpenAPI em `/docs/`.
- Banco: PostgreSQL 18, Drizzle ORM e migrations versionadas.
- Hospedagem: imagens Docker separadas para interface e API; banco em rede privada.

## Áreas funcionais

- Login, criação de arena e administração da plataforma.
- Configuração inicial da arena em quatro etapas: dados e endereço, quadras e modalidades, horários e preços por faixa, fotos e comodidades.
- Cadastro inicial concluído uma vez pelo administrador de cada arena. Funcionários da arena entram diretamente no painel.
- Visão geral, agenda, reservas, bloqueios, quadras, clientes, avaliações, mensalistas, financeiro, torneios, equipe e integrações.
- Página pública de reservas, torneios e avaliações por link.
- Reservas feitas pelo painel, página pública ou WhatsApp usam os preços semanais por faixa; períodos consecutivos de reserva são aceitos.
- Mercado Pago mantém OAuth, links Pix e confirmação por webhook assinado. WhatsApp usa WAHA com configuração isolada por arena.

## Estrutura

- `apps/web`: interface React e configuração do Nginx.
- `apps/api`: API Fastify, autenticação, regras da arena e integrações.
- `packages/contracts`: contratos compartilhados.
- `packages/database`: schema Drizzle, migrations e ferramentas SQLite/PostgreSQL.
- `deploy/compose.staging.yaml`: ambiente isolado de desenvolvimento e ensaio.
- `deploy/compose.cutover.yaml`: serviços web/API da stack de produção, ligados à rede e ao PostgreSQL preparado para o corte.
- `GITHUB-DEPLOY.md`: configuração do GitHub Actions, secrets e fluxo de publicação automática na VPS.
- `MIGRATION.md`: sequência de migração e procedimento de retorno.

## Desenvolvimento

Requisitos: Node.js 24+, npm e PostgreSQL 18.

```sh
npm ci
npm run build
npm run dev:web
npm run dev:api
```

Configure `DATABASE_URL` e as variáveis de integração no ambiente local. Não inclua credenciais, arquivos `.env` ou dados reais no Git. A API usa `/api/`; a interface chama a API pela mesma origem. O Swagger fica em `/docs/`.

Para subir o ensaio Docker, copie `deploy/staging.env.example` para `deploy/staging.env`, use uma senha aleatória local e rode:

```sh
docker compose -f deploy/compose.staging.yaml --env-file deploy/staging.env up -d --build
```

A interface de ensaio fica em `http://127.0.0.1:13013`.

## Migração de dados

O importador `packages/database/scripts/import-sqlite.mjs` verifica a integridade SQLite, importa em transação, valida as chaves estrangeiras e compara a quantidade de registros por tabela. Ele só importa em uma base PostgreSQL vazia. O exportador `packages/database/scripts/export-sqlite.mjs` prepara uma cópia SQLite a partir de um snapshot modelo, valida contagens e integridade e dá suporte ao rollback.

Não execute ferramentas de importação ou exportação com dados reais em ambientes públicos de desenvolvimento. Proteja snapshots e arquivos de ambiente com permissões restritas.

## Produção

A aplicação está publicada em `https://quadrasflow.com.br`. O endereço anterior redireciona para o domínio oficial. O contêiner legado foi parado após a estabilização; seu volume SQLite e o snapshot pré-corte permanecem preservados para rollback. O banco PostgreSQL não é compartilhado com outros produtos da VPS.

O snapshot SQLite pré-corte está em `/opt/quadrasflow/backups`. Há backups verificados do PostgreSQL e das imagens enviadas em `/opt/quadrasflow/backups`, gerados diariamente às 03:15 UTC e mantidos por 14 dias. O arquivo de cron e o script estão em `deploy/`.

O QuadrasFlow precisa de uma instância WAHA própria. Configure `WAHA_BASE_URL=http://waha:3000`, `WAHA_API_KEY`, `WAHA_WEBHOOK_SECRET`, `APP_BASE_URL` e `OPENAI_API_KEY` no ambiente seguro da API. Crie também `deploy/waha.production.env` a partir de `deploy/waha.production.env.example`, usando o mesmo `WAHA_API_KEY`; esse arquivo contém apenas a chave do WAHA e não deve ser versionado. A stack dedicada usa armazenamento próprio para sessão e mídia, sem compartilhar a sessão do OdontoCRM.

Mercado Pago continua dependendo de credenciais OAuth e de webhook configurados separadamente.
