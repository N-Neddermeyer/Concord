# Clone local do Discord

Clone que roda inteiro na sua máquina, com a mesma arquitetura que observamos no cliente real:
casca Electron + cliente web + API REST + gateway WebSocket.

## Rodar

```bash
npm install
npm run build     # gera o cliente em web/dist
npm run desktop   # app desktop (Electron); sobe o servidor sozinho se ele não estiver rodando
```

Ou só no navegador: `npm start` e abra http://127.0.0.1:3001.
Desenvolvimento com recarga automática: `npm run dev` e abra http://localhost:5173
(para o desktop apontar para o Vite: `CLONE_URL=http://localhost:5173 npm run desktop`).

Usuário de teste: **admin** / **123**.

Para testar com duas pessoas, abra o app desktop e uma aba do navegador (ou duas abas: no
navegador o login fica em `sessionStorage`, então cada aba pode ser um usuário diferente).

### Testar a voz com uma segunda máquina (rede local)

1. Na máquina servidor: `npm run start:lan` e libere a porta TCP 3001 no firewall.
2. Gere o instalador já apontando para ela: `npm run installer` (usa o IP desta máquina) ou
   `npm run installer -- http://IP:3001`. Sai em `release/Clone-Local-teste-Setup.exe`; a segunda
   máquina não precisa de Node (o Electron já embute o seu).
3. Alternativa sem instalador (com o projeto e `npm install`): `$env:CLONE_URL="http://IP:3001"; npm run desktop`.
   O app trata essa origem como segura para liberar o microfone.
4. No navegador, `http://IP:3001` não libera o microfone (exige HTTPS); use o app desktop.

## O que tem

- **App desktop**: janela sem moldura com barra de título própria (minimizar/maximizar/fechar),
  splash enquanto o servidor sobe, fechar → bandeja, instância única, tamanho/posição/zoom
  lembrados, menu de contexto com corretor ortográfico, links externos no navegador padrão,
  permissão de microfone e notificações só para o app.
- **Amigos**: abas Online / Todos / Pendente / Bloqueado / Adicionar amigo, coluna "Ativo agora",
  pedidos por nome de usuário, aceitar/ignorar/cancelar, remover amizade, bloquear/desbloquear.
- **Mensagens diretas**: lista na tela inicial, nova MD, fechar MD, contador de não lidas na barra de servidores.
- **Grupo de DM**: "Adicionar amigos à MD" no cabeçalho (numa DM individual cria um grupo novo; num
  grupo, adiciona), até 10 participantes, nome editável clicando nele, lista de membros com o dono,
  sair do grupo (X na lista), dono remove participantes, chamada em grupo e mensagens de sistema
  ("adicionou… ao grupo", "saiu do grupo", "alterou o nome do canal").
- **Mensagens**: barra ao passar o mouse (reagir, editar/responder, mais), menu de 3 pontos e clique
  direito com reações rápidas, Adicionar reação, Editar (inline; seta ↑ edita a última), Fixar/Desafixar,
  Responder (com menção ativável), Copiar texto, Marcar como não lida (divisor "NOVO"), Copiar link,
  Excluir e Copiar ID. "(editado)", reações embaixo da mensagem, resposta com a mensagem citada,
  "Mensagens fixadas" no cabeçalho (com "Pular") e mensagem de sistema "fixou uma mensagem".
  Fora de propósito: Apps, Falar mensagem e Denunciar.
- **Chamada individual na DM**: botão de ligar no cabeçalho, área de chamada com os dois avatares
  (toque com ondas, anel de fala, selo de mudo), popup de chamada recebida (atender/recusar), toques
  de "chamada recebida" e "chamando…", "Chamar" de novo, toque expira em 45 s, e mensagem de sistema
  ("iniciou uma chamada que durou…", "Você perdeu uma chamada de…"). Mesmo protocolo do Discord:
  `CALL_CREATE`/`CALL_UPDATE`/`CALL_DELETE`, `POST /channels/:id/call/ring` e `/call/stop-ringing`.
