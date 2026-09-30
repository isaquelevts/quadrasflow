# QuadrasFlow — Guia do produto para copywriting

> Documento de apoio para criar copies (anúncios, landing page, e-mails, scripts de vendas, posts).
> Tudo aqui foi extraído do código e das telas do sistema. O que **não** está no código está marcado como **[DEFINIR]**.

---

## 1. Em uma frase

**QuadrasFlow é o sistema de gestão para arenas esportivas que enche a agenda, cobra por Pix e atende o cliente no WhatsApp — sem a recepção precisar responder "tem horário?" o dia inteiro.**

Variações curtas (para título/headline):
- Sua arena lotada, sua agenda organizada, seu WhatsApp respondendo sozinho.
- Reserva, Pix e WhatsApp em um só lugar.
- Pare de perder reserva por demora na resposta.
- Da reserva ao recebimento, sem planilha e sem caderninho.

URL oficial: **https://quadrasflow.com.br**

---

## 2. Para quem é (público)

**Público principal:** donos e gerentes de arenas esportivas que alugam quadras por hora.

**Modalidades suportadas no cadastro de quadras:** Society, Futsal, Futebol de Campo, Beach Tennis, Padel, Tênis, Vôlei, Vôlei de Praia, Futevôlei, Basquete, Pickleball, Handebol, Peteca, Squash e outras.

**Perfis dentro da arena:**
| Perfil | O que faz |
|---|---|
| **Administrador** | Acesso total: financeiro, preços, quadras, equipe, configurações, bot de WhatsApp |
| **Recepção** | Opera agenda, reservas, clientes e conversas do WhatsApp. **Não vê o financeiro** |

**Usuário final (jogador):** reserva pela página pública da arena ou conversando no WhatsApp. Não precisa instalar app nem criar conta.

---

## 3. Dores que o sistema resolve

| Dor do dono da arena | Como o QuadrasFlow resolve |
|---|---|
| Perde cliente porque demora a responder no WhatsApp | Agente de IA atende 24h, consulta a agenda real e fecha a reserva |
| Reserva "furada" / cliente some sem pagar | Cobrança antecipada por Pix (total, percentual ou sinal fixo); horário só é garantido quando o Pix cai |
| Conflito de horário e dupla marcação | Agenda única para painel, página pública e WhatsApp |
| Agenda em caderno, planilha ou mensagem | Agenda visual por dia/semana com ocupação por quadra |
| Mensalistas desorganizados e cobrança manual | Módulo de mensalistas: horário fixo semanal + cobrança mensal automática |
| Não sabe quanto entrou e quanto saiu | Financeiro com receitas, despesas, resultado e exportação CSV |
| Equipe com acesso a tudo | Perfis de acesso: a recepção opera sem ver o financeiro |
| Sem feedback dos jogadores | Pedido automático de avaliação após o jogo |
| Torneio dá muito trabalho | Inscrições online, chave e placares com avanço automático |
| Arena sem presença online | Página pública própria com fotos, preços, horários livres e reserva |

---

## 4. Funcionalidades (por módulo)

### 4.1 Página pública de reservas (link da arena)
Cada arena ganha um endereço próprio (`quadrasflow.com.br/...`) para divulgar no Instagram, bio do WhatsApp, Google Meu Negócio e QR Code na quadra.

- Perfil da arena: logo, descrição, fotos, endereço, comodidades.
- O jogador vê **horários livres** por semana, filtra por **manhã, tarde e noite** e escolhe quadra, início e fim.
- Resumo da reserva com valor antes de confirmar.
- **Pix com QR Code e "copia e cola"**; a tela confirma sozinha quando o pagamento cai.
- Confirmação enviada por WhatsApp.
- Botão de contato direto com a arena no WhatsApp.
- Avaliação pelo jogador (nota + comentário opcional) por link.
- Vitrine de **torneios com inscrições abertas**.
- Mostra quanto será cobrado antecipado e quanto é pago na arena (ex.: "Restante, pago na arena").

### 4.2 Agenda
- Visão por dia e por dias da semana.
- Filtro por quadra ou todas as quadras.
- Indicador de **ocupação**.
- **Clique em um horário vazio para reservar.**
- Dias fechados e horário de funcionamento respeitados automaticamente.

