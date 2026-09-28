# Migração do QuadrasFlow

## Objetivo

Migrar integralmente a aplicação legada para uma stack tipada e suportada para webapps: React, TypeScript, Vite, Tailwind e componentes Shadcn na interface; Fastify e TypeScript na API; PostgreSQL, Drizzle ORM e migrations versionadas no banco.

## Estado atual

As etapas de inventário, implementação, importação dos dados, publicação e estabilização foram concluídas. `quadras.helioscreative.com.br` serve a nova stack React/Fastify/PostgreSQL. O container legado foi parado; o container, o volume SQLite e o snapshot de pré-corte foram preservados para rollback.

## Etapas

1. Inventariar a stack, os dados, as rotas, os backups e as integrações.
2. Criar a base do monorepo e o ambiente isolado.
3. Portar as áreas funcionais da interface, incluindo cadastro e configuração inicial de uma arena.
4. Criar o schema PostgreSQL, as migrations e o importador do SQLite.
5. Portar a API e manter compatibilidade dos contratos e integrações.
6. Ensaiar importação, autenticação, reservas, isolamento entre arenas, segurança e operação.
7. Publicar a nova stack em `quadras.helioscreative.com.br`, preservando o serviço e os dados antigos para rollback. **Concluída.**
8. Acompanhar a produção e retirar a stack antiga depois do período de confiança. **Concluída; container legado parado, dados preservados.**

O responsável autorizou a execução contínua até a última etapa. O domínio e o volume SQLite não devem ser removidos durante a estabilização. O serviço legado foi parado após a confirmação operacional da stack nova e de cópias de segurança verificadas.

## Banco e segurança

- O PostgreSQL é uma stack própria e não usa bancos de outros produtos da VPS.
- O importador verifica integridade e chaves estrangeiras do SQLite e compara a contagem de linhas após a importação transacional.
- Arquivos de ambiente e snapshots com dados reais ficam fora do Git, com permissões restritas.
- O snapshot SQLite pré-corte fica em `/opt/quadrasflow/backups`; o PostgreSQL recebe cópias verificadas diárias, com retenção local de 14 dias.
- Senhas, cookies de sessão e tokens de integração não devem aparecer em logs nem ser gravados nas imagens.
- As credenciais legadas de integração não estavam configuradas na instalação encontrada; WhatsApp e Mercado Pago seguem desconectados até serem configurados pelo administrador.

## Reversão

Manter o contêiner legado `quadrasflow-app-1`, o volume `quadrasflow_install_data`, o snapshot SQLite `/opt/quadrasflow/backups/quadrasflow-pre-migration-20260926T0040Z.sqlite` e o arquivo anterior de roteamento Traefik `/opt/quadrasflow/backups/traefik-quadrasflow-before-cutover.yaml`.

Se for preciso voltar depois que a nova stack já recebeu gravações, primeiro exporte a base PostgreSQL para um SQLite baseado no snapshot anterior. Execute `packages/database/scripts/export-sqlite.mjs` com o `DATABASE_URL` de produção, o snapshot como template e um destino novo; o script valida contagens, integridade e relações antes de disponibilizar a cópia. Em seguida, pare o app legado, preserve o arquivo SQLite atual com outro nome, coloque a cópia exportada em `DATA_DIR/quadrasflow.sqlite`, restaure o roteamento anterior e reative o app. Nunca remova os volumes durante o rollback.

O backup diário roda às 03:15 UTC via `/etc/cron.d/quadrasflow-postgres-backup`, valida o arquivo com `pg_restore --list` e mantém 14 dias no diretório de backups.
