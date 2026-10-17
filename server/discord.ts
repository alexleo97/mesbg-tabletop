// Optional Discord announcements: the server posts when someone opens a public game. It posts through
// DISCORD_WEBHOOK_URL if set, or else as the bot (DISCORD_BOT_TOKEN, below) in the server's #find-a-game
// channel (or DISCORD_GAMES_CHANNEL_ID). Never commit either. PUBLIC_URL, or Render's RENDER_EXTERNAL_URL,
// gives the link base.

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL ?? '';
const BASE = (process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL ?? '').replace(/\/$/, '');
const MIN_GAP_MS = 30_000;
let lastPost = 0;

const webhookEnabled = () => /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(WEBHOOK);
export const discordEnabled = () => webhookEnabled() || voiceEnabled();

/** Posts a message, at most one every 30 seconds (unless `always`) so a busy evening can't spam the channel. */
export async function postToDiscord(content: string, always = false): Promise<void> {
  if (!discordEnabled() || (!always && Date.now() - lastPost < MIN_GAP_MS)) return;
  if (!always) lastPost = Date.now();
  // No pings: names come from players, so mentions are switched off.
  const message = { content: content.slice(0, 1900), allowed_mentions: { parse: [] } };
  if (!webhookEnabled()) {
    const channel = await gamesChannel();
    if (channel) await bot('POST', `/channels/${channel}/messages`, message);
    return;
  }
  try {
    const res = await fetch(WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(message) });
    if (!res.ok) console.warn(`Discord post failed: ${res.status}`);
  } catch (err) {
    console.warn('Discord post failed:', err);
  }
}

/** Discord markdown would let a player's name format or link the message; show it as plain text. */
const plain = (s: string) => s.replace(/[\\`*_~|>[\]()@#<]/g, '').trim();

export function announceGame(room: string, host: string, scenario: string | undefined) {
  const link = BASE ? `${BASE}/?room=${room}` : `game code \`${room}\``;
  const who = plain(host) || 'Someone';
  return postToDiscord(`⚔️ **${who}** opened a game${scenario ? ` (${plain(scenario)})` : ''} and needs an opponent: ${link}`);
}

// Membership check for the home page's Discord button. The invite code names our server; its id is
// looked up once from Discord (or set with DISCORD_GUILD_ID) and kept for the life of the process.
const INVITE_CODE = process.env.DISCORD_INVITE_CODE ?? 'epNRWMxGws';
let guildId: string | null = process.env.DISCORD_GUILD_ID ?? null;

async function ourGuild(): Promise<string | null> {
  if (guildId) return guildId;
  try {
    const res = await fetch(`https://discord.com/api/v10/invites/${encodeURIComponent(INVITE_CODE)}`);
    const body = (await res.json()) as { guild?: { id?: string } };
    guildId = body.guild?.id ?? null;
  } catch {
    guildId = null;
  }
  return guildId;
}

/**
 * Whether the Discord account behind a sign-in token is in our server: true, false, or null when Discord
 * couldn't say. The token is the player's own, used once for this request and never stored.
 */
export async function discordMember(token: string): Promise<{ member: boolean | null; guild?: string }> {
  const guild = await ourGuild();
  if (!guild || !/^[\w.-]{10,200}$/.test(token)) return { member: null };
  try {
    const res = await fetch('https://discord.com/api/v10/users/@me/guilds', { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return { member: null };
    const list = (await res.json()) as { id: string }[];
    return { member: Array.isArray(list) && list.some(g => g.id === guild), guild };
  } catch {
    return { member: null };
  }
}

// Voice rooms for games in progress. Set DISCORD_BOT_TOKEN (never commit it) to a bot in our server that can
// manage channels and post: when two players start a game the server opens a voice channel for it under the
// Battlefields category (or DISCORD_VOICE_CATEGORY_ID), posts its invite, and takes it down afterwards.

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN ?? '';
const CATEGORY_ID = process.env.DISCORD_VOICE_CATEGORY_ID ?? '';
const CATEGORY_NAME = 'battlefields';
/** Every game channel's name starts with this, so tidying up never touches the server's own channels. */
const VOICE_PREFIX = '⚔ ';
const API = 'https://discord.com/api/v10';

export const voiceEnabled = () => BOT_TOKEN.length > 0;

interface Channel {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
}

async function bot<T>(method: string, path: string, body?: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bot ${BOT_TOKEN}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`Discord ${method} ${path.split('/')[1]} failed: ${res.status}`);
      return null;
    }
    return res.status === 204 ? ({} as T) : ((await res.json()) as T);
  } catch (err) {
    console.warn('Discord request failed:', err);
    return null;
  }
}