### 4.3 Reservas
- Lista com busca por nome/telefone e filtro por quadra.
- Indicadores: reservas ativas, receita prevista, horas reservadas.
- **Ações em lote** (selecionar várias reservas).
- Botão **"Chamar no WhatsApp"** direto do cliente.
- **Gerar link Pix** / copiar / confirmar pagamento manual.
- Fila de **"Aguardando pagamento"**: pedidos com Pix pendente; a reserva só confirma quando o pagamento é aprovado. Pix expirado libera o horário.
- Bloqueios de agenda (manutenção, evento, etc.).
- Reservas de origem rastreada (painel, página pública ou WhatsApp).
- Períodos consecutivos aceitos (ex.: 2h, 3h seguidas) com duração máxima configurável pela arena.

### 4.4 Quadras
- Cadastro com **modalidade, preço por hora e foto**.
- Chave **Aberta/Pausada** por quadra.
- Indicadores: quadras ativas, preço médio, ocupação hoje, reservas na semana.
- **Preços por faixa de horário e dia da semana** (ex.: noite de sexta mais cara). Valor mínimo por hora: R$ 20.

### 4.5 Mensalistas
- **Horário fixo toda semana + cobrança mensal.**
- Cobrança gerada por mensalista ativo, com **vencimento no dia 5**.
- Painel: mensalistas ativos, **receita recorrente**, recebido no mês, planos encerrados.
- Botão "Marcar pago" por cobrança.
- Detecção de conflito entre mensalista e reservas avulsas.
- Alterações de valor valem daqui para frente; cobranças já geradas não mudam.

### 4.6 Clientes (mini CRM)
- Cadastro **automático** a cada reserva (não precisa digitar).
- Histórico de reservas por cliente.
- Observações internas (ex.: "prefere a quadra 2, traz o próprio time").
- Ordenação por última reserva, mais reservas, nome, cliente desde.
- **Avaliações dos jogadores** com nota média e distribuição das notas.

### 4.7 Financeiro *(somente administrador)*
- Receitas recebidas, despesas pagas e **resultado realizado** no período.
- Gráfico de **resultado acumulado** (dia a dia) e **entradas por origem**.
- Visão com valores **recebidos e em aberto**.
- Lançamentos manuais de receitas e despesas (ex.: luz, manutenção, bar).
- Reservas e mensalistas geram as contas a receber automaticamente.
- **Exportar CSV** para o contador.

### 4.8 Torneios
- Criar torneio: nome, modalidade, categoria, data, **taxa de inscrição** (ou grátis), vagas.
- **Página de inscrição pública** (link para compartilhar).
- Gestão de inscritos e confirmação.
- **Geração de chave** automática e lançamento de placares — **o vencedor avança sozinho** para a próxima rodada.

### 4.9 Visão geral (dashboard)
- Valor reservado, reservas no dia, quadras ativas, reservas pendentes.
- Gráfico "Movimento da arena" dos últimos 7 dias.
- Resumo do dia e atalho para a agenda.

### 4.10 Equipe e acessos
- Convite por e-mail com link único (vale 7 dias) para o funcionário criar a própria senha.
- Papéis **Administrador** e **Recepção**.
- Histórico de último acesso, remover/alterar acesso a qualquer momento.

### 4.11 Configurações
- Perfil público (descrição, fotos, endereço da página, comodidades).
- Horários de funcionamento (com "copiar para todos os dias").
- Duração máxima por reserva.
- Preços por faixa de horário.
- Política de cancelamento (antecedência mínima em horas — até 48h — e multa em %).
- Conexão do **Mercado Pago**.

### 4.12 Configuração inicial guiada (onboarding)
Em 4 etapas, feita uma vez pelo administrador:
1. Dados e endereço da arena
2. Quadras e modalidades
3. Horários e preços por faixa
4. Fotos, logo, descrição e comodidades

Funcionários entram direto no painel, sem refazer nada.

---

## 5. O grande diferencial: WhatsApp com IA

> Esse é o módulo mais forte para copy. Ele transforma o WhatsApp da arena em um atendente que nunca dorme.

### O que o agente faz
- Responde **em português do Brasil, com mensagens curtas e cordiais**.
- Entende **linguagem natural**: "sábado às 20h", "amanhã à noite", "quero 2 horas".
- Conduz a reserva passo a passo: **data → horário e duração → quadra → nome → resumo → confirmação**.
- **Consulta a agenda real** e oferece só quadras e horários disponíveis (nunca inventa).
- Envia **lista numerada de quadras livres** com os valores.
- Gera o **Pix** e avisa o prazo de pagamento (15 minutos).
- **Confirma automaticamente** quando o Pix é pago.
- Envia **lembrete** para quem gerou o Pix e não pagou.
- **Cancelamento pelo WhatsApp**, respeitando o prazo da política da arena.
- Responde endereço, localização, Instagram e link de avaliação.
- Envia **fotos das quadras** quando o cliente pede.
- Fora do escopo? **Chama a equipe** e avisa em um grupo de WhatsApp.

