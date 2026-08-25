# Harvex Lawn Care Website

A responsive lawn-care website with:
- Service cards and pricing
- Booking form (service, date, time, customer/contact/address)
- Stripe Checkout payment flow
- Your uploaded lawn/property photos
- Mobile-friendly design

## Before going live

1. Install Node.js.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Put your Stripe secret key in `STRIPE_SECRET_KEY`.
5. Set `PUBLIC_URL` to your deployed website URL.
6. Run `npm start`.

### Important
The prices in `server.js` and the service cards in `public/index.html` are starter prices. Change them before accepting real payments.

For real scheduling, the next upgrade should be a calendar/availability system so customers cannot book an already-taken slot. The Stripe Checkout session already carries the requested date/time in payment metadata, which gives you a clean foundation for that integration.


## Email notifications
The booking form can notify the owner through Resend. Add `RESEND_API_KEY`, `RESEND_FROM`, and `OWNER_EMAIL` as Render environment variables. Verify your sending domain in Resend before using an address such as `bookings@harvexlawncare.com`.
