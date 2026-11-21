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

## 2. Discord (the bot sets most of it up itself)
1. Create a server **Ovrix HQ** (you become the owner and the approver).
2. discord.com/developers/applications -> New Application **Ovrix Ops**:
   - General Information: note the **Public Key** (not secret).
   - Bot: turn **Public Bot** off, then Reset Token and copy the **token** (secret: paste it only into Vercel).
   - Installation / OAuth2: scopes `bot` + `applications.commands`; permissions View Channels, Send Messages,
     Embed Links, Read Message History, **Manage Channels**, **Manage Roles**. Open the link and add the bot to Ovrix HQ.
3. Server ID: Developer Mode on, right-click the server -> Copy Server ID.

You don't create channels or roles by hand. On its first run the bot:
- creates any missing channels under an **Ovrix Agents** category
  (`approvals, agent-logs, video-editing, ai-films, ai-ads, website-build, custom-bots, discord-bots, discord-servers, hosting, support, payments, security-alerts`)
- creates the **Approver** role and gives it to the server owner
- registers `/reply` and `/mark-paid`
- posts "Ovrix Ops is connected" in #agent-logs

## 3. Vercel -> Project ovrix -> Settings -> Environment Variables
| Name | Value | Type |
|---|---|---|
| SUPABASE_SERVICE_KEY | Supabase -> Project Settings -> API Keys -> secret key (`sb_secret_...`) | Secret |
| OPS_SECRET | value from step 1 | Secret |
| DISCORD_BOT_TOKEN | bot token | Secret |
| DISCORD_GUILD_ID | server id | Config |
| DISCORD_PUBLIC_KEY | public key | Config |
| GEMINI_API_KEY | already set | Secret |

Redeploy. `https://ovrix-kappo.vercel.app/api/ops/setup` should show `true` for each one.
Then, in the Developer Portal, set **Interactions Endpoint URL** to `https://ovrix-kappo.vercel.app/api/ops/discord`
(Discord checks it immediately, so DISCORD_PUBLIC_KEY must be live first).
Within 5 minutes the scheduled run does the server setup above. To rerun it at any time:
`curl -X POST https://ovrix-kappo.vercel.app/api/ops/setup -H "x-ops-secret: <OPS_SECRET>"`

## Tests
`npm install && npm test` (mocked, no keys needed).
