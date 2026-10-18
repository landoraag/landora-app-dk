# Landora — painel interno

App web para você e seu sócio administrarem o negócio de landing pages:

- **Landing Pages** — cards (4 por linha no PC, 2 no celular) com imagem, título, descrição, categoria, cidade e link. Clique abre um pop-up com o botão "Abrir página", e opções de editar/excluir.
- **Clientes** — cadastro simples (nome, telefone, localização, e-mail, marca).
- **Vendas** — dashboard com gráfico, filtros (dia/semana/mês/ano/personalizado) e histórico completo. Cada venda exige um cliente e uma landing page já cadastrados, e tem um atalho "ver página" que abre o card correspondente.
- **Financeiro** — dashboard mensal com **dia de corte configurável**. O valor de implantação de cada venda entra automaticamente no mês da venda; o valor de assinatura vira uma **receita recorrente mensal automática**, que continua contando em todo ciclo até ser desativada manualmente (na própria aba Financeiro) ou até a landing page ser desativada/excluída.
- **Relatórios** — resumo de vendas + financeiro em tabela, exportável em **PDF** ou **PNG**.
- **Chat** — categorias e canais (estilo Discord, sem cargos/permissões), mensagens de texto em tempo real.
- **Login/Registro** — e-mail, nickname e senha. Sem código de convite: qualquer pessoa com o link do app pode se cadastrar, então trate o link como algo privado entre vocês dois.

Feito em React + Vite, usando **Firebase** (Auth + Firestore) como backend e **Cloudinary** (gratuito, sem cartão) para guardar as imagens de capa das landing pages.

---

## 1. Criar o projeto no Firebase

