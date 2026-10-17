// Optional Discord announcements. Set DISCORD_WEBHOOK_URL (never commit it) to have the server post
// when someone opens a public game. PUBLIC_URL, or Render's RENDER_EXTERNAL_URL, gives the link base.

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL ?? '';
const BASE = (process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL ?? '').replace(/\/$/, '');
const MIN_GAP_MS = 30_000;
let lastPost = 0;

export const discordEnabled = () => /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(WEBHOOK);

/** Posts a message, at most one every 30 seconds so a busy evening can't spam the channel. */
export async function postToDiscord(content: string): Promise<void> {
  if (!discordEnabled() || Date.now() - lastPost < MIN_GAP_MS) return;
  lastPost = Date.now();
  try {
    const res = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // No pings: names come from players, so mentions are switched off.
      body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }),
    });
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
