# Discord control room — setup (about 10 minutes)

This server is where you watch and approve everything. The bot finds channels **by name**, so you never copy channel IDs.

## 1. Create the server

Create a new private Discord server (e.g. "Ovrix HQ"). Keep it invite-only; it will contain client briefs.

## 2. Create these text channels (exact names, lowercase)

| Category | Channel | Used for |
|---|---|---|
| **MANAGER** | `approvals` | New briefs with Approve / Reject buttons |
| | `agent-logs` | Status, errors, "ready for review" notices, daily digest |
| | `payments` | Verified payments with Deposit paid / Fully paid / Ignore buttons |
| | `support` | Draft replies for you to edit and send |
| | `security-alerts` | Watchdog alerts (site down, leaked secret, expiring certificate) |
| **SPECIALISTS** | `video-editing` | Video Editing agent plans |
| | `ai-films` | AI Films agent plans |
| | `ai-ads` | AI Ad Films agent plans |
| | `website-build` | Website Build agent plans |
| | `custom-bots` | Custom Bots agent plans |
| | `discord-bots` | Discord Bots agent plans |
| | `discord-servers` | Discord Servers agent plans |
| | `hosting` | Hosting & Maintenance agent plans |

Tip: make `approvals` and `agent-logs` the first two channels so they are easy to find.

## 3. Create the approver role

Server Settings → Roles → create a role named exactly **Approver** and give it to yourself and anyone you trust to approve work.
(The server owner can always approve.) Only these people can press the buttons.

## 4. Create the bot

1. Go to <https://discord.com/developers/applications> → **New Application** → name it "VC Manager".
2. Open **Bot** → **Reset Token** → copy it into `.env` as `DISCORD_BOT_TOKEN`. Treat it like a password.
3. Leave all **Privileged Gateway Intents** OFF. The bot does not need them.
4. Open **OAuth2 → URL Generator**: scopes `bot` **and** `applications.commands` (needed for the slash commands); bot permissions: **View Channels**, **Send Messages**, **Embed Links**.
5. Open the generated URL and add the bot to your server. Do not give it Administrator.

## 5. Get the server ID

Discord → User Settings → Advanced → turn on **Developer Mode**. Right-click your server icon → **Copy Server ID** → `.env` as `DISCORD_GUILD_ID`.

## 6. Lock the channels down

For every channel above: remove "View Channel" from `@everyone`, and allow it for `Approver` and for the bot. Briefs contain client names and emails.

## 7. Run it

```bash
cd automation
cp .env.example .env     # fill in the values
npm install
npm test                 # mocked end-to-end check, no keys needed
npm start
```

You should see "🟢 Manager online" in `#agent-logs`. Submit a test brief on your website: within `POLL_SECONDS` it appears in `#approvals`.
Press **Approve**: the specialist plans appear in their channels and `#agent-logs` says the order is ready for review.

## Troubleshooting

- **Slash commands missing**: re-invite the bot with the `applications.commands` scope.
- **"channel #xyz not found"**: the channel name doesn't match exactly, or the bot can't see it.
- **Buttons say "Only the Approver role…"**: give yourself the `Approver` role.
- **Nothing appears in `#approvals`**: check the order row exists with `status = new`, and the service key is the secret key (`sb_secret_…`), not the publishable one.