1. Acesse [console.firebase.google.com](https://console.firebase.google.com/) → **Adicionar projeto** (ex: `landora-app`).
2. **Build > Authentication** → aba **Sign-in method** → ative **E-mail/senha**.
3. **Build > Firestore Database** → **Criar banco de dados** → modo **produção**, região mais próxima (ex: `southamerica-east1`).
4. Na aba **Regras** do Firestore, cole o conteúdo de `firestore.rules` (incluso aqui) e publique.
5. **Configurações do projeto** (engrenagem) → **Seus apps** → ícone `</>` (Web) → registre um app → copie os valores do `firebaseConfig`.

Não é preciso ativar o Storage nem o plano Blaze — as imagens ficam no Cloudinary (próximo passo).

## 2. Criar a conta no Cloudinary (gratuita, sem cartão)

1. Acesse [cloudinary.com](https://cloudinary.com/users/register/free) e crie uma conta grátis.
2. No painel (Dashboard), copie o **Cloud name** — vai usar no `.env`.
3. Vá em **Settings** (engrenagem) → aba **Upload** → role até **Upload presets** → **Add upload preset**.
4. Em **Signing Mode**, troque de "Signed" para **"Unsigned"** (isso permite o app enviar imagens direto do navegador, sem precisar de servidor nem expor nenhuma chave secreta). Dê um nome (ex: `landora_unsigned`) e salve.
5. Copie o nome desse preset — também vai usar no `.env`.

## 3. Configurar o projeto localmente

```bash
npm install
cp .env.example .env
```

Preencha o `.env` com os valores dos passos 1 e 2:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...

VITE_CLOUDINARY_CLOUD_NAME=...
VITE_CLOUDINARY_UPLOAD_PRESET=landora_unsigned
```

Testar localmente:

```bash
npm run dev
```

## 4. Publicar (GitHub + Vercel/Netlify)

1. Suba a pasta inteira (menos `node_modules`) para um repositório **privado** no GitHub.
2. Na Vercel: **Add New > Project** → importe o repositório → em **Environment Variables**, adicione as 7 variáveis do `.env` → **Deploy**.
   (Na Netlify o processo é equivalente: **Add new site > Import**, build command `npm run build`, publish directory `dist`, e as mesmas variáveis em **Environment variables**.)
3. Depois do deploy, copie o domínio gerado (ex: `landora.vercel.app`) e adicione em **Firebase Console > Authentication > Settings > Authorized domains**.

## 5. Criar as contas

Acesse o app publicado → **Registre-se** → crie a conta de cada sócio (nickname, e-mail, senha).

---

## Como funciona o Financeiro automático

- **Implantação**: ao registrar uma venda, o valor de implantação vira um lançamento automático de entrada, datado da venda.
- **Assinatura**: se a venda tiver valor de assinatura, é criada uma "assinatura recorrente" que passa a contar como receita em **todo ciclo financeiro** a partir da data da venda — sem precisar lançar nada manualmente todo mês.
- Uma assinatura para de contar quando:
  - você a desativa manualmente na aba Financeiro, ou
  - a landing page correspondente é **desativada ou excluída** na aba Landing Pages.
- O **dia de corte do ciclo** (ex: todo dia 5) é configurável na aba Financeiro e vale para todos os cálculos e gráficos.

## Estrutura de dados (Firestore)

| Coleção              | Conteúdo                                                              |
|------------------------|-------------------------------------------------------------------------|
| `users`                | nickname/e-mail dos sócios                                             |
| `landingPages`         | cards: título, descrição, categoria, cidade, link, imagem, ativo       |
| `clients`               | cadastro de clientes                                                    |
| `sales`                 | vendas (cliente + landing page + valores)                              |
| `financeEntries`       | lançamentos financeiros (manuais e automáticos de implantação)         |
| `subscriptions`        | assinaturas recorrentes ligadas a uma venda/landing page               |
| `settings`              | configurações gerais (dia de corte do ciclo financeiro)                |
| `channelCategories`    | categorias de canais do chat                                            |
| `channels`              | canais do chat                                                          |
| `chatMessages`         | mensagens do chat                                                       |
| `tasks`                 | tarefas: título, importância, status, prazo e page ligada (opcional)   |

## Calls (voz, câmera e tela)

Aba **Calls**: crie calls temporárias (somem quando todos saem) ou fixas (ficam salvas na lista).
A mídia vai direto entre os navegadores (WebRTC) e o Firestore só faz a sinalização inicial
(`calls/{id}/participants` e `calls/{id}/signals`). A regra atual do Firestore já cobre essas coleções.
Funciona bem para 2 a 4 pessoas. Se alguém não conectar (rede que bloqueia conexão direta),
configure um servidor TURN em `VITE_TURN_URL`, `VITE_TURN_USERNAME` e `VITE_TURN_CREDENTIAL`.

Na call: volume de cada pessoa de 0 a 200% (botão direito ou 🔊), borda azul em quem está falando,
virar câmera (frontal/traseira), até duas transmissões de tela ao mesmo tempo, tela cheia e
miniatura (a transmissão continua numa janelinha quando você sai do app ou do site).

## Publicar uma atualização

Sempre de dentro da pasta `landora-app` (é ali que ficam o `package.json` e o `firebase.json`):

```bash
git pull
cd landora-app
npm install
npm run build
firebase deploy --only hosting
```

Quem estiver com o app aberto vê o aviso "Saiu uma versão nova" e, fora de call, o app se atualiza
sozinho quando fica em segundo plano.

## App do Windows (.exe)

O app de computador abre o site online, então ele já pega as atualizações do site sem reinstalar.
Só é preciso gerar um instalador novo quando algo dentro da pasta `desktop` mudar:
GitHub → aba **Actions** → **Gerar app do Windows (.exe)** → **Run workflow**. Ao terminar, baixe o
`Landora-Setup` na parte de baixo da página da execução.

## Notificações no celular (sem cartão de crédito)

Avisos de mensagens no chat, entrada em calls, tarefas, leads e vendas, mesmo com o app fechado.
Quem fez a ação não recebe o próprio aviso, e cada pessoa escolhe no **Perfil** o que quer receber.

Peças: **Firebase Cloud Messaging** (entrega, grátis no plano atual) + uma **função gratuita na
Vercel** (`api/notify.js`, sem bibliotecas extras) que dispara os avisos. Os aparelhos ficam na
coleção `pushTokens` do Firestore.

Configuração (uma vez só):

1. **Chave VAPID** — Firebase Console → ⚙️ Configurações do projeto → **Cloud Messaging** →
   "Certificados push da Web" → **Gerar par de chaves**. Copie a chave.
2. **Conta de serviço** — Configurações do projeto → **Contas de serviço** → **Gerar nova chave
   privada** (baixa um arquivo .json). Guarde em segredo: ela dá acesso total ao projeto.
3. **Vercel** — em vercel.com, entre com o GitHub → **Add New → Project** → importe
   `landora-app-dk` → em **Root Directory** escolha `landora-app` → em **Environment Variables**:
   - `FIREBASE_SERVICE_ACCOUNT` = todo o conteúdo do arquivo .json do passo 2
   - `APP_URL` = `https://landora-app-dk.web.app`
   - (as variáveis `VITE_...` do `.env`, para o site também funcionar na Vercel)
   → **Deploy**. Anote o endereço (ex.: `https://landora-app-dk.vercel.app`).
4. **`.env`** (no Codespace, pasta `landora-app`) — acrescente:
   ```
   VITE_FIREBASE_VAPID_KEY=chave-do-passo-1
   VITE_NOTIFY_URL=https://SEU-PROJETO.vercel.app/api/notify
   ```
   e publique de novo (`npm run build` + `firebase deploy --only hosting`).
5. Em cada aparelho: **Perfil → Notificações → Ativar**. No iPhone (iOS 16.4+), abra antes o
   Landora pelo atalho da tela de início (Compartilhar → Adicionar à Tela de Início).