- **Servidores**: criar (com ícone) / entrar por convite, menu do servidor, categorias recolhíveis,
  canais de texto e voz, tópico do canal, não lidas e menções, lista de membros agrupada por cargo.
- **Configurações de usuário**: Minha conta (nome de usuário, senha), Perfis (nome exibido, avatar,
  cor do banner, sobre mim, com prévia), Aparência (claro/escuro/ônix, compacto, fonte, zoom),
  Voz e vídeo (dispositivos, volume, teste de microfone, sensibilidade, processamento),
  Notificações, Atalhos de teclado, Sair.
- **Configurações do servidor**: Visão geral, Cargos (cor, exibir separadamente, permissões,
  membros, ordem), Membros (cargos, expulsar, banir), Convites, Banimentos, Excluir servidor.
- **Configurações do canal**: nome, tópico, excluir.
- **Status**: Online, Ausente, Não perturbe (silencia notificações), Invisível.
- **Voz**: mudo, ensurdecer, detecção de voz com anel verde, sons de entrar/sair.

Atalhos: `Ctrl+K` busca rápida, `Ctrl+Shift+M` mudo, `Ctrl+Shift+D` ensurdecer, `Esc` fecha
configurações e modais; no desktop, `Ctrl+R` recarrega, `Ctrl+Shift+I` abre o DevTools e
`Ctrl +/-/0` muda o zoom.

## Arquitetura (e o equivalente no Discord)

| Clone | Discord |
|---|---|
| `desktop/src/main.js` — processo principal do Electron | `app.asar` (janela, bandeja, IPC `DISCORD_*`) |
| `desktop/src/preload.js` — `window.CloneNative` | `window.DiscordNative` via contextBridge |
| `server/src/rest.js` — REST em `/api` | `discord.com/api/v9` |
| `server/src/gateway.js` — WebSocket `/gateway`, ops 0/1/2/3/4/10/11 | `wss://gateway.discord.gg` com os mesmos opcodes |
| `READY`, `GUILD_*`, `CHANNEL_*`, `MESSAGE_*`, `RELATIONSHIP_*`, `PRESENCE_UPDATE`… | mesmos nomes de eventos |
| Relações tipo 1/2/3/4 (amigo, bloqueado, recebido, enviado) | mesmos tipos |
| `server/src/permissions.js` — bits de permissão, `@everyone` com o id do servidor | mesmos bits e convenção |
| `server/src/snowflake.js` | IDs Snowflake (mesma época, 2015-01-01) |
| `server/src/db.js` — SQLite (WebAssembly) com migrações | Cassandra/ScyllaDB no servidor |
| `web/src/lib/store.js` — store Flux alimentado pelo gateway | Dispatcher + Stores do cliente web |
| `web/src/lib/voice.js` — WebRTC em malha, sinalização pelo op 30 | WebSocket de voz separado + SFU próprio |

Diferenças assumidas: a atualização de cargos chega num evento único `GUILD_ROLES_UPDATE`
(o Discord manda um evento por cargo), e as configurações de aparência/voz ficam salvas no
dispositivo (`localStorage`), não na conta.

## Banco de dados

Fica em `server/data/clone.db`. O esquema é versionado por `PRAGMA user_version` e migrado
automaticamente ao subir o servidor; a cópia `clone.db.bak-antes-v1` é o banco antes da
primeira migração.

## Limitações conhecidas

- Sem logo própria por enquanto: o botão de início usa um ícone genérico e a bandeja um círculo.
- Voz P2P em malha: boa para poucas pessoas na mesma rede. Para mais gente, troque por um SFU (LiveKit, mediasoup).
- Sem STUN/TURN: funciona em `localhost` e na rede local, não pela internet.
- Sem permissões por canal (overwrites), anexos, emojis personalizados, vídeo ou compartilhamento de tela.
- Sem TLS: tráfego em `http`/`ws` e mensagens gravadas em texto puro no banco.
- O servidor escuta só em `127.0.0.1` (`npm run start:lan` escuta na rede); no navegador o microfone
  exige HTTPS fora de `localhost` — use o app desktop.
- O instalador (`npm run installer`) é só para teste: aponta fixo para um servidor da rede local.