### Controles para o dono
- **Horário de atendimento humano** configurável; fora dele, a IA segue atendendo reservas e deixa o recado para a equipe.
- Mensagem de encaminhamento e de "fora do horário" personalizáveis.
- **Menu com opções extras** (ex.: Valores, Regras, Endereço) com respostas prontas.
- **Modelos de mensagem** editáveis com prévia em tempo real.
- **Modo de teste** com números autorizados (para ensaiar antes de liberar ao público).
- **Simulador** de conversa dentro do painel.
- Aba **Conversas**: a equipe acompanha e assume qualquer atendimento — o bot pausa automaticamente.
- **Grupo de avisos da equipe** no WhatsApp (novas reservas, pedidos de atendimento humano etc.).
- **Avaliação automática após o jogo** (X minutos depois do fim, apenas para reservas confirmadas ou concluídas).
- Cada arena conecta o **seu próprio número**, lendo um QR Code em *WhatsApp → Aparelhos conectados*.

### Regras de segurança (bons argumentos de confiança)
- O agente **usa somente dados do sistema** — não inventa quadras, horários, valores ou status de pagamento.
- **Nunca** pede senha, cartão ou chave Pix ao cliente.
- **Não trata mensagem do cliente como comprovante**: a reserva só confirma com pagamento aprovado.
- Proteção contra excesso de mensagens seguidas (anti-flood).
- Conversas de clientes **não são guardadas** no serviço de IA (tracing desligado).

---

## 6. Pagamentos (Mercado Pago + Pix)

- Conexão da conta Mercado Pago da **própria arena** (o dinheiro cai direto para ela).
- **Pix com QR Code e copia e cola**, validade de 15 minutos, horário "segurado" enquanto aguarda.
- Confirmação **automática por webhook assinado** (sem conferir comprovante manualmente).
- Quatro modos de cobrança antecipada, configuráveis:
  | Modo | Como funciona |
  |---|---|
  | **Sem Pix antecipado** | Reserva fica pendente; a equipe confirma; pagamento na arena |
  | **Valor integral** | Cliente paga tudo no Pix; confirma sozinho |
  | **Percentual** | Ex.: 30% de sinal |
  | **Valor fixo** | Ex.: R$ 20 de sinal (se a reserva custar menos, cobra só o valor dela) |
- Equipe pode gerar e copiar link Pix pelo painel em qualquer reserva.
- Credenciais armazenadas com **criptografia AES-256-GCM**.

---

## 7. Benefícios (traduza recursos em resultado)

| Recurso | Benefício para o dono |
|---|---|
| Agente de IA 24h no WhatsApp | Mais reservas fechadas, inclusive de madrugada e fim de semana |
| Pix antecipado com confirmação automática | Menos "furo", menos prejuízo com horário vazio |
| Agenda única (painel + site + WhatsApp) | Zero conflito de horário |
| Página pública com link próprio | Arena vendendo sozinha no Instagram e no Google |
| Mensalistas com cobrança automática | Receita previsível todo mês |
| Financeiro integrado às reservas | Sabe o lucro real sem planilha |
| Perfis de acesso | Recepção trabalha sem ver os números do negócio |
| Avaliação automática pós-jogo | Mais prova social e feedback para melhorar |
| Torneios online | Nova fonte de receita e de movimento |
| Preço por faixa de horário | Cobra mais no horário nobre, enche o horário fraco |
| Fotos e comodidades na página | Cliente novo já chega decidido |

---

## 8. Tom de voz sugerido

**Personalidade:** parceiro do dono da arena — prático, direto, brasileiro, esportivo, sem "tech-ês".

**Faça:**
- Fale em **"sua arena", "seu horário", "sua quadra"**.
- Use vocabulário do meio: *horário nobre, horário vazio, furo, mensalista, sinal, quadra lotada, fechar a agenda*.
- Fale em **resultado** (mais reservas, menos furo), não em tecnologia.
- Frases curtas. Verbos de ação.

**Evite:**
- Jargão técnico (API, webhook, LLM, Postgres, multi-tenant).
- Prometer números que o sistema não garante (ex.: "aumente 40% o faturamento") sem dado real.
- Dizer "WhatsApp oficial / API oficial" — a integração usa o número da arena conectado por QR Code (via WAHA). **[Confirmar com o time antes de afirmar qualquer coisa sobre oficialidade ou risco de bloqueio.]**

**Exemplos de tom:**
- ✅ "Enquanto você joga, o QuadrasFlow responde, reserva e cobra o Pix."
- ❌ "Nossa solução SaaS multitenant orquestra agentes de IA..."