let category: string | null = CATEGORY_ID || null;
let games: string | null = process.env.DISCORD_GAMES_CHANNEL_ID || null;

/** The text channel the bot posts games in, when there's no webhook. */
async function gamesChannel(): Promise<string | null> {
  if (games) return games;
  const guild = await ourGuild();
  const list = guild ? ((await bot<Channel[]>('GET', `/guilds/${guild}/channels`)) ?? []) : [];
  games = list.find(c => c.type === 0 && c.name === 'find-a-game')?.id ?? null;
  return games;
}

async function voiceCategory(guild: string, channels?: Channel[]): Promise<string | null> {
  if (category) return category;
  const list = channels ?? (await bot<Channel[]>('GET', `/guilds/${guild}/channels`)) ?? [];
  category = list.find(c => c.type === 4 && c.name.toLowerCase() === CATEGORY_NAME)?.id ?? null;
  return category;
}

/** A channel name from the players' names, as plain text Discord accepts. */
export function voiceName(room: string, names: string[]) {
  const clean = names.map(n => plain(n).replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean);
  return `${VOICE_PREFIX}${clean.length === 2 ? clean.join(' vs ') : room}`.slice(0, 100);
}

/** Opens a voice channel for a game and posts its invite. Gives the channel's id, or null if Discord said no. */
export async function openVoiceRoom(room: string, names: string[], scenario: string | undefined): Promise<string | null> {
  if (!voiceEnabled()) return null;
  const guild = await ourGuild();
  if (!guild) return null;
  const parent = await voiceCategory(guild);
  const channel = await bot<Channel>('POST', `/guilds/${guild}/channels`, { name: voiceName(room, names), type: 2, ...(parent ? { parent_id: parent } : {}) });
  if (!channel) return null;
  const invite = await bot<{ code: string }>('POST', `/channels/${channel.id}/invites`, { max_age: 60 * 60 * 12, unique: true });
  const who = names.map(n => plain(n)).filter(Boolean);
  const players = who.length === 2 ? `**${who[0]}** and **${who[1]}**` : 'Two players';
  const link = BASE ? ` Watch: ${BASE}/?room=${room}` : '';
  if (invite) void postToDiscord(`🔊 ${players} started a game${scenario ? ` (${plain(scenario)})` : ''}. Voice room: https://discord.gg/${invite.code}${link}`, true);
  return channel.id;
}

export async function closeVoiceRoom(channel: string): Promise<void> {
  if (voiceEnabled()) await bot('DELETE', `/channels/${channel}`);
}

const snowflakeTime = (id: string) => Number(BigInt(id) >> 22n) + 1420070400000;

/** Takes down game channels no room still uses, such as ones left behind by a restart, once they're old enough. */
export async function sweepVoiceRooms(inUse: Set<string>, minAgeMs: number): Promise<void> {
  if (!voiceEnabled()) return;
  const guild = await ourGuild();
  if (!guild) return;
  const channels = await bot<Channel[]>('GET', `/guilds/${guild}/channels`);
  if (!channels) return;
  const parent = await voiceCategory(guild, channels);
  for (const c of channels) {
    if (c.type !== 2 || !c.name.startsWith(VOICE_PREFIX) || (c.parent_id ?? null) !== parent || inUse.has(c.id)) continue;
    if (Date.now() - snowflakeTime(c.id) > minAgeMs) await closeVoiceRoom(c.id);
  }
}
