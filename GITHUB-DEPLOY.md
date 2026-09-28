# GitHub e publicação do QuadrasFlow

## Fluxo de atualização

O GitHub é a origem do código publicado. Faça alterações numa branch, envie os commits com `git push`, abra um pull request e integre-o em `main` depois da revisão. O workflow em `.github/workflows/quadrasflow.yml` valida pull requests, cria imagens identificadas pelo SHA do commit e, quando `main` recebe uma atualização, publica API e interface na VPS.

Edições ainda não commitadas não podem ser sincronizadas com segurança. O GitHub não recebe arquivos automaticamente a cada salvamento; o envio começa quando há commits e um push.

## Preparação necessária no GitHub

1. Sincronize primeiro a versão atual do produto com `main` por um pull request revisado. O `main` atual do remoto é anterior à migração React/Fastify/PostgreSQL; não faça deploy dele antes de atualizar o código-base.
2. Em **Settings → Secrets and variables → Actions**, crie os secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_PRIVATE_KEY` e `VPS_KNOWN_HOSTS`.
3. Use uma chave SSH exclusiva para publicação e um usuário VPS com acesso apenas às operações Docker necessárias. Confira a chave de host da VPS por um canal confiável antes de gravá-la em `VPS_KNOWN_HOSTS`.
4. A primeira execução publica os pacotes `quadrasflow-api` e `quadrasflow-web` no GitHub Container Registry. Deixe ambos públicos para permitir o pull sem colocar um token de leitura do registry na VPS. Se preferir pacotes privados, será necessário configurar autenticação GHCR na VPS antes da primeira publicação.
5. Ative proteção de branch para `main` e exija que o workflow de validação passe antes do merge.

## Preparação necessária na VPS

O deploy usa um checkout limpo e separado em `/opt/quadrasflow/github-release`. Ele não usa nem limpa as worktrees de desenvolvimento. Crie `/opt/quadrasflow/secrets` com permissão restrita e coloque ali os arquivos `production.env`, `waha.production.env` e `staging.env` já usados pela stack atual. Eles não devem entrar no GitHub. O script cria links a partir do checkout de release para esses arquivos.

O primeiro deploy só prossegue se os três arquivos existirem e o container `quadrasflow-cutover-database-1` estiver acessível. Antes das migrations, o script grava um dump PostgreSQL em `/opt/quadrasflow/backups/github-deploy`. Ele executa a migration e atualiza apenas API e web; não recria banco, WAHA nem volumes persistentes. Se a migration ou o healthcheck falhar, o workflow termina como falho e o backup fica disponível para recuperação operacional.

## Primeira sincronização do código

O workflow já pode ser preparado numa branch, mas a primeira sincronização do produto precisa ser revisada: o `main` remoto está antigo e a worktree atual contém dezenas de arquivos modificados e novos, ainda sem commit. Revise o conjunto completo e abra um pull request para `main`; não envie essas mudanças diretamente nem use um `git pull` sobre uma worktree que contenha trabalho local.

O ambiente atual não tem `gh` autenticado. Portanto, esta configuração não cria commits, não faz push ao repositório e não inicia a primeira publicação. Depois que os arquivos deste setup forem revisados e enviados ao GitHub, a pipeline passa a validar e publicar os próximos merges em `main` automaticamente.
