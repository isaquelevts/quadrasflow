# Migração da stack do QuadrasFlow

## Estado

A stack antiga segue atendendo produção. A nova base React/Fastify/PostgreSQL está em construção nesta branch isolada. Não altere o proxy do domínio nem o volume SQLite durante as fases de desenvolvimento e preparação.

## Alvo

- Interface: React, TypeScript, Vite, Tailwind e componentes gerados pela CLI oficial Shadcn.
- API: Node.js, TypeScript e Fastify, REST documentada por OpenAPI.
- Banco: PostgreSQL, Drizzle ORM e migrations versionadas.
- Infraestrutura: Docker Compose separado, com volume PostgreSQL próprio e sem reaproveitar bancos de outros serviços da VPS.

## Fases

1. Inventário da stack, dados, backups, rotas e integrações.
2. Fundação em monorepo isolado; a aplicação antiga continua publicada.
3. Migração das telas por áreas funcionais.
4. Schema PostgreSQL, conversão do SQLite e ensaios de restauração em preparação.
5. API Fastify com paridade de contratos e integrações.
6. Ensaio integrado, isolamento entre arenas, segurança e observabilidade.
7. Cutover de produção com backup e retorno definidos.
8. Estabilização e retirada da stack antiga depois do período de confiança.

Cada fase depende de pedido específico do responsável. Aprovação de uma fase não aprova a próxima nem autoriza, por si só, corte de tráfego ou remoção de dados.

## Segredos

Use arquivos de ambiente protegidos fora do controle de versão. Não copie tokens, chaves ou credenciais reais para esta árvore de código, imagens, logs ou exemplos.
