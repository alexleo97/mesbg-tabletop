import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Discord announcements', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('posts an open game with a link, stripping formatting and pings from the name', async () => {
    vi.stubEnv('DISCORD_WEBHOOK_URL', 'https://discord.com/api/webhooks/1/abc');
    vi.stubEnv('RENDER_EXTERNAL_URL', 'https://mesbg-tabletop.onrender.com/');
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const { announceGame } = await import('../server/discord.ts');
    await announceGame('erebor-1234', '**Alex** @everyone', 'Domination');
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.content).toBe('⚔️ **Alex everyone** opened a game (Domination) and needs an opponent: https://mesbg-tabletop.onrender.com/?room=erebor-1234');
    expect(body.allowed_mentions).toEqual({ parse: [] });
    // A second game straight after is held back by the 30 second gap.
    await announceGame('dale-1', 'Sam', undefined);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a Discord webhook', async () => {
    vi.stubEnv('DISCORD_WEBHOOK_URL', 'https://example.com/hook');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { announceGame, discordEnabled } = await import('../server/discord.ts');
    await announceGame('x', 'y', undefined);
    expect(discordEnabled()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('Discord voice rooms', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const setup = (handler: (url: string, init: RequestInit) => unknown) => {
    vi.stubEnv('DISCORD_BOT_TOKEN', 'test-token');
    vi.stubEnv('DISCORD_GUILD_ID', '42');
    vi.stubEnv('DISCORD_WEBHOOK_URL', 'https://discord.com/api/webhooks/1/abc');
    vi.stubEnv('RENDER_EXTERNAL_URL', 'https://mesbg-tabletop.onrender.com');
    const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
      const out = handler(url, init);
      return out === undefined ? new Response(null, { status: 204 }) : new Response(JSON.stringify(out), { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };

  it('opens a channel under Battlefields named for the players and posts its invite', async () => {
    const fetch = setup((url, init) => {
      if (url.endsWith('/guilds/42/channels') && init.method === 'GET') return [{ id: '7', name: 'Battlefields', type: 4 }];
      if (url.endsWith('/guilds/42/channels')) return { id: '99', name: 'x', type: 2 };
      if (url.endsWith('/channels/99/invites')) return { code: 'abc123' };
      return undefined;
    });
    const { openVoiceRoom } = await import('../server/discord.ts');
    expect(await openVoiceRoom('erebor-1', ['**Alex**', 'Sam @here'], 'Domination')).toBe('99');
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    const create = calls.find(([u, i]) => u.endsWith('/guilds/42/channels') && i.method === 'POST')!;
    expect(JSON.parse(create[1].body as string)).toEqual({ name: '⚔ Alex vs Sam here', type: 2, parent_id: '7' });
    expect((create[1].headers as Record<string, string>).authorization).toBe('Bot test-token');
    await new Promise(r => setTimeout(r, 0));
    const post = calls.find(([u]) => u.includes('/webhooks/'))!;
    expect(JSON.parse(post[1].body as string).content).toBe(
      '🔊 **Alex** and **Sam here** started a game (Domination). Voice room: https://discord.gg/abc123 Watch: https://mesbg-tabletop.onrender.com/?room=erebor-1',
    );
  });

  it('tidies up only old game channels nobody is using', async () => {
    const old = String((BigInt(Date.now() - 1000 * 60 * 60 - 1420070400000) << 22n));
    const fresh = String((BigInt(Date.now() - 1420070400000) << 22n));
    const fetch = setup((url, init) => {
      if (url.endsWith('/guilds/42/channels') && init.method === 'GET')
        return [
          { id: '7', name: 'Battlefields', type: 4 },
          { id: old, name: '⚔ Alex vs Sam', type: 2, parent_id: '7' },
          { id: fresh, name: '⚔ New game', type: 2, parent_id: '7' },
          { id: '1', name: 'Battle Table 1', type: 2, parent_id: '7' },
          { id: '5', name: '⚔ In use', type: 2, parent_id: '7' },
        ];
      return undefined;
    });
    const { sweepVoiceRooms } = await import('../server/discord.ts');
    await sweepVoiceRooms(new Set(['5']), 1000 * 60 * 30);
    const deleted = (fetch.mock.calls as unknown as [string, RequestInit][]).filter(([, i]) => i.method === 'DELETE').map(([u]) => u);
    expect(deleted).toEqual([`https://discord.com/api/v10/channels/${old}`]);
  });

  it('does nothing without a bot token', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { openVoiceRoom, voiceEnabled } = await import('../server/discord.ts');
    expect(voiceEnabled()).toBe(false);
    expect(await openVoiceRoom('x', [], undefined)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
