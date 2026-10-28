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

### Testar com uma segunda máquina (rede local)

Nesta máquina (servidor):

1. `npm run build` (se o cliente mudou) e `npm run lan:abrir` — pede UAC e cria regras de firewall
   só para a sub-rede local (TCP 3001 e UDP do app de desenvolvimento). Não muda o perfil da rede.
2. `npm run start:lan` — o terminal mostra os endereços (`na rede: http://IP:3001`).
3. `npm run installer` gera `release/Clone-Local-teste-Setup.exe` já apontando para o IP desta
   máquina (ou `npm run installer -- http://IP:3001`). Só precisa gerar de novo se o app desktop mudar.
4. Para participar daqui também: `npm run desktop`.
5. Ao terminar: pare o servidor (Ctrl+C) e rode `npm run lan:fechar`. `npm run lan:status` mostra o estado.

Na segunda máquina: instale o `.exe` (não precisa de Node). Se o servidor não responder (IP mudou,
servidor desligado), o app mostra **Não foi possível conectar** com o endereço editável — digite o
novo (ex.: `192.168.0.10`, a porta 3001 é assumida) e ele reinicia já conectado. "Usar o padrão"
volta ao endereço gravado no instalador. Alternativa sem instalador (com o projeto e `npm install`):
`$env:CLONE_URL="http://IP:3001"; npm run desktop`.

Voz, câmera e tela vão direto entre as máquinas (sem STUN/TURN): as duas precisam estar na mesma
rede. O app usa os IPs reais nos candidatos (desliga o mascaramento mDNS do Chromium) e trata a
origem `http://IP:3001` como segura para liberar microfone, câmera e tela. No navegador, `http://IP:3001`
não libera esses dispositivos (exige HTTPS); use o app desktop.

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
- **Conversas (threads)**: "Criar conversa" na barra da mensagem ou no menu (a conversa tem o mesmo id
  da mensagem, como no Discord) ou pelo botão "Conversas" do cabeçalho (sem mensagem de origem: o canal
  ganha o aviso "iniciou uma conversa"). Abre num painel ao lado do canal ou em tela cheia (pela barra
  lateral), prévia embaixo da mensagem com contagem e última mensagem, lista de conversas ativas e
  arquivadas, conversas de que você participa embaixo do canal na barra lateral. Entrar/sair, editar
  nome, arquivar (também automático após 1 hora, 24 horas, 3 dias ou 1 semana sem mensagens; mandar
  mensagem desarquiva), bloquear e excluir. Seguem as permissões do canal de origem.
- **Pesquisa**: caixa "Buscar" no cabeçalho do canal e da DM com os filtros do Discord em português
  (`de:`, `menciona:`, `tem:` link/arquivo/imagem/vídeo/som, `antes:`, `durante:`, `depois:`
  (dd/mm/aaaa, hoje, ontem), `em:` canal ou conversa, `fixado:` sim/não) e sugestões enquanto digita.
  Não diferencia acentos e aceita "frases entre aspas". Resultados à direita, agrupados por canal,
  mais recentes ou mais antigos, 25 por página; clicar pula até a mensagem. Só procura nos canais que
  você vê; NSFW só ao filtrar um canal com restrição de idade já liberado.
