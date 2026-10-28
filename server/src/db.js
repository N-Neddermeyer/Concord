import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sqlite from 'node-sqlite3-wasm';
import { DEFAULT_PERMISSIONS, IMPLICIT_BEFORE_OVERWRITES } from './permissions.js';
import { snowflake, timestampOf } from './snowflake.js';

// SQLite compilado em WebAssembly: dispensa compilar módulo nativo no Windows.
const dataDir = process.env.DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
mkdirSync(dataDir, { recursive: true });

const database = new sqlite.Database(path.join(dataDir, 'clone.db'));

// Interface mínima no formato do better-sqlite3 (statement.get/all/run, db.transaction).
const statement = (sql) => ({
  get: (...params) => database.get(sql, params) ?? undefined,
  all: (...params) => database.all(sql, params),
  run: (...params) => database.run(sql, params),
});

export const db = {
  exec: (sql) => database.exec(sql),
  prepare: statement,
  transaction: (fn) => (...args) => {
    database.exec('BEGIN');
    try {
      const result = fn(...args);
      database.exec('COMMIT');
      return result;
    } catch (e) {
      database.exec('ROLLBACK');
      throw e;
    }
  },
};

// IDs são Snowflakes em TEXT; todos têm 19 dígitos, então a ordem textual é a cronológica.
// Esquema original (versão 0); as migrações abaixo o levam até a versão atual.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    token         TEXT NOT NULL UNIQUE,
    color         TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS guilds (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS members (
    guild_id  TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL REFERENCES users(id),
    joined_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS channels (
    id       TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    type     INTEGER NOT NULL,
    position INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id  TEXT NOT NULL REFERENCES users(id),
    content    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_by_channel ON messages(channel_id, id);
  CREATE TABLE IF NOT EXISTS invites (
    code       TEXT PRIMARY KEY,
    guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    creator_id TEXT NOT NULL REFERENCES users(id)
  );
`);

const migrations = [
  // 1: perfis, amizades, DMs (canal sem servidor), cargos, banimentos.
  () => {
    db.exec(`
      ALTER TABLE users ADD COLUMN global_name TEXT;
      ALTER TABLE users ADD COLUMN avatar TEXT;
      ALTER TABLE users ADD COLUMN banner_color TEXT;
      ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'online';
      ALTER TABLE guilds ADD COLUMN icon TEXT;
      ALTER TABLE invites ADD COLUMN uses INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE invites ADD COLUMN created_at TEXT;

      -- guild_id passa a aceitar NULL (DMs); SQLite exige recriar a tabela.
      CREATE TABLE channels_new (
        id              TEXT PRIMARY KEY,
        guild_id        TEXT REFERENCES guilds(id) ON DELETE CASCADE,
        name            TEXT NOT NULL DEFAULT '',
        type            INTEGER NOT NULL,
        position        INTEGER NOT NULL DEFAULT 0,
        topic           TEXT NOT NULL DEFAULT '',
        last_message_id TEXT
      );
      INSERT INTO channels_new (id, guild_id, name, type, position, last_message_id)
        SELECT id, guild_id, name, type, position, (SELECT MAX(m.id) FROM messages m WHERE m.channel_id = channels.id)
        FROM channels;
      DROP TABLE channels;
      ALTER TABLE channels_new RENAME TO channels;

      CREATE TABLE dm_recipients (
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        user_id    TEXT NOT NULL REFERENCES users(id),
        PRIMARY KEY (channel_id, user_id)
      );
      CREATE INDEX dm_recipients_by_user ON dm_recipients(user_id);

      -- Mesmos tipos do Discord: 1 amigo, 2 bloqueado, 3 pedido recebido, 4 pedido enviado.
      CREATE TABLE relationships (
        user_id   TEXT NOT NULL REFERENCES users(id),
        target_id TEXT NOT NULL REFERENCES users(id),
        type      INTEGER NOT NULL,
        since     TEXT NOT NULL,
        PRIMARY KEY (user_id, target_id)
      );

      -- O cargo @everyone tem o mesmo id do servidor, como no Discord.
      CREATE TABLE roles (
        id          TEXT PRIMARY KEY,
        guild_id    TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        color       TEXT,
        permissions INTEGER NOT NULL,
        position    INTEGER NOT NULL,
        hoist       INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE member_roles (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        role_id  TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        PRIMARY KEY (guild_id, user_id, role_id),
        FOREIGN KEY (guild_id, user_id) REFERENCES members(guild_id, user_id) ON DELETE CASCADE
      );
      CREATE TABLE bans (
        guild_id   TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        user_id    TEXT NOT NULL REFERENCES users(id),
        reason     TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );
    `);
    db.prepare(`INSERT INTO roles (id, guild_id, name, permissions, position) SELECT id, id, '@everyone', ?, 0 FROM guilds`)
      .run(DEFAULT_PERMISSIONS);
  },
  // 2: mensagens de sistema de chamada (tipo 3 do Discord), com participantes e fim.
  () => {
    db.exec(`
      ALTER TABLE messages ADD COLUMN type INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE messages ADD COLUMN call_participants TEXT;
      ALTER TABLE messages ADD COLUMN call_ended_at TEXT;
    `);
  },
  // 3: edição, fixar, respostas, mensagens de sistema, reações e grupos de DM.
  () => {
    db.exec(`
      ALTER TABLE messages ADD COLUMN edited_at TEXT;
      ALTER TABLE messages ADD COLUMN pinned_at TEXT;
      ALTER TABLE messages ADD COLUMN reference_id TEXT;
      ALTER TABLE messages ADD COLUMN reply_ping INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE messages ADD COLUMN meta TEXT;
      ALTER TABLE channels ADD COLUMN owner_id TEXT;
      CREATE TABLE reactions (
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        user_id    TEXT NOT NULL REFERENCES users(id),
        emoji      TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (message_id, emoji, user_id)
      );
      CREATE INDEX reactions_by_message ON reactions(message_id);
      CREATE INDEX messages_pinned ON messages(channel_id, pinned_at) WHERE pinned_at IS NOT NULL;
    `);
  },
  // 4: anexos. O upload vem antes da mensagem (como no Discord): a linha nasce sem message_id
  // e é ligada à mensagem quando ela é enviada. `upload_key` é o diretório do arquivo em disco.
  () => {
    db.exec(`
      CREATE TABLE attachments (
        id           TEXT PRIMARY KEY,
        channel_id   TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        message_id   TEXT REFERENCES messages(id) ON DELETE CASCADE,
        uploader_id  TEXT NOT NULL REFERENCES users(id),
        upload_key   TEXT NOT NULL UNIQUE,
        filename     TEXT NOT NULL,
        size         INTEGER NOT NULL,
        content_type TEXT,
        width        INTEGER,
        height       INTEGER,
        uploaded     INTEGER NOT NULL DEFAULT 0,
        position     INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL
      );
      CREATE INDEX attachments_by_message ON attachments(message_id);
    `);
  },
  // 5: categorias, overwrites de permissão, modo lento, NSFW, apelidos, registro de auditoria,
  // banner e canal de sistema do servidor, ordem dos servidores na barra.
  () => {
    db.exec(`
      ALTER TABLE channels ADD COLUMN parent_id TEXT;
      ALTER TABLE channels ADD COLUMN nsfw INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE channels ADD COLUMN rate_limit_per_user INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE permission_overwrites (
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        target_id  TEXT NOT NULL,
        type       INTEGER NOT NULL,
        allow      INTEGER NOT NULL DEFAULT 0,
        deny       INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (channel_id, target_id)
      );
      ALTER TABLE members ADD COLUMN nick TEXT;
      ALTER TABLE guilds ADD COLUMN banner TEXT;
      ALTER TABLE guilds ADD COLUMN system_channel_id TEXT;
      ALTER TABLE guilds ADD COLUMN system_channel_flags INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN guild_positions TEXT;
      ALTER TABLE messages ADD COLUMN mention_everyone INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE audit_log (
        id          TEXT PRIMARY KEY,
        guild_id    TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        user_id     TEXT NOT NULL,
        target_id   TEXT,
        action_type INTEGER NOT NULL,
        changes     TEXT,
        options     TEXT,
        reason      TEXT
      );
      CREATE INDEX audit_log_by_guild ON audit_log(guild_id, id);
      UPDATE messages SET mention_everyone = 1
        WHERE (content LIKE '%@everyone%' OR content LIKE '%@here%')
          AND channel_id IN (SELECT id FROM channels WHERE guild_id IS NOT NULL);
      UPDATE guilds SET system_channel_id =
        (SELECT id FROM channels c WHERE c.guild_id = guilds.id AND c.type = 0 ORDER BY c.position, c.id LIMIT 1);
    `);
    db.prepare('UPDATE roles SET permissions = permissions | ? WHERE id = guild_id').run(IMPLICIT_BEFORE_OVERWRITES);
    // Os canais existentes ficam nas categorias que a barra lateral já mostrava.
    const guilds = database.all('SELECT id FROM guilds');
    for (const { id } of guilds) {
      const text = snowflake();
      const voice = snowflake();
      database.run('INSERT INTO channels (id, guild_id, name, type, position) VALUES (?, ?, ?, 4, 0)', [text, id, 'Canais de texto']);
      database.run('INSERT INTO channels (id, guild_id, name, type, position) VALUES (?, ?, ?, 4, 1)', [voice, id, 'Canais de voz']);
      database.run('UPDATE channels SET parent_id = ? WHERE guild_id = ? AND type = 0', [text, id]);
      database.run('UPDATE channels SET parent_id = ? WHERE guild_id = ? AND type = 2', [voice, id]);
    }
  },
  // 6: status personalizado, notas sobre usuários e conversas (threads). Uma conversa é um canal
  // tipo 11 cujo parent_id é o canal de texto; criada a partir de uma mensagem, tem o id dela.
  () => {
    db.exec(`
      ALTER TABLE users ADD COLUMN custom_status TEXT;
      CREATE TABLE user_notes (
        user_id   TEXT NOT NULL REFERENCES users(id),
        target_id TEXT NOT NULL REFERENCES users(id),
        note      TEXT NOT NULL,
        PRIMARY KEY (user_id, target_id)
      );
      ALTER TABLE channels ADD COLUMN message_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE channels ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE channels ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE channels ADD COLUMN auto_archive_duration INTEGER;
      ALTER TABLE channels ADD COLUMN archive_timestamp TEXT;
      CREATE INDEX channels_by_parent ON channels(parent_id);
      CREATE TABLE thread_members (
        channel_id     TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        user_id        TEXT NOT NULL REFERENCES users(id),
        join_timestamp TEXT NOT NULL,
        PRIMARY KEY (channel_id, user_id)
      );
      CREATE INDEX thread_members_by_user ON thread_members(user_id);
    `);
  },
];

// Mudanças de esquema rodam com as chaves estrangeiras desligadas (exigência do SQLite
// para recriar tabelas) e dentro de uma transação; a versão fica em PRAGMA user_version.
const version = database.get('PRAGMA user_version').user_version;
if (version < migrations.length) {
  database.exec('PRAGMA foreign_keys = OFF');
  db.transaction(() => {
    for (let v = version; v < migrations.length; v++) migrations[v]();
    const broken = database.all('PRAGMA foreign_key_check');
    if (broken.length) throw new Error(`Migração deixou referências quebradas: ${JSON.stringify(broken)}`);
    database.exec(`PRAGMA user_version = ${migrations.length}`);
  })();
}
database.exec('PRAGMA foreign_keys = ON');

// Chamadas vivem só na memória do gateway: uma que estava em andamento quando o servidor
// parou terminou ali, em hora desconhecida. Fecha o registro (com fim = início, para não
// inventar uma duração) para não aparecer "em andamento" para sempre.
for (const { id } of database.all('SELECT id FROM messages WHERE type = 3 AND call_ended_at IS NULL')) {
  database.run('UPDATE messages SET call_ended_at = ? WHERE id = ?', [timestampOf(id), id]);
}

export const CHANNEL_TEXT = 0;
export const CHANNEL_DM = 1;
export const CHANNEL_VOICE = 2;
export const CHANNEL_GROUP_DM = 3;
export const CHANNEL_CATEGORY = 4;
export const CHANNEL_THREAD = 11; // PUBLIC_THREAD do Discord

export const REL = { FRIEND: 1, BLOCKED: 2, INCOMING: 3, OUTGOING: 4 };
// Tipos de mensagem do Discord usados aqui.
export const MSG = {
  DEFAULT: 0,
  RECIPIENT_ADD: 1,
  RECIPIENT_REMOVE: 2,
  CALL: 3,
  CHANNEL_NAME_CHANGE: 4,
  CHANNEL_PINNED_MESSAGE: 6,
  USER_JOIN: 7,
  THREAD_CREATED: 18,
  REPLY: 19,
  THREAD_STARTER_MESSAGE: 21,
};
export const MESSAGE_CALL = MSG.CALL;

export const ATTACHMENTS_DIR = path.join(dataDir, 'attachments');

const AUTHOR_COLUMNS = 'u.username, u.global_name, u.avatar, u.color, u.banner_color, u.bio';

export const q = {
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  userByToken: db.prepare('SELECT * FROM users WHERE token = ?'),
  insertUser: db.prepare('INSERT INTO users (id, username, password_hash, token, color) VALUES (?, ?, ?, ?, ?)'),
  updateUser: db.prepare(`
    UPDATE users SET username = ?, password_hash = ?, token = ?, global_name = ?, avatar = ?, banner_color = ?, bio = ?
    WHERE id = ?`),
  setStatus: db.prepare('UPDATE users SET status = ? WHERE id = ?'),
  setGuildPositions: db.prepare('UPDATE users SET guild_positions = ? WHERE id = ?'),
  setCustomStatus: db.prepare('UPDATE users SET custom_status = ? WHERE id = ?'),
  withCustomStatus: db.prepare('SELECT id, custom_status FROM users WHERE custom_status IS NOT NULL'),

  note: db.prepare('SELECT note FROM user_notes WHERE user_id = ? AND target_id = ?'),
  notesOf: db.prepare('SELECT target_id, note FROM user_notes WHERE user_id = ?'),
  setNote: db.prepare(`
    INSERT INTO user_notes (user_id, target_id, note) VALUES (?, ?, ?)
    ON CONFLICT (user_id, target_id) DO UPDATE SET note = excluded.note`),
  deleteNote: db.prepare('DELETE FROM user_notes WHERE user_id = ? AND target_id = ?'),
  mutualGuilds: db.prepare(`
    SELECT o.guild_id AS id, o.nick FROM members m JOIN members o ON o.guild_id = m.guild_id AND o.user_id = ?
    WHERE m.user_id = ? ORDER BY m.joined_at`),
  mutualFriends: db.prepare(`
    SELECT a.target_id AS id FROM relationships a
    JOIN relationships b ON b.target_id = a.target_id AND b.user_id = ? AND b.type = 1
    WHERE a.user_id = ? AND a.type = 1`),

  guild: db.prepare('SELECT * FROM guilds WHERE id = ?'),
  guildsOf: db.prepare('SELECT g.* FROM guilds g JOIN members m ON m.guild_id = g.id WHERE m.user_id = ? ORDER BY m.joined_at'),
  insertGuild: db.prepare('INSERT INTO guilds (id, name, owner_id) VALUES (?, ?, ?)'),
  updateGuild: db.prepare('UPDATE guilds SET name = ?, icon = ?, banner = ?, system_channel_id = ?, system_channel_flags = ? WHERE id = ?'),
  clearSystemChannel: db.prepare('UPDATE guilds SET system_channel_id = NULL WHERE system_channel_id = ?'),
  deleteGuild: db.prepare('DELETE FROM guilds WHERE id = ?'),

  member: db.prepare('SELECT * FROM members WHERE guild_id = ? AND user_id = ?'),
  memberIds: db.prepare('SELECT user_id FROM members WHERE guild_id = ?'),
  membersOf: db.prepare(`
    SELECT u.id, ${AUTHOR_COLUMNS}, m.joined_at, m.nick FROM members m
    JOIN users u ON u.id = m.user_id WHERE m.guild_id = ? ORDER BY u.username`),
  insertMember: db.prepare('INSERT INTO members (guild_id, user_id, joined_at) VALUES (?, ?, ?)'),
  deleteMember: db.prepare('DELETE FROM members WHERE guild_id = ? AND user_id = ?'),
  setNick: db.prepare('UPDATE members SET nick = ? WHERE guild_id = ? AND user_id = ?'),
  // Todos que dividem algum servidor com o usuário (para presença e atualizações de perfil).
  guildmates: db.prepare(`
    SELECT DISTINCT o.user_id FROM members m JOIN members o ON o.guild_id = m.guild_id WHERE m.user_id = ?`),
  sharesGuild: db.prepare(`
    SELECT 1 FROM members a JOIN members b ON a.guild_id = b.guild_id WHERE a.user_id = ? AND b.user_id = ? LIMIT 1`),

  roles: db.prepare('SELECT * FROM roles WHERE guild_id = ? ORDER BY position, id'),
  role: db.prepare('SELECT * FROM roles WHERE id = ?'),
  insertRole: db.prepare('INSERT INTO roles (id, guild_id, name, color, permissions, position, hoist) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  updateRole: db.prepare('UPDATE roles SET name = ?, color = ?, permissions = ?, hoist = ? WHERE id = ?'),
  setRolePosition: db.prepare('UPDATE roles SET position = ? WHERE id = ?'),
  shiftRolesUp: db.prepare('UPDATE roles SET position = position + 1 WHERE guild_id = ? AND position >= ?'),
  deleteRole: db.prepare('DELETE FROM roles WHERE id = ?'),
  memberRoles: db.prepare('SELECT role_id FROM member_roles WHERE guild_id = ? AND user_id = ?'),
  guildMemberRoles: db.prepare('SELECT user_id, role_id FROM member_roles WHERE guild_id = ?'),
  addMemberRole: db.prepare('INSERT OR IGNORE INTO member_roles (guild_id, user_id, role_id) VALUES (?, ?, ?)'),
  removeMemberRole: db.prepare('DELETE FROM member_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?'),
  usersWithRole: db.prepare('SELECT user_id FROM member_roles WHERE role_id = ?'),

  channel: db.prepare('SELECT * FROM channels WHERE id = ?'),
  channelsOf: db.prepare('SELECT * FROM channels WHERE guild_id = ? ORDER BY position, id'),
  nextChannelPosition: db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM channels WHERE guild_id = ?'),
  insertChannel: db.prepare('INSERT INTO channels (id, guild_id, name, type, position, parent_id) VALUES (?, ?, ?, ?, ?, ?)'),
  updateChannel: db.prepare('UPDATE channels SET name = ?, topic = ? WHERE id = ?'),
  updateGuildChannel: db.prepare('UPDATE channels SET name = ?, topic = ?, nsfw = ?, rate_limit_per_user = ? WHERE id = ?'),
  moveChannel: db.prepare('UPDATE channels SET position = ?, parent_id = ? WHERE id = ?'),
  orphanChildren: db.prepare('UPDATE channels SET parent_id = NULL WHERE parent_id = ? AND type != 11'),

  insertThread: db.prepare(`
    INSERT INTO channels (id, guild_id, name, type, position, parent_id, owner_id, auto_archive_duration, archive_timestamp)
    VALUES (?, ?, ?, 11, 0, ?, ?, ?, ?)`),
  updateThread: db.prepare('UPDATE channels SET name = ?, archived = ?, locked = ?, auto_archive_duration = ?, archive_timestamp = ? WHERE id = ?'),
  bumpMessageCount: db.prepare('UPDATE channels SET message_count = MAX(message_count + ?, 0) WHERE id = ?'),
  threadsOf: db.prepare('SELECT * FROM channels WHERE parent_id = ? AND type = 11'),
  activeThreads: db.prepare('SELECT * FROM channels WHERE type = 11 AND archived = 0'),
  deleteThreadsOf: db.prepare('DELETE FROM channels WHERE parent_id = ? AND type = 11'),
  threadMemberIds: db.prepare('SELECT user_id FROM thread_members WHERE channel_id = ? ORDER BY join_timestamp'),
  threadMember: db.prepare('SELECT 1 FROM thread_members WHERE channel_id = ? AND user_id = ?'),
  addThreadMember: db.prepare('INSERT OR IGNORE INTO thread_members (channel_id, user_id, join_timestamp) VALUES (?, ?, ?)'),
  removeThreadMember: db.prepare('DELETE FROM thread_members WHERE channel_id = ? AND user_id = ?'),
  leaveGuildThreads: db.prepare(`
    DELETE FROM thread_members WHERE user_id = ? AND channel_id IN (SELECT id FROM channels WHERE guild_id = ?)`),
  overwritesOf: db.prepare('SELECT * FROM permission_overwrites WHERE channel_id = ? ORDER BY type, target_id'),
  guildOverwrites: db.prepare(`
    SELECT o.* FROM permission_overwrites o JOIN channels c ON c.id = o.channel_id WHERE c.guild_id = ? ORDER BY o.type, o.target_id`),
  insertOverwrite: db.prepare('INSERT INTO permission_overwrites (channel_id, target_id, type, allow, deny) VALUES (?, ?, ?, ?, ?)'),
  clearOverwrites: db.prepare('DELETE FROM permission_overwrites WHERE channel_id = ?'),
  deleteOverwritesFor: db.prepare(`
    DELETE FROM permission_overwrites WHERE target_id = ? AND channel_id IN (SELECT id FROM channels WHERE guild_id = ?)`),
  deleteChannel: db.prepare('DELETE FROM channels WHERE id = ?'),
  touchChannel: db.prepare('UPDATE channels SET last_message_id = ? WHERE id = ?'),

  dmChannelsOf: db.prepare(`
    SELECT c.* FROM channels c JOIN dm_recipients r ON r.channel_id = c.id
    WHERE r.user_id = ? ORDER BY COALESCE(c.last_message_id, c.id) DESC`),
  dmRecipientIds: db.prepare('SELECT user_id FROM dm_recipients WHERE channel_id = ?'),
  dmRecipient: db.prepare('SELECT 1 FROM dm_recipients WHERE channel_id = ? AND user_id = ?'),
  dmBetween: db.prepare(`
    SELECT c.* FROM channels c
    JOIN dm_recipients a ON a.channel_id = c.id AND a.user_id = ?
    JOIN dm_recipients b ON b.channel_id = c.id AND b.user_id = ?
    WHERE c.type = 1`),
  insertDmChannel: db.prepare('INSERT INTO channels (id, guild_id, type) VALUES (?, NULL, 1)'),
  insertGroupDm: db.prepare('INSERT INTO channels (id, guild_id, type, owner_id) VALUES (?, NULL, 3, ?)'),
  setChannelOwner: db.prepare('UPDATE channels SET owner_id = ? WHERE id = ?'),
  deleteDmRecipient: db.prepare('DELETE FROM dm_recipients WHERE channel_id = ? AND user_id = ?'),
  insertDmRecipient: db.prepare('INSERT INTO dm_recipients (channel_id, user_id) VALUES (?, ?)'),
  dmPartners: db.prepare(`
    SELECT DISTINCT o.user_id FROM dm_recipients r JOIN dm_recipients o ON o.channel_id = r.channel_id
    WHERE r.user_id = ? AND o.user_id != r.user_id`),

  relationship: db.prepare('SELECT * FROM relationships WHERE user_id = ? AND target_id = ?'),
  relationshipsOf: db.prepare(`
    SELECT r.target_id AS id, r.type, r.since, ${AUTHOR_COLUMNS} FROM relationships r
    JOIN users u ON u.id = r.target_id WHERE r.user_id = ?`),
  setRelationship: db.prepare(`
    INSERT INTO relationships (user_id, target_id, type, since) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, target_id) DO UPDATE SET type = excluded.type, since = excluded.since`),
  deleteRelationship: db.prepare('DELETE FROM relationships WHERE user_id = ? AND target_id = ?'),
  friendIds: db.prepare('SELECT target_id FROM relationships WHERE user_id = ? AND type = 1'),

  message: db.prepare('SELECT * FROM messages WHERE id = ?'),
  messageWithAuthor: db.prepare(`SELECT m.*, ${AUTHOR_COLUMNS} FROM messages m JOIN users u ON u.id = m.author_id WHERE m.id = ?`),
  insertCallMessage: db.prepare(`
    INSERT INTO messages (id, channel_id, author_id, content, type, call_participants) VALUES (?, ?, ?, '', 3, ?)`),
  updateCallMessage: db.prepare('UPDATE messages SET call_participants = ?, call_ended_at = ? WHERE id = ?'),
  messagesBefore: {
    all: ({ channel, before, limit }) =>
      database.all(
        `SELECT m.*, ${AUTHOR_COLUMNS} FROM messages m JOIN users u ON u.id = m.author_id
         WHERE m.channel_id = ? AND (? IS NULL OR m.id < ?)
         ORDER BY m.id DESC LIMIT ?`,
        [channel, before, before, limit],
      ),
  },
  // Candidatos da pesquisa (o texto, menções e "tem:" são filtrados em JS, sem diferenciar acentos).
  searchMessages: {
    all: ({ channels, authors, pinned, minId, maxId }) => {
      if (!channels.length) return [];
      const where = [`m.channel_id IN (${channels.map(() => '?').join(',')})`, 'm.type IN (0, 19)'];
      const params = [...channels];
      if (authors.length) {
        where.push(`m.author_id IN (${authors.map(() => '?').join(',')})`);
        params.push(...authors);
      }
      if (pinned !== null) where.push(pinned ? 'm.pinned_at IS NOT NULL' : 'm.pinned_at IS NULL');
      if (minId) {
        where.push('m.id > ?');
        params.push(minId);
      }
      if (maxId) {
        where.push('m.id < ?');
        params.push(maxId);
      }
      return database.all(
        `SELECT m.*, ${AUTHOR_COLUMNS} FROM messages m JOIN users u ON u.id = m.author_id WHERE ${where.join(' AND ')} ORDER BY m.id DESC`,
        params,
      );
    },
  },
  insertMessage: db.prepare(`
    INSERT INTO messages (id, channel_id, author_id, content, type, reference_id, reply_ping, meta, mention_everyone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  editMessage: db.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?'),
  setPinned: db.prepare('UPDATE messages SET pinned_at = ? WHERE id = ?'),
  pinsOf: db.prepare(`
    SELECT m.*, ${AUTHOR_COLUMNS} FROM messages m JOIN users u ON u.id = m.author_id
    WHERE m.channel_id = ? AND m.pinned_at IS NOT NULL ORDER BY m.pinned_at DESC`),
  pinCount: db.prepare('SELECT COUNT(*) AS n FROM messages WHERE channel_id = ? AND pinned_at IS NOT NULL'),
  addReaction: db.prepare('INSERT OR IGNORE INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)'),
  removeReaction: db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'),
  reactionKinds: db.prepare('SELECT COUNT(DISTINCT emoji) AS n FROM reactions WHERE message_id = ?'),
  deleteMessage: db.prepare('DELETE FROM messages WHERE id = ?'),

  insertAttachment: db.prepare(`
    INSERT INTO attachments (id, channel_id, uploader_id, upload_key, filename, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`),
  attachmentByKey: db.prepare('SELECT * FROM attachments WHERE upload_key = ?'),
  markUploaded: db.prepare('UPDATE attachments SET uploaded = 1, size = ?, content_type = ? WHERE id = ?'),
  linkAttachment: db.prepare('UPDATE attachments SET message_id = ?, filename = ?, width = ?, height = ?, position = ? WHERE id = ?'),
  attachmentsOfMessage: db.prepare('SELECT * FROM attachments WHERE message_id = ? ORDER BY position'),
  staleUploads: db.prepare('SELECT * FROM attachments WHERE message_id IS NULL AND created_at < ?'),
  deleteAttachment: db.prepare('DELETE FROM attachments WHERE id = ?'),

  invite: db.prepare('SELECT * FROM invites WHERE code = ?'),
  invitesOf: db.prepare(`
    SELECT i.code, i.uses, i.created_at, i.creator_id, ${AUTHOR_COLUMNS} FROM invites i
    JOIN users u ON u.id = i.creator_id WHERE i.guild_id = ? ORDER BY i.created_at DESC`),
  insertInvite: db.prepare('INSERT INTO invites (code, guild_id, creator_id, created_at) VALUES (?, ?, ?, ?)'),
  useInvite: db.prepare('UPDATE invites SET uses = uses + 1 WHERE code = ?'),
  deleteInvite: db.prepare('DELETE FROM invites WHERE code = ?'),

  insertAudit: db.prepare(`
    INSERT INTO audit_log (id, guild_id, user_id, target_id, action_type, changes, options, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  auditLog: {
    all: ({ guild, user, action, before, limit }) =>
      database.all(
        `SELECT * FROM audit_log WHERE guild_id = ? AND (? IS NULL OR user_id = ?) AND (? IS NULL OR action_type = ?)
         AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?`,
        [guild, user, user, action, action, before, before, limit],
      ),
  },

  ban: db.prepare('SELECT * FROM bans WHERE guild_id = ? AND user_id = ?'),
  bansOf: db.prepare(`
    SELECT b.user_id, b.reason, b.created_at, ${AUTHOR_COLUMNS} FROM bans b
    JOIN users u ON u.id = b.user_id WHERE b.guild_id = ? ORDER BY b.created_at DESC`),
  insertBan: db.prepare('INSERT OR REPLACE INTO bans (guild_id, user_id, reason, created_at) VALUES (?, ?, ?, ?)'),
  deleteBan: db.prepare('DELETE FROM bans WHERE guild_id = ? AND user_id = ?'),
};

// Formato público de um usuário. Aceita linhas de `users` ou linhas com as colunas de AUTHOR_COLUMNS.
export const publicUser = (u, id = u.id) => ({
  id,
  username: u.username,
  global_name: u.global_name ?? null,
  avatar: u.avatar ?? null,
  color: u.color,
  banner_color: u.banner_color ?? null,
  bio: u.bio ?? '',
});

// O próprio usuário também vê a preferência de status.
export const privateUser = (u) => ({ ...publicUser(u), status: u.status });

// Formato de mensagem enviado ao cliente (linha de `messages` com as colunas do autor).
export function toMessage(m) {
  const message = {
    id: m.id,
    type: m.type ?? 0,
    channel_id: m.channel_id,
    content: m.content,
    timestamp: timestampOf(m.id),
    edited_timestamp: m.edited_at ?? null,
    pinned: !!m.pinned_at,
    author: publicUser(m, m.author_id),
  };
  if (message.type === MESSAGE_CALL) {
    message.call = { participants: JSON.parse(m.call_participants ?? '[]'), ended_timestamp: m.call_ended_at ?? null };
  }
  if (m.reference_id) {
    message.message_reference = { message_id: m.reference_id };
    message.reply_ping = !!m.reply_ping;
  }
  if (m.meta) message.meta = JSON.parse(m.meta);
  message.mention_everyone = !!m.mention_everyone;
  message.attachments = [];
  return message;
}

export const attachmentUrl = (a) => `/attachments/${a.upload_key}/${encodeURIComponent(a.filename)}`;

export const toAttachment = (a) => ({
  id: a.id,
  filename: a.filename,
  size: a.size,
  url: attachmentUrl(a),
  content_type: a.content_type ?? null,
  width: a.width ?? null,
  height: a.height ?? null,
});

export const toOverwrite = (o) => ({ id: o.target_id, type: o.type, allow: o.allow, deny: o.deny });

// Canal de servidor no formato do Discord (com os overwrites de permissão).
export const toChannel = (c, overwrites = q.overwritesOf.all(c.id).map(toOverwrite)) => ({
  id: c.id,
  type: c.type,
  guild_id: c.guild_id,
  name: c.name,
  position: c.position,
  parent_id: c.parent_id ?? null,
  topic: c.topic ?? '',
  nsfw: !!c.nsfw,
  rate_limit_per_user: c.rate_limit_per_user ?? 0,
  last_message_id: c.last_message_id ?? null,
  permission_overwrites: overwrites,
});

// Conversa (thread) no formato do Discord, com quem participa e a última mensagem (para a prévia).
export function toThread(c) {
  const memberIds = q.threadMemberIds.all(c.id).map((r) => r.user_id);
  const last = c.last_message_id && q.messageWithAuthor.get(c.last_message_id);
  return {
    id: c.id,
    type: c.type,
    guild_id: c.guild_id,
    parent_id: c.parent_id,
    owner_id: c.owner_id,
    name: c.name,
    last_message_id: c.last_message_id ?? null,
    message_count: c.message_count ?? 0,
    member_count: memberIds.length,
    member_ids: memberIds,
    rate_limit_per_user: c.rate_limit_per_user ?? 0,
    thread_metadata: {
      archived: !!c.archived,
      locked: !!c.locked,
      auto_archive_duration: c.auto_archive_duration ?? 1440,
      archive_timestamp: c.archive_timestamp,
    },
    last_message: last && (last.type === MSG.DEFAULT || last.type === MSG.REPLY) ? toMessage(last) : null,
  };
}

// Completa as mensagens com reações, a mensagem respondida e os usuários citados nas
// mensagens de sistema (adicionou/removeu alguém do grupo).
export function loadMessages(rows) {
  const messages = rows.map(toMessage);
  if (!messages.length) return messages;

  const ids = messages.map((m) => m.id);
  const marks = ids.map(() => '?').join(',');
  const reactions = database.all(
    `SELECT message_id, emoji, user_id FROM reactions WHERE message_id IN (${marks}) ORDER BY created_at`,
    ids,
  );
  const attachments = database.all(`SELECT * FROM attachments WHERE message_id IN (${marks}) ORDER BY position`, ids);
  for (const m of messages) {
    const byEmoji = new Map();
    for (const r of reactions) {
      if (r.message_id !== m.id) continue;
      if (!byEmoji.has(r.emoji)) byEmoji.set(r.emoji, []);
      byEmoji.get(r.emoji).push(r.user_id);
    }
    m.reactions = [...byEmoji].map(([emoji, user_ids]) => ({ emoji, user_ids }));
    m.attachments = attachments.filter((a) => a.message_id === m.id).map(toAttachment);

    if (m.message_reference) {
      const ref = q.messageWithAuthor.get(m.message_reference.message_id);
      m.referenced_message = ref ? { ...toMessage(ref), attachments: q.attachmentsOfMessage.all(ref.id).map(toAttachment) } : null;
    }
    if (m.meta?.user_id) {
      const user = q.userById.get(m.meta.user_id);
      m.meta.user = user ? publicUser(user) : null;
    }
  }
  return messages;
}

export const messagePayload = (id) => {
  const row = q.messageWithAuthor.get(id);
  return row ? loadMessages([row])[0] : null;
};
