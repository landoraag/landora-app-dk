---
name: radar-prospeccao
description: Mantém o Radar de Prospecção Landora (pasta radar-prospeccao/ deste repositório; site no Firebase Hosting, banco no Firestore landora-app-dk). Use para a verificação online semanal dos leads (Instagram/Facebook), para adicionar ou mudar cidades, forçar uma atualização, investigar uma execução que falhou ou mudar a nota de facilidade. Gatilhos: "verificar leads online", "atualizar o radar", "adicionar a cidade X", "o radar não atualizou".
---

# Radar de Prospecção

## Como o sistema funciona
- **Site** (`radar-prospeccao/src`): Vite + Firebase Auth (e-mail e senha) + Firestore, coleções `radar_*`. Publicado pelo workflow `Radar · publicar site` a cada push em `main` que toque `radar-prospeccao/`.
- **Robô** (`radar-prospeccao/pipeline/run.py`): workflow `Radar · atualizar prospecções`, de hora em hora. Lê `radar_config/geral` (cidades com dia e hora, horário de Brasília) e a fila `radar_pedidos`. Sem trabalho, sai em segundos. Confere tamanho e data dos 31 arquivos da Receita (`radar.receita_fingerprint`); só baixa (30-60 min) se a Receita publicou base nova ou entrou cidade nova. Grava a base em `radar_base/atual` (JSON gzip+base64 em `partes/N`) e registra em `radar_execucoes`.
- **Verificação online** (esta skill, toda semana): o robô deixa a lista em `pendentes.json` no branch `radar-verificacoes`. O Claude pesquisa e envia `verificacoes/<data>.json` nesse branch; o workflow `Radar · receber verificações online` grava no Firestore, e a próxima rodada horária aplica e recalcula as notas.

Regras sempre:
- **Precisão acima de volume.** Nunca invente Instagram, telefone ou site. Na dúvida, `nao_encontrado` ou não grave.
- **LGPD:** só dados públicos de empresa. Nunca CPF nem contato pessoal de sócio.
- Não edite dados da equipe (`radar_funil`, `radar_metas`, `radar_perfis`...). O Claude não tem credencial do Firestore e não precisa dela.

## Tarefa 1: verificação online semanal
1. Garanta acesso de escrita ao repositório `landoraag/landora-app-dk` (ferramenta `add_repo` com `access: "push"`). Sem acesso, pare e diga ao usuário que conecte o GitHub em claude.ai/connect-github.
2. `git clone` e `git checkout radar-verificacoes` (se o branch não existir, o robô ainda não rodou: pare).
3. Leia `pendentes.json` (`{"gerado", "empresas": [{cnpj, nome, razao, ramo, cidade, uf, endereco}]}`), até 60 empresas, pedidos da equipe primeiro.
4. Para cada uma, **uma** WebSearch com `allowed_domains: ["instagram.com","facebook.com"]` e a consulta `"<nome>" <cidade>`; se não vier nada, tente a razão social uma vez. Só conte como `confirmado` se o perfil for claramente da mesma empresa **na mesma cidade**.
5. Escreva `verificacoes/<AAAA-MM-DD>.json`:
```json
{"data": "2026-11-16", "itens": {
  "12.345.678/0001-90": {"status": "confirmado", "instagram": "@perfil", "facebook": "facebook.com/pagina", "whatsapp": "(15) 99999-9999", "plataforma": "Goomer", "obs": "cardápio online; ~2 mil seguidores"},
  "98.765.432/0001-10": {"status": "nao_encontrado"}
}}
```
   Campos: `status` (`confirmado` | `nao_encontrado`), `instagram`, `facebook`, `whatsapp` (só se estiver no perfil, formato `(DD) 9XXXX-XXXX`), `site` (site próprio visível no perfil: a empresa sai da lista), `plataforma` (Goomer, Anota AI, Linktree, iFood...), `obs` (curta e factual). Franquia de rede: `{"status":"confirmado","site":"<site da rede>","obs":"Franquia de rede"}`.
6. `git add verificacoes/<data>.json && git commit -m "Verificação online <data>" && git push origin radar-verificacoes`. Não mexa em outros arquivos desse branch.
7. Responda com um resumo curto: quantas confirmadas, quantas não achadas, destaques (WhatsApp novo, quem já tem site).

## Tarefa 2: cidades, horários e atualização forçada
- Cidades e horários se mudam **no site** (aba Cidades, só administradores) e ficam em `radar_config/geral`. O robô roda de hora em hora e obedece.
- Atualização completa agora: GitHub → Actions → "Radar · atualizar prospecções" → Run workflow → marcar "Forçar".
- Execução que falhou: veja o log do workflow e o último documento de `radar_execucoes` (a aba Cidades mostra o resumo). Causas comuns: Receita fora do ar ou publicando o mês (o fingerprint exige os 31 arquivos), nome de cidade diferente do cadastro da Receita (aviso `cidade não encontrada`).

## Tarefa 3: mudar a nota de facilidade ou os ramos
`radar-prospeccao/pipeline/radar.py`: dicionário `R` (CNAE → ramo, peso) e `cmd_score` (pontos). Teste offline sem credencial (usa a pasta `fs_local`):
```bash
cd radar-prospeccao/pipeline && pip install -r requirements.txt
RADAR_WORK=/tmp/rw python3 run.py --forcar --sem-download   # precisa de radar_state/base em fs_local
```
Para testar com o Firestore de verdade, use o emulador (`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`).
