# Hosting & Maintenance playbook

Ovrix hosts **only what it builds**, on managed platforms. Domains and accounts stay **in the client's name**; Ovrix gets admin access and charges for looking after it. No home servers for paying clients.

## Where things run

| Project | Platform | Typical monthly cost to Ovrix |
|---|---|---|
| Static / Next.js site, landing page | Vercel or Cloudflare Pages (client's account) | Free tier for most small sites |
| WordPress site | Hostinger Business or Cloud plan (several client sites on one plan) | Buy only when the first WordPress client signs |
| Discord bot, custom bot, small API | Railway, or one small VPS (Hetzner / DigitalOcean) running all small bots | About $5–6 for all of them |
| Database | Supabase (client's project) | Free to start; Pro for daily backups |

Check current prices before quoting. The Hosting agent marks cost estimates **TO CONFIRM**.

## Onboarding a hosting client (one time)

1. Plan signed (Starter / Growth / Studio) and first month paid.
2. Client creates the accounts in **their** name: domain registrar, Vercel / Railway / Supabase as needed. Invite `krishil9316k` as admin. Never ask for their password.
3. Code in a GitHub repo the client owns (Ovrix as collaborator).
4. Domain: add it in the platform, paste the DNS records at the registrar, wait for SSL (automatic).
5. Backups: code is on GitHub. Database: Supabase Pro daily backups, or a nightly export job.
6. Uptime: add the site to the Watchdog. In Vercel → ovrix → Environment Variables, add the URL to `CLIENT_SITES` (Config type, comma-separated, e.g. `https://shop-a.in,https://shop-b.com`) and redeploy. The Watchdog checks every 30 minutes and alerts in #security-alerts if it goes down or its SSL certificate is within 14 days of expiry.
7. Write down in the client's card: URLs, platforms, renewal dates, what the plan includes.

## Monthly routine (what the fee pays for)

- [ ] Uptime report from Watchdog: any downtime, and why
- [ ] Security updates: dependencies, platform notices, Dependabot alerts
- [ ] Check backups exist and one restore works (quarterly)
- [ ] Domain and SSL renewals: nothing expiring in the next 60 days
- [ ] Small edits within the plan's hours (Growth: 2 h)
- [ ] Short monthly report, drafted by the Hosting agent and sent only after Krishil approves it

## Included vs billable

Included: keeping it online, SSL, backups, security updates, small edits within plan hours, the monthly report.
Billable (quoted first): new pages or features, redesigns, work beyond plan hours, platform costs above the plan (big traffic, paid tiers).

## If a client leaves

Everything is already in their name. Ovrix removes its own access, hands over a short note of where things run, and stops billing at the end of the paid month.
