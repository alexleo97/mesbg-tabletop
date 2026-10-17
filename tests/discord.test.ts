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
