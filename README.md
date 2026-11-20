# Ovrix

**An independent AI studio from India.** Ovrix builds AI products and does studio work for businesses: websites, bots and AI video.

**Live:** [ovrix-kappo.vercel.app](https://ovrix-kappo.vercel.app) · **Product:** [Kaapo](https://ovrix-kappo.vercel.app/kaapo) · **Built by** Krishil

---

## What's in this repo

| Path | What it is |
| --- | --- |
| `/` | The Ovrix site: products, services, pricing, process, FAQ and a brief form |
| `/kaapo` | Landing page for Kaapo |
| `/kaapo/app` | **Kaapo**, a chat-to-edit reel editor that runs in the browser |
| `/api` | Serverless functions for Kaapo's AI (captions, edit planning) |
| `/api/ops`, `/ops` | **The Ovrix agent team**, which turns client briefs into approved plans |

## Kaapo: talk to your video, get a finished reel

You drop in a clip and say what you want, in plain words or by voice. Kaapo then:

- writes **word-timed captions** in Gujarati, Hindi, Hinglish or English
- cuts pauses (light, normal or tight jump-cuts) and reframes to 9:16
- finds a hook, adds zooms, b-roll, music and a progress bar
- turns product photos and an offer into a shop ad

Editing and export happen **in the browser**, so the video file never leaves the device. Only the audio (for captions) and chat text plus small frames (for planning) go to Gemini.

## The agent team

Every brief from the contact form goes through a small team of AI agents. A person approves each step before anything reaches a client.

```
Brief form ──► Supabase (insert-only from the web)
                  │  pg_cron every 5 min
                  ▼
            Ovrix Manager ──► 1 of 8 specialists ──► plan in Discord #approvals
                                                    │
                     Krishil approves (/reply, /mark-paid) ◄┘
Support · Billing · Watchdog (health checks every 30 min, daily digest)
```

- **Manager:** triages each brief, picks a specialist and sets priority. Treats client text as untrusted input.
- **Specialists:** video editing, AI films, AI ads, websites, custom bots, Discord bots, Discord servers, hosting.
- **Support / Billing:** they only draft replies and payment prompts; nothing is sent or marked paid without approval.
- **Watchdog:** checks the site, functions and database, and posts alerts.

## Stack

- **Front end:** hand-written HTML, CSS and JS (no framework), Geist type, a dark/light theme with motion that respects reduced-motion settings
- **Hosting:** Vercel (static pages and Node functions)
- **AI:** Google Gemini, with a fast-first model chain, per-model timeouts and fallbacks
- **Data:** Supabase (Postgres) with RLS; pg_net triggers and pg_cron schedules
- **Ops:** Discord HTTP interactions (Ed25519-verified), slash commands for approvals
- **Security:** strict CSP, HSTS, frame-ancestors none; only the publishable key is used in the browser, and server secrets live in Vercel env vars

## Run the tests

```bash
npm install
npm test    # agent logic, Vercel handlers and a full dry run
```

## Configuration

The site reads these from **Vercel → Settings → Environment Variables**. They are never committed:

`GEMINI_API_KEY` · `SUPABASE_SERVICE_KEY` · `OPS_SECRET` · `DISCORD_BOT_TOKEN` · `DISCORD_GUILD_ID` · `DISCORD_PUBLIC_KEY`

`GET /api/ops/setup` reports which ones are present (true/false only). See [`ops/SETUP.md`](ops/SETUP.md) for the full setup.

---

© 2026 Ovrix. All rights reserved.
