# Harvex Lawn Care

## Updated website
This version includes:
- Fixed JSON body parsing for booking checkout.
- 65-mile service-area validation.
- 50% off first-purchase customer signup with a unique Stripe promotion code.
- Owner/employee login portal.
- Owner-only employee directory and account creation/deactivation.

## Render environment variables
Set these in Render before deploying:
- `STRIPE_SECRET_KEY`
- `PUBLIC_URL`
- `OWNER_EMAIL`
- `RESEND_API_KEY` (optional)
- `RESEND_FROM` (optional)
- `OWNER_LOGIN_EMAIL`
- `OWNER_LOGIN_PASSWORD` — choose a strong password yourself; do not commit it to GitHub.
- `SESSION_SECRET` — long random secret.
- `DATA_DIR` — leave `./data` for local testing. For Render, use a persistent disk mount such as `/var/data` if you want employee accounts to survive redeploys.

Employee login: `/employee-login.html`
Owner directory: after owner login, you are taken to `/employee-directory.html`.