- **Escrever mensagens**: markdown do Discord (negrito, itálico, sublinhado, riscado, `código`, blocos
  de código, citações `>` e `>>>`, títulos `#`, subtexto `-#`, listas, `||spoiler||`, `[texto](link)`,
  `\` para escapar) e emojis grandes quando a mensagem só tem emojis. "Fulano está digitando…"
  embaixo do campo. Autocompletar de `@membro` (com `@everyone`/`@here` em servidor), `#canal` e
  `:emoji`, com setas, Tab/Enter e Esc. Botão de emoji no campo. O rascunho fica guardado por canal.
- **Anexos**: botão +, arrastar e soltar (Shift ao soltar envia direto) ou colar. Até 10 arquivos de
  até 10 MB, com prévia, spoiler e renomear antes de enviar, e barra de progresso com cancelar. Colar
  um texto que passa de 2000 caracteres vira `message.txt`. Na mensagem: imagens em mosaico (clique
  abre o visualizador), vídeo e áudio com player, e os demais como cartão de download. Mesmo fluxo
  do Discord: `POST /channels/:id/attachments`, `PUT` do arquivo e a mensagem cita o upload.
- **Chamada individual na DM**: botão de ligar no cabeçalho, área de chamada com os dois avatares
  (toque com ondas, anel de fala, selo de mudo), popup de chamada recebida (atender/recusar), toques
  de "chamada recebida" e "chamando…", "Chamar" de novo, toque expira em 45 s, e mensagem de sistema
  ("iniciou uma chamada que durou…", "Você perdeu uma chamada de…"). Mesmo protocolo do Discord:
  `CALL_CREATE`/`CALL_UPDATE`/`CALL_DELETE`, `POST /channels/:id/call/ring` e `/call/stop-ringing`.
- **Servidores**: criar (com ícone) / entrar por convite, menu do servidor, categorias recolhíveis,
  canais de texto e voz, tópico do canal, não lidas e menções, lista de membros agrupada por cargo.
  Banner no topo da lista de canais e mensagem aleatória de boas-vindas (tipo 7) no canal de sistema.
- **Categorias e canais**: criar categoria, criar canal dentro dela (o canal nasce sincronizado com
  as permissões da categoria), "Canal privado" / "Categoria privada" com a escolha de membros e cargos,
  arrastar para reordenar canais e categorias (e servidores na barra da esquerda, salvo na conta),
  clique direito em canal, categoria e área vazia, cadeado nos privados e alerta nos com restrição de idade.
- **Permissões por canal (overwrites)**: mesmo cálculo do Discord (@everyone → cargos → membro;
  sem "Ver canal", nada vale). Quem perde acesso deixa de receber o canal e as mensagens na hora
  (`CHANNEL_CREATE`/`CHANNEL_DELETE` só para quem ganhou ou perdeu). Tela "Permissões" com
  sincronizar com a categoria, canal privado e permissões avançadas (✗ / ⁄ / ✓).
- **Modo lento e restrição de idade**: modo lento de 5 s a 6 h (contador no compositor; quem gerencia
  o canal ou as mensagens não espera; o servidor responde 429 com `retry_after`) e canal com
  restrição de idade com a tela de confirmação.
- **Apelidos**: "Editar perfil do servidor" no menu do servidor, "Alterar apelido" no clique direito
  do membro (Alterar apelido / Gerenciar apelidos). O apelido aparece nas mensagens, menções, lista
  de membros, voz e notificações.
- **Configurações de usuário**: Minha conta (nome de usuário, senha), Perfis (nome exibido, avatar,
  cor do banner, sobre mim, com prévia), Aparência (claro/escuro/ônix, compacto, fonte, zoom),
  Voz e vídeo (dispositivos, volume, teste de microfone, sensibilidade, processamento),
  Notificações, Atalhos de teclado, Sair.
- **Configurações do servidor**: Visão geral (ícone, nome, canal de mensagens do sistema, boas-vindas,
  banner), Cargos (cor, exibir separadamente, permissões, membros, ordem), Registro de auditoria
  (filtros por usuário e ação, detalhes de cada mudança, atualiza em tempo real), Membros (cargos,
  apelido, expulsar, banir), Convites, Banimentos, Excluir servidor.
- **Configurações do canal e da categoria**: nome, tópico, modo lento, restrição de idade,
  Permissões, excluir.
- **Status**: Online, Ausente, Não perturbe (silencia notificações), Invisível. Status personalizado
  (emoji e texto, "Limpar após" hoje / 4 horas / 1 hora / 30 minutos / não limpar) no menu do painel do
  usuário; aparece na lista de membros, nas DMs, nos amigos e no perfil, e some quando a pessoa está
  offline ou invisível.
- **Perfil**: popout com status personalizado, nota e "Ver perfil completo" (também clicando no avatar,
  no nome da DM e em "Perfil" no clique direito do membro). O perfil completo tem Sobre mim, membro
  desde (no app e no servidor), nota pessoal (só você vê, até 256 caracteres) e as abas de servidores
  e amigos em comum.
- **Voz**: mudo, ensurdecer, detecção de voz com anel verde, sons de entrar/sair. Volume de saída até
  200%. Clique direito em quem está na chamada (lista do canal, membros ou bloco da chamada): "Volume do
  usuário" de 0 a 200% e "Silenciar" só para você (ícone vermelho ao lado do nome e sem anel de fala);
  se a pessoa está transmitindo, também "Volume da transmissão" e "Silenciar transmissão" (ou o botão de
  som no canto do bloco da tela). Fica salvo neste dispositivo, como no Discord.
- **Vídeo e tela**: câmera e compartilhamento de tela na chamada de DM/grupo e no canal de voz do
  servidor (que abre na área principal com a grade de participantes). Botão de chamada de vídeo no
  cabeçalho da DM, Câmera/Tela no painel "Voz conectada", clique no bloco para ampliar, duplo clique
  para tela cheia, selo "Ao vivo" e ícone de câmera na lista do canal. No desktop, o seletor de
  "Compartilhar tela" (Aplicativos/Telas, 15/30/60 FPS); no navegador, o seletor do próprio navegador.
  No desktop (Windows), "Compartilhar áudio" no seletor leva o som do sistema junto com a tela, em
  estéreo e sem o processamento de voz; o som do próprio app (as vozes da chamada) fica de fora, então
  ninguém ouve eco. No navegador, a opção de áudio é a do seletor do navegador. Em Voz e vídeo: escolha
  da câmera e "Testar vídeo".
- **Layouts da chamada** (mesmo modelo do Discord): na DM, arrastar a borda de baixo da chamada ajusta
  a altura (de 230 px até a altura do canal menos 200; fica salva). Com vídeo, "Ocultar chat" faz a
  chamada ocupar o canal e "Tela cheia" põe o app inteiro em tela cheia (Esc volta ao layout anterior).
  O botão de tela cheia de um bloco (ou duplo clique) destaca aquela câmera/tela e entra em tela cheia.
  A tela que outra pessoa começa a transmitir vai sozinha para o destaque. Os controles somem após 2 s
  parado.

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
primeira migração. Os anexos ficam em `server/data/attachments/` (um diretório por arquivo).
Só imagem, vídeo e áudio abrem no navegador; os demais tipos são sempre servidos como download.

## Limitações conhecidas

- Sem logo própria por enquanto: o botão de início usa um ícone genérico e a bandeja um círculo.
- Voz P2P em malha: boa para poucas pessoas na mesma rede. Para mais gente, troque por um SFU (LiveKit, mediasoup).
- Sem STUN/TURN: funciona em `localhost` e na rede local, não pela internet.
- Sem emojis personalizados. Blocos de código sem cores de sintaxe.
- Som da tela: no desktop só no Windows, e é o som do sistema inteiro (menos o do app), mesmo ao
  compartilhar uma única janela — o Discord captura só o som daquele aplicativo.
- Conversas: só as públicas (sem conversas privadas nem canais de fórum). O clone não tem os bits de
  permissão de 64 bits do Discord, então criar e falar em conversas segue "Enviar mensagens", e
  gerenciá-las (bloquear, excluir, editar as dos outros) segue "Gerenciar mensagens" ou "Gerenciar canais".
- Pesquisa sem ordenação por relevância e sem `tem: incorporação` (não há prévia de links).
- Permissões de voz além de "Conectar" (falar, vídeo, mutar outros) não existem: a mídia é P2P e
  o servidor não teria como impor. Convites são do servidor, não de um canal.
- Vídeo em malha: cada um envia sua câmera/tela para cada participante, então pesa com muita gente.
- Sem TLS: tráfego em `http`/`ws` e mensagens gravadas em texto puro no banco.
- O servidor escuta só em `127.0.0.1` (`npm run start:lan` escuta na rede); no navegador o microfone
  exige HTTPS fora de `localhost` — use o app desktop.
- O instalador (`npm run installer`) é só para teste: aponta fixo para um servidor da rede local.
