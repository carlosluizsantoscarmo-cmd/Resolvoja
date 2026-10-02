# Resolvo Já — site com lista de espera (Cloudflare Pages)

Página inicial + cadastro da lista de espera + área da equipe para ver os cadastros. Roda 100% no Cloudflare (Pages + Functions + KV), sem servidor para cuidar.

```
public/index.html     página do site (cadastro envia para /api/lead)
public/admin.html     área da equipe (token) para ver, baixar e excluir cadastros
functions/api/lead.js    recebe o cadastro, valida e grava no KV
functions/api/leads.js   lista (JSON/CSV) e exclui; exige ADMIN_TOKEN
test/functions.test.mjs  13 testes das funções (npm test)
```

## Dois caminhos para publicar

**Caminho A: pelo GitHub e pelo navegador (não precisa instalar nada).** É o mais simples. Siga a seção "Publicar pelo GitHub" abaixo.

**Caminho B: pelo terminal (precisa do Node.js).** Segue o "Passo a passo" mais abaixo. Para usá-lo, renomeie `wrangler.toml.opcional` para `wrangler.toml`. Não faça isso no Caminho A, porque o arquivo trava as configurações do painel do Cloudflare.

## Publicar pelo GitHub (Caminho A)

1. **Repositório.** No github.com, crie um repositório **privado** chamado `resolvoja-site`. Clique em "uploading an existing file" e arraste o conteúdo desta pasta (as pastas `public`, `functions` e `test`, mais `package.json`, `LEIAME.md` e `.gitignore`). Confirme que as pastas subiram com os arquivos dentro. Não suba senhas nem tokens.
2. **Cloudflare.** Em dash.cloudflare.com, abra **Workers & Pages > Create > Pages > Connect to Git**, autorize o GitHub e escolha o repositório.
3. **Configuração do build.** Deixe o comando de build **vazio** e escreva `public` em "Build output directory". Clique em **Save and Deploy**. As funções da pasta `functions` são detectadas sozinhas.
4. **Armazenamento dos cadastros.** Em **Storage & Databases > KV**, crie um namespace chamado `LEADS`. Depois, no projeto, abra **Settings > Bindings > Add > KV namespace**, use o nome de variável `LEADS` e escolha esse namespace.
5. **Senha da equipe e domínios permitidos.** Em **Settings > Variables and Secrets**, adicione `ADMIN_TOKEN` (tipo *Secret*, com 16 caracteres ou mais) e `ALLOWED_ORIGINS` com o valor `https://www.resolvoja.app.br,https://resolvoja.app.br`.
6. **Publicar de novo.** Em **Deployments**, refaça o deploy mais recente (Retry deployment) para as configurações valerem. Teste em `resolvoja.pages.dev`.

A partir daí, cada alteração que você subir no GitHub publica o site sozinho.

## O que eu testei e o que não testei
- Testado: as funções (13 testes com um KV de mentira) e a página no navegador (cadastro, erro de validação, área da equipe com token certo e errado).
- **Não testado:** o Cloudflare de verdade (não tenho acesso à sua conta nem à internet liberada para ele daqui). Siga o passo a passo e faça um cadastro de teste no final.

## Passo a passo pelo terminal (Caminho B, cerca de 20 minutos)

Os nomes dos menus do Cloudflare mudam de vez em quando; se algo estiver em outro lugar, procure pelo mesmo nome.

**1. Conta e ferramenta.** Crie a conta grátis em cloudflare.com. No computador, instale o Node.js (nodejs.org, versão 20 ou mais) e, dentro desta pasta, rode `npm install --save-dev wrangler` e depois `npx wrangler login` (abre o navegador para autorizar).

**2. Criar o projeto Pages.** Rode `npx wrangler pages project create resolvoja --production-branch main`.

**3. Criar o armazenamento dos cadastros (KV).** Rode `npx wrangler kv namespace create LEADS`. Copie o `id` que aparecer e cole no `wrangler.toml` (renomeado de `wrangler.toml.opcional`), no lugar de `COLE_AQUI_O_ID_DO_KV`.

**4. Definir a senha da equipe.** Escolha um token longo (16 caracteres ou mais; use um gerador de senhas) e rode `npx wrangler pages secret put ADMIN_TOKEN --project-name resolvoja`, colando o token quando pedir. Guarde-o: é a senha de `/admin.html`. Sem ele, ninguém consegue ver os cadastros.

**5. Publicar.** Rode `npm run deploy`. O Cloudflare devolve um endereço `resolvoja.pages.dev`. Abra-o e faça um cadastro de teste.

**6. Conferir.** Abra `https://resolvoja.pages.dev/admin.html`, cole o token e veja o cadastro de teste. Exclua-o pelo botão.

## Ligar o domínio resolvoja.app.br

O jeito mais simples é entregar o DNS ao Cloudflare:

1. No Cloudflare, **Add a site**, digite `resolvoja.app.br` e escolha o plano grátis. Ele mostra dois nomes de servidor (algo como `xxx.ns.cloudflare.com`).
2. No Registro.br, abra o domínio, vá em **DNS > Alterar servidores DNS** e troque pelos dois do Cloudflare. **Se o DNSSEC estiver ligado no Registro.br, desligue antes.** Pode levar de minutos a algumas horas.
3. No Cloudflare, abra **Workers & Pages > resolvoja > Custom domains > Set up a domain** e adicione `resolvoja.app.br` e também `www.resolvoja.app.br`. O Cloudflare cria os registros DNS e emite o HTTPS sozinho.
4. Opcional: em Rules > Redirect, mande `www` para o domínio sem `www` (ou o contrário), para ter um endereço principal só.

Se você trocar o domínio, ajuste `ALLOWED_ORIGINS` (no painel do Cloudflare ou no `wrangler.toml`) e publique de novo. Essa lista barra cadastros enviados de outros sites; os endereços `*.pages.dev` sempre passam.

## Cuidados (LGPD e segurança)
- Os cadastros têm nome e WhatsApp. Só quem tem o token vê. Não compartilhe o token, e troque-o (passo 4) se alguém sair da equipe.
- Pedidos de exclusão: use o botão **Excluir** na área da equipe.
- O formulário usa um campo-isca contra robôs e guarda um cadastro por telefone. Se aparecer spam em volume, ative as regras de proteção do Cloudflare (Security > WAF) ou o Turnstile (CAPTCHA grátis).
- Antes de divulgar, publique uma Política de Privacidade e coloque o link ao lado da autorização do formulário. O texto atual de autorização é um rascunho; peça revisão a um advogado.

## Para desenvolver no computador
`npm run dev` sobe o site local com um KV de teste (token de teste: `troque-por-um-token-longo-123`). `npm test` roda os testes das funções.

## E a loja com o botão do Mercado Pago?
Ela é um servidor Node e **não roda no Cloudflare Pages como está**. Publique-a à parte (Render ou Railway) em um subdomínio, como `loja.resolvoja.app.br`: no Cloudflare, crie um registro CNAME `loja` apontando para o endereço que a plataforma indicar.
