# Radar de Prospecção Landora

Site para a equipe achar e organizar empresas **sem site próprio** em cada cidade (hoje Itapeva e Piraju), a partir da base oficial da Receita Federal.

- **Abas:** Hoje (quem chamar agora), Prospecções (busca avançada, ordem por facilidade ou dificuldade), Meus leads (favoritos, mensagem enviada, respondeu, voltar a falar, já comprou com outro, já tem site...), Mapa (adicionar empresa clicando no mapa, rota de visitas), Funil, Metas (mesma lógica do app), Cidades (dia e horário de cada cidade), Equipe (aprovação de contas).
- **Contas:** e-mail e senha (Firebase Auth do projeto `landora-app-dk`). Quem cria conta espera um administrador aprovar. O primeiro a entrar se ativa como administrador.
- **Atualização:** GitHub Actions de hora em hora. Só trabalha quando há cidade agendada naquela hora, pedido na fila ou verificação nova. Só baixa a Receita quando ela publicou arquivos novos (confere tamanho e data dos 31 arquivos) ou quando entra cidade nova.

## Estrutura
| Caminho | O quê |
|---|---|
| `src/` | o site (Vite, sem framework) |
| `pipeline/radar.py` | baixar e filtrar a Receita, montar a base, detectar site próprio, nota, geolocalização |
| `pipeline/run.py` | orquestrador horário (agenda, checagem da Receita, prospecções do mapa, publicação) |
| `pipeline/fsio.py` | leitura e escrita no Firestore (conta de serviço) |
| `pipeline/seed/` | memória inicial (152 verificações online, coordenadas de ruas, sites) |
| `../.github/workflows/radar-*.yml` | atualizar, receber verificações, publicar o site |
| `../.claude/skills/radar-prospeccao/` | skill do Claude para a verificação online semanal |
| `../landora-app/firestore.rules` | regras do Radar (coleções `radar_*`) junto com as do app |

## Configurar (uma vez)
1. **Segredo no GitHub:** Settings → Secrets and variables → Actions → New repository secret `FIREBASE_SERVICE_ACCOUNT` com o JSON da conta de serviço do projeto `landora-app-dk` (Console do Firebase → Configurações do projeto → Contas de serviço → Gerar nova chave privada; pode ser a mesma que a Vercel usa).
   A conta precisa dos papéis **Firebase Admin** (já vem) e **Firebase Hosting Admin** (para publicar o site).
2. **Regras do Firestore:** as regras do Radar estão em `landora-app/firestore.rules`. Publique com o deploy do app (`npm run deploy` na raiz) ou `firebase deploy --only firestore:rules` dentro de `landora-app/`.
3. **Login por e-mail e senha** já está ativo no projeto (o app usa). Em Authentication → Settings → Authorized domains, confirme `radar-landora.web.app`.
4. Junte o branch no `main`. O agendamento do GitHub Actions só roda no branch principal.
5. Rode **Actions → Radar · publicar site** e depois **Radar · atualizar prospecções** com "Forçar" marcado (a primeira carga baixa a Receita: 30-60 min).
6. Abra https://radar-landora.web.app, crie sua conta e clique em "Sou o administrador: ativar". Depois aprove a equipe na aba Equipe.

## Rodar local
```bash
cd radar-prospeccao && npm install
# .env.local com VITE_FIREBASE_API_KEY e VITE_FIREBASE_APP_ID (os mesmos do app) ou VITE_USE_EMULATOR=1
npm run dev
```
