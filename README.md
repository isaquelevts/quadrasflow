# QuadrasFlow

Webapp responsivo de gestão de arenas. O primeiro corte técnico adiciona autenticação, administração multiempresa e API de base, preservando o painel visual já criado.

## Estado atual

- `index.html`: painel responsivo conectado à sessão, quadras, agenda, reservas e clientes; permite confirmar/cancelar reservas e consulta indicadores diários.
- `platform.html`: painel de administração para cadastrar, ativar e suspender empresas.
- `server.mjs`: servidor web e API, autenticação por sessão e banco SQLite persistente.
- `scripts/bootstrap-admin.mjs`: cria o primeiro administrador da plataforma.
- `public.html`: perfil público configurável, inscrições em torneios, pedidos de reserva e avaliações por link de uso único.
- `Dockerfile`, `compose.yaml` e `Caddyfile`: execução do app atrás de HTTPS automático com volume persistente.
- `scripts/backup.sh` e `Dockerfile.backup`: snapshot consistente do SQLite, retenção local e cópia opcional via rclone.
- A tela da arena permite criar e editar reservas, bloquear horários, registrar conclusão/cancelamento e acompanhar clientes, mensalistas, torneios e lançamentos financeiros. Horários seguem marcações de 30 minutos; reserva tem duração mínima de 1 hora e bloqueia conflitos. O histórico registra alterações de estado e motivos de cancelamento.
- Cada arena tem horários semanais, perfil e sessão WAHA isolados. O robô recebe mensagens, guia a reserva por quadra/data/horário e cria pedidos pendentes; quando a conta Mercado Pago está conectada, envia o link de pagamento junto. Pedidos para falar com uma pessoa pausam o robô e entram na caixa de conversas do painel. Avaliações podem ser solicitadas ao concluir uma reserva, se WAHA estiver conectado.
- As arenas conectam individualmente suas contas Mercado Pago por OAuth; links de pagamento são gerados para reservas e o webhook assinado confirma a reserva e lança o valor no financeiro da arena.

## Requisitos

- Node.js 24 ou superior (usa o módulo SQLite incluído no Node).
- Uma VPS Linux com volume persistente para o banco e backups.
- Domínio com HTTPS antes de liberar o painel para uso externo.

## Rodar localmente

1. Copie `.env.example` para `.env`.
2. Configure `APP_BASE_URL` com a URL que será usada para acessar o app. Para desenvolvimento local, deixe a variável vazia.
3. Defina `BOOTSTRAP_EMAIL`, `BOOTSTRAP_NAME` e uma senha longa em `BOOTSTRAP_PASSWORD`.
4. Rode `npm run setup:admin` uma vez para criar o administrador inicial.
5. Remova `BOOTSTRAP_PASSWORD` de `.env` depois do primeiro uso.
6. Rode `npm start` e abra `http://localhost:3000/platform.html`.

Depois do login do administrador, use **Nova empresa** para criar uma arena e a conta do primeiro administrador dela. O e-mail precisa ser único na plataforma; a senha inicial precisa ter pelo menos 14 caracteres. O administrador da arena abre `/` (ou `index.html` pelo servidor), entra com essa conta, cadastra as quadras e passa a registrar as reservas.

## Hospedagem na VPS Hostinger

1. Instale Node.js 24 LTS na VPS e mantenha o código em uma pasta de serviço dedicada.
2. Configure o `.env` com `NODE_ENV=production`, `PORT`, `DATA_DIR` em um volume persistente e `APP_BASE_URL` com o domínio HTTPS definitivo.
3. Execute o cadastro do administrador inicial uma única vez; retire a senha de bootstrap do ambiente depois.
4. Mantenha o Node escutando internamente na porta definida e configure o proxy reverso da VPS para encaminhar o domínio com HTTPS.
5. Restrinja o acesso direto à porta da aplicação; exponha ao público somente o proxy HTTPS.
6. Configure serviço de inicialização automática e reinício após falha.
7. Faça backup agendado de `DATA_DIR` para fora da VPS e teste a restauração antes de cadastrar dados reais.

O servidor respeita `APP_BASE_URL` ao validar a origem das solicitações que alteram dados. Use a mesma URL pública no navegador e na configuração do servidor.

## Multiempresa e acesso

- `platform_admin` administra o cadastro e o estado das empresas.
- `arena_admin` pertence a uma única empresa.
- A empresa é obtida da sessão autenticada, nunca de um `company_id` enviado pelo navegador.
- Todas as tabelas de operação incluem a empresa proprietária e as consultas administrativas da arena sempre usam o identificador da sessão.
- Suspender uma empresa bloqueia suas sessões de acesso.
- Sessões são mantidas em cookie `HttpOnly`, `SameSite=Lax`; em produção o cookie recebe também `Secure`.

## API inicial

- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`
- `GET /api/platform/companies`, `POST /api/platform/companies`
- `PATCH /api/platform/companies/:id/status`
- `GET /api/dashboard?date=AAAA-MM-DD`
- `GET /api/arena/settings`, `PUT /api/arena/settings` (horários semanais; apenas administrador da arena pode salvar)
- `PUT /api/arena/profile` (perfil público, comodidades, fotos por URL HTTPS e visibilidade das seções)
- `GET/PUT /api/integrations/waha`, `GET /api/integrations/waha/status`, `GET /api/integrations/waha/qr`
- `GET /api/integrations/mercadopago`, `POST /api/integrations/mercadopago/connect`, callback OAuth e `POST /api/bookings/:id/pix-link`
- `POST /api/webhooks/mercadopago` (validação de assinatura, confirmação da reserva e lançamento financeiro)
- `POST /api/webhooks/waha/:slug` (cabeçalho `X-QuadrasFlow-Secret`; eventos `message` e `session.status`)
- `GET/POST /api/finance`, `PATCH /api/finance/:id/paid`
- `GET/POST /api/monthly-members`, `PATCH /api/monthly-members/:id/status`, `PATCH /api/monthly-charges/:id/paid`
- `GET/POST /api/tournaments`, inscrição pública, confirmação manual, geração de chave e placares
- `GET /api/reviews`, submissão pública por link seguro
- `GET /api/courts`, `POST /api/courts` (campo de preço: `priceCents`)
- `GET /api/clients`, `POST /api/clients`
- `GET /api/bookings?date=AAAA-MM-DD`, `POST /api/bookings`, `PATCH /api/bookings/:id/status` (confirmar/cancelar)
- `POST /api/blocks`, `DELETE /api/blocks/:id` (bloquear/liberar horário)
- `GET /api/public/arenas/:slug?date=AAAA-MM-DD`, `POST /api/public/arenas/:slug/bookings`
- `GET /api/health`

As rotas de painel, quadras, clientes e reservas exigem sessão de usuário de arena. A criação de reserva recebe `startAt` e `endAt` como datas com horário, limita os inícios a marcações de 30 minutos, exige ao menos 1 hora e aceita durações adicionais em blocos de 30 minutos. Bloqueios também impedem reservas conflitantes e podem ser liberados pela agenda. A página pública exibe as informações selecionadas no perfil da arena, informa o valor estimado, aplica os horários semanais, solicita nome e WhatsApp e limita reservas aos próximos 90 dias; a confirmação ainda é manual. Fotos são configuradas por links HTTPS, até seis. O sistema calcula o preço proporcional à duração e rejeita sobreposição, incluindo solicitações concorrentes. Exemplo: uma quadra de R$ 120/h custa R$ 120 das 19:00 às 20:00 e R$ 180 das 19:00 às 20:30.

## Pontos de implantação pendentes

- Configure `DOMAIN`, `APP_BASE_URL`, `WAHA_BASE_URL`, `WAHA_API_KEY` e um `WAHA_WEBHOOK_SECRET` forte no `.env` da VPS. No WAHA, configure a URL exibida na tela WhatsApp por sessão, o cabeçalho `X-QuadrasFlow-Secret` e os eventos `message` e `session.status`.
- No Mercado Pago, crie a aplicação no modelo Marketplace/Checkout Pro, configure o callback OAuth `/api/integrations/mercadopago/callback` e o webhook de pagamentos em `/api/webhooks/mercadopago`. Configure `MERCADOPAGO_APP_ID`, `MERCADOPAGO_CLIENT_SECRET`, `MERCADOPAGO_ENCRYPTION_KEY` (32 bytes aleatórios em hexadecimal) e `MERCADOPAGO_WEBHOOK_SECRET` no servidor. Cada arena deve conectar uma conta vendedora elegível; o token OAuth é criptografado no banco e renovado automaticamente. Verifique as condições de habilitação do Marketplace e use contas de teste antes do piloto.
- O Checkout Pro prioriza Pix e exclui cartões e meios offline configurados. O Mercado Pago informa que saldo em conta não pode ser removido como meio de pagamento; confira as opções que a conta vendedora habilita durante a homologação.
- Para inscrições em torneios e cobranças de mensalistas, o Pix ainda é confirmado manualmente; somente a cobrança de reserva avulsa foi conectada ao fluxo Mercado Pago.
- Antes do piloto: apontar DNS, verificar portas 80/443, criar o primeiro admin, configurar armazenamento remoto do rclone, agendar backup diário, confirmar permissões e testar restauração/isolamento.

## Implantação Docker na VPS

1. Copie `.env.example` para `.env`, configure domínio, WAHA, credenciais/segredo Mercado Pago e mantenha o arquivo fora do repositório.
2. Aponte o DNS do domínio para a VPS e libere as portas 80 e 443. Confirme que nenhum outro proxy está usando essas portas.
3. Cadastre no Mercado Pago a URL de callback OAuth e o webhook de pagamentos documentados acima. Configure `RCLONE_CONFIG_PATH` para um arquivo rclone fora do projeto com permissão restrita. O caminho remoto `BACKUP_REMOTE` deve apontar para armazenamento fora da VPS.
4. Crie o administrador inicial com `docker compose run --rm app node scripts/bootstrap-admin.mjs`; depois remova `BOOTSTRAP_PASSWORD` do `.env`.
5. Inicie o serviço com `docker compose up -d --build`.
6. Agende `docker compose run --rm backup` diariamente no cron. O comando também mantém snapshots locais por 14 dias e envia cada arquivo ao remoto configurado.

O serviço de backup depende de `sqlite3`, rclone e de um destino remoto configurado. Sem `BACKUP_REMOTE`, o script informa que a cópia ficou somente na VPS.

## Migração de stack em andamento

O repositório está sendo modernizado em uma branch de preparação. O serviço publicado continua usando a stack e o banco atuais até que a migração completa seja validada e autorizada para publicação. Consulte [MIGRATION.md](MIGRATION.md) para a arquitetura-alvo, as fases e os critérios de cutover.
