# Ovrix website (with Kaapo inside)

One project, one deploy, clean addresses:

| Address | Page |
| --- | --- |
| `/` | Ovrix company site: products, services, pricing, process, about, FAQ, contact |
| `/kaapo` | Kaapo product page |
| `/kaapo/app` | The Kaapo editor |
| `/privacy`, `/terms` | Legal pages |
| `/api/ai`, `/api/transcribe` | Kaapo's AI (Gemini), runs on Vercel |

## Put it online (about 15 minutes)

1. **GitHub:** create a new repository named `ovrix` and upload everything in this folder (VS Code → Source Control → Publish to GitHub).
2. **Vercel:** vercel.com → Add New → Project → import `ovrix` → Framework preset **Other** → Deploy.
   Your site is now at `ovrix.vercel.app` (or a similar name if that one is taken; you can rename the project in Settings → Domains).
3. **Gemini key:** Vercel → Settings → Environment Variables → `GEMINI_API_KEY` = your key from Google AI Studio → Redeploy.
4. **Own domain (later):** buy `ovrix.in` or `ovrix.ai`, then Vercel → Settings → Domains → add it. Then update `robots.txt` and `sitemap.xml` to the new address.
5. **Old GitHub Pages site:** once the new one is live, go to the old `muti-service-website` repo → Settings → Pages → turn it off (or archive the repo), so there's only one Ovrix website.

## Things to edit

- **Payment links:** in `index.html`, search `PAYMENT_LINKS` and paste your Stripe or Razorpay links. Empty = the button scrolls to the contact form.
- **Contact email:** search `krishilraj20@gmail.com` (in `index.html`, `kaapo/index.html`, `privacy.html`, `terms.html`).
- **Legal pages:** these are starter templates, not legal advice. They name "Ovrix" as the operator. Add the registered legal name (e.g. "Ovrix … Pvt. Ltd.") only after the company is actually registered.