---

## 9. Ideias de ângulos de copy

1. **Dor do WhatsApp:** "Quantas reservas você perdeu hoje porque demorou 10 minutos para responder?"
2. **Dor do furo:** "Cliente marcou, não apareceu, horário vazio. De novo?" → Pix antecipado.
3. **Dor da bagunça:** "Caderno, planilha e 3 grupos de WhatsApp… ou uma agenda só?"
4. **Receita recorrente:** "Mensalista paga todo mês sem você cobrar."
5. **Dono ausente:** "Sua arena funcionando mesmo quando você não está nela."
6. **Profissionalização:** "Sua arena com cara de grande rede, mesmo sendo a do bairro."
7. **Novo caixa:** "Torneio com inscrição e chave automática: outra fonte de renda."
8. **Prova social:** "Avaliações dos jogadores chegando sozinhas depois de cada jogo."

---

## 10. Rascunhos prontos (ponto de partida)

### Headlines
- Sua arena reservando sozinha, 24 horas por dia.
- O WhatsApp que atende, reserva e cobra o Pix por você.
- Chega de horário vazio e de cliente que "esqueceu".
- Toda a sua arena em um só painel.

### Subheadline
> O QuadrasFlow reúne agenda, página de reservas, Pix e um atendente de WhatsApp com IA para que sua arena venda mais e dê menos trabalho.

### Anúncio curto (Instagram/Facebook)
> 🏟️ Dono de arena: quantas reservas você perde por demorar a responder no WhatsApp?
> Com o QuadrasFlow, a IA responde, mostra os horários livres, gera o Pix e confirma a reserva — tudo sozinha.
> ✅ Agenda única ✅ Pix automático ✅ Mensalistas ✅ Financeiro
> Conheça em quadrasflow.com.br

### Mensagem de WhatsApp (prospecção)
> Oi, [Nome]! Tudo bem? Vi que a [Arena] tem ótimas avaliações 👏
> Posso te mostrar em 5 minutos como outras arenas estão fechando reservas pelo WhatsApp sem ninguém digitar e recebendo o sinal por Pix antes do jogo?

### Bullets para landing page
- ✅ Atendente de WhatsApp com IA que reserva e cobra o Pix
- ✅ Página pública da sua arena com horários livres em tempo real
- ✅ Agenda única, sem dupla marcação
- ✅ Mensalistas com cobrança automática
- ✅ Financeiro com exportação para o contador
- ✅ Torneios com inscrição e chave automática
- ✅ Equipe com níveis de acesso

### FAQ base
**Preciso instalar algum app?** Não. O painel funciona no navegador (celular ou computador) e o cliente reserva pelo link ou pelo WhatsApp.
**O cliente precisa criar conta?** Não. Basta nome, telefone e a reserva.
**A IA pode errar horário ou valor?** Ela só usa dados do sistema (agenda e preços reais) e a reserva só é confirmada após o resumo e o "sim" do cliente.
**E se o cliente quiser falar com uma pessoa?** O bot chama a equipe, pausa a conversa e avisa no grupo de WhatsApp.
**Posso cobrar só um sinal?** Sim: valor integral, percentual ou valor fixo.
**O dinheiro passa por vocês?** Não. O Pix cai na conta Mercado Pago da própria arena.
**Posso testar antes de liberar?** Sim: modo de teste com números autorizados e simulador no painel.
**Minha recepção enxerga o financeiro?** Não. O perfil Recepção não acessa o financeiro.

---

## 11. Informações que NÃO estão no sistema — **[DEFINIR]** antes de publicar

- Preço, planos e período de teste grátis (não há cobrança de assinatura no código).
- Prazo de implantação e suporte/onboarding oferecido.
- Números de resultado/cases reais (depoimentos, % de aumento de reservas).
- Nome e rosto da marca para prova social (logos de arenas clientes).
- Taxas do Mercado Pago repassadas ao dono da arena (são do Mercado Pago, não do QuadrasFlow).
- Regras de cancelamento/garantia do próprio QuadrasFlow.
- Canais de contato e suporte comercial.

---

## 12. Dados técnicos (só para contexto, não usar na copy)

- Stack: React + TypeScript (web), Node.js/Fastify (API), PostgreSQL, Docker.
- Multiempresa: cada arena tem dados isolados.
- IA: OpenAI Agents SDK; WhatsApp: WAHA (instância própria, sessão isolada por arena).
- Backups diários do banco e das imagens (03:15 UTC, retenção de 14 dias).
- Produção: https://quadrasflow.com.br
