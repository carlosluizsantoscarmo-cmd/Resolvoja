# Resolvo Já — site com lista de espera (Cloudflare Pages)

Página inicial + cadastro da lista de espera + área da equipe para ver os cadastros. Roda 100% no Cloudflare (Pages + Functions + KV), sem servidor para cuidar.

```
public/index.html     página do site (cadastro envia para /api/lead)
public/admin.html     área da equipe (token) para ver, baixar e excluir cadastros
functions/api/lead.js    recebe o cadastro, valida e grava no KV
functions/api/leads.js   lista (JSON/CSV) e exclui; exige ADMIN_TOKEN
test/functions.test.mjs  13 testes das funções (npm test)
```

## Publicar pelo GitHub (sem instalar nada)

O Cloudflare hoje cria o site como um **Worker** ligado ao GitHub. Este projeto já está pronto para isso (`worker.js` + `wrangler.jsonc`).

1. **Repositório.** No github.com, crie um repositório privado e suba o **conteúdo** desta pasta, de modo que `public`, `functions`, `worker.js` e `wrangler.jsonc` fiquem **direto na raiz** do repositório (não dentro de outra pasta). Não suba senhas nem tokens.
2. **Armazenamento dos cadastros.** No Cloudflare, abra **Storage & Databases > KV > Create** e crie um namespace chamado `LEADS`. Copie o **ID** dele.
3. **Colar o ID.** No GitHub, abra o arquivo `wrangler.jsonc`, clique no lápis (editar) e troque `COLE_AQUI_O_ID_DO_KV` pelo ID. Troque também `"name"` pelo nome exato do seu projeto no Cloudflare. Salve (Commit).
4. **Conectar.** Em **Workers & Pages > Create > Import a repository**, escolha o repositório. Deixe o comando de build vazio e o de deploy como `npx wrangler deploy`.
5. **Senha da equipe.** Depois do primeiro deploy, abra o projeto > **Settings > Variables and Secrets > Add**, tipo **Secret**, nome `ADMIN_TOKEN`, valor com 16 caracteres ou mais. Essa é a senha de `/admin.html`. Guarde-a.
6. **Testar.** Abra o endereço `...workers.dev` do projeto, faça um cadastro de teste e confira em `/admin.html`.

Se o Cloudflare avisar que o nome do Worker não confere, ajuste o `"name"` do `wrangler.jsonc` para o nome que ele mostra.

A partir daí, cada alteração enviada ao GitHub publica o site sozinha.

## O que eu testei e o que não testei
- Testado: as funções (13 testes com um KV de mentira) e a página no navegador (cadastro, erro de validação, área da equipe com token certo e errado).
- **Não testado:** o Cloudflare de verdade (não tenho acesso à sua conta nem à internet liberada para ele daqui). Siga o passo a passo e faça um cadastro de teste no final.

## Pelo terminal (opcional, precisa do Node.js)
`npm install --save-dev wrangler`, `npx wrangler login`, crie o KV com `npx wrangler kv namespace create LEADS`, cole o id no `wrangler.jsonc`, defina o token com `npx wrangler secret put ADMIN_TOKEN` e publique com `npm run deploy`.

## Ligar o domínio resolvoja.app.br

O jeito mais simples é entregar o DNS ao Cloudflare:

1. No Cloudflare, **Add a site**, digite `resolvoja.app.br` e escolha o plano grátis. Ele mostra dois nomes de servidor (algo como `xxx.ns.cloudflare.com`).
2. No Registro.br, abra o domínio, vá em **DNS > Alterar servidores DNS** e troque pelos dois do Cloudflare. **Se o DNSSEC estiver ligado no Registro.br, desligue antes.** Pode levar de minutos a algumas horas.
3. No Cloudflare, abra seu projeto em **Workers & Pages > Settings > Domains & Routes > Add > Custom domain** e adicione `resolvoja.app.br` e também `www.resolvoja.app.br`. O Cloudflare cria os registros DNS e emite o HTTPS sozinho.
4. Opcional: em Rules > Redirect, mande `www` para o domínio sem `www` (ou o contrário), para ter um endereço principal só.

Se você trocar o domínio, ajuste `ALLOWED_ORIGINS` (no painel do Cloudflare ou no `wrangler.toml`) e publique de novo. Essa lista barra cadastros enviados de outros sites; os endereços `*.pages.dev` sempre passam.

## Cuidados (LGPD e segurança)
- Os cadastros têm nome e WhatsApp. Só quem tem o token vê. Não compartilhe o token, e troque-o (passo 4) se alguém sair da equipe.
- Pedidos de exclusão: use o botão **Excluir** na área da equipe.
- O formulário usa um campo-isca contra robôs e guarda um cadastro por telefone. Se aparecer spam em volume, ative as regras de proteção do Cloudflare (Security > WAF) ou o Turnstile (CAPTCHA grátis).
- Antes de divulgar, publique uma Política de Privacidade e coloque o link ao lado da autorização do formulário. O texto atual de autorização é um rascunho; peça revisão a um advogado.

## Para desenvolver no computador
`npm run dev` sobe o site local com um KV de teste (token de teste: `troque-por-um-token-longo-123`; precisa do Node.js). `npm test` roda os testes das funções.


## E a loja com o botão do Mercado Pago?
Ela é um servidor Node e **não roda no Cloudflare Pages como está**. Publique-a à parte (Render ou Railway) em um subdomínio, como `loja.resolvoja.app.br`: no Cloudflare, crie um registro CNAME `loja` apontando para o endereço que a plataforma indicar.
