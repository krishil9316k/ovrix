# Ovrix service agents: setup

The agents run inside the Ovrix site on Vercel. Nothing extra to host.

```
Website brief -> Supabase `leads` -> (database calls) /api/ops/tick -> Manager (Gemini) -> Discord #approvals [Approve][Reject]
Approve -> specialist agent drafts the plan in its Discord room -> #agent-logs "ready for review" -> Support drafts the first reply in #support
Every 30 min: Watchdog (site, secrets, RLS, Kaapo AI, stuck orders) -> #security-alerts.  9 AM IST: daily digest.
Payments (later): Stripe/Razorpay webhooks -> /api/ops/payments -> #payments [Deposit paid][Fully paid][Ignore]
Nothing is ever sent to a client or marked paid without a human.
```

## 1. Database (Supabase "ovrix" project -> SQL Editor)
Run `ops/schema.sql`, then `ops/schema-vercel.sql`. Then run
`select value from ops_config where key = 'ops_secret';` and copy the value (this is OPS_SECRET).

## 2. Discord
1. Create a server "Ovrix HQ". Create text channels:
   `approvals, agent-logs, video-editing, ai-films, ai-ads, website-build, custom-bots, discord-bots, discord-servers, hosting, support, payments, security-alerts`
2. Create a role named **Approver** (only you, for now).
3. discord.com/developers/applications -> New Application "Ovrix Agents":
   - General Information: copy **Application ID** and **Public Key**.
   - Bot: Reset Token, copy the **token** (keep it secret).
   - Interactions Endpoint URL: `https://ovrix-kappo.vercel.app/api/ops/discord` (set this AFTER step 3 is deployed).
   - OAuth2 -> URL Generator: scopes `bot` + `applications.commands`; permissions View Channels, Send Messages,
     Embed Links, Read Message History. Open the URL and add the bot to Ovrix HQ.
4. Server ID: Discord settings -> Advanced -> Developer Mode on, then right-click the server -> Copy Server ID.

## 3. Vercel -> Project ovrix -> Settings -> Environment Variables
| Name | Value |
|---|---|
| SUPABASE_SERVICE_KEY | Supabase -> Project Settings -> API Keys -> secret key (`sb_secret_...`) |
| OPS_SECRET | value from step 1 |
| DISCORD_BOT_TOKEN | bot token |
| DISCORD_GUILD_ID | server id |
| DISCORD_PUBLIC_KEY | public key |
| GEMINI_API_KEY | already set |

Redeploy. Check `https://ovrix-kappo.vercel.app/api/ops/setup` shows `true` for everything you set.
Then register the slash commands (/reply, /mark-paid) once:
`curl -X POST https://ovrix-kappo.vercel.app/api/ops/setup -H "x-ops-secret: <OPS_SECRET>"`

## Tests
`npm install && npm test` (mocked, no keys needed).
