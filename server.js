require("dotenv").config();
const express = require("express");
const path = require("path");
const Stripe = require("stripe");

const app = express();
const PORT = process.env.PORT || 3000;
const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeKey ? Stripe(stripeKey) : null;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const prices = {
  "Lawn Mowing": 45,
  "Mow + Full Cleanup": 65,
  "Hedge Trimming": 50,
  "Yard Cleanup": 75
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function sendEmail({to, subject, html, replyTo}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;

  if (!apiKey || !from || !to) {
    console.warn("Email notification skipped: set RESEND_API_KEY, RESEND_FROM, and OWNER_EMAIL in Render.");
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from, to: [to], subject, html, ...(replyTo ? {reply_to: replyTo} : {}) })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message || body.name || `Resend returned ${response.status}`);
  }

  return body;
}

async function sendBookingNotifications({service, date, time, name, phone, email, address, notes, amount}) {
  const ownerEmail = process.env.OWNER_EMAIL;
  const from = process.env.RESEND_FROM;
  if (!ownerEmail || !from || !process.env.RESEND_API_KEY) return;

  const safe = {service, date, time, name, phone, email, address, notes: notes || "None", amount};
  const ownerHtml = `
    <div style="font-family:Arial,sans-serif;line-height:1.6">
      <h2>🌱 New Harvex Lawn Care Booking</h2>
      <p><strong>Checkout started</strong> — payment is handled by Stripe.</p>
      <hr>
      <p><strong>Service:</strong> ${escapeHtml(safe.service)}</p>
      <p><strong>Date:</strong> ${escapeHtml(safe.date)}</p>
      <p><strong>Time:</strong> ${escapeHtml(safe.time)}</p>
      <p><strong>Customer:</strong> ${escapeHtml(safe.name)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(safe.phone)}</p>
      <p><strong>Email:</strong> ${escapeHtml(safe.email)}</p>
      <p><strong>Address:</strong> ${escapeHtml(safe.address)}</p>
      <p><strong>Notes:</strong> ${escapeHtml(safe.notes)}</p>
      <p><strong>Total:</strong> $${escapeHtml(safe.amount)}</p>
    </div>`;

  try {
    await sendEmail({
      to: ownerEmail,
      subject: `New Harvex booking — ${safe.service} — ${safe.date}`,
      html: ownerHtml,
      replyTo: safe.email
    });
    console.log("Booking notification email sent.");
  } catch (emailError) {
    console.error("Booking email failed:", emailError.message);
  }
}

app.post("/api/create-checkout-session", async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({error: "Stripe is not configured on the server. Add STRIPE_SECRET_KEY in Render and redeploy."});
    }

    const {service, date, time, name, phone, email, address, notes} = req.body;
    if (!prices[service] || !date || !time || !name || !phone || !email || !address) {
      return res.status(400).json({error: "Please complete all required booking fields."});
    }

    const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd",
          product_data: {name: `Harvex Lawn Care — ${service}`},
          unit_amount: prices[service] * 100
        }
      }],
      metadata: {service, date, time, name, phone, address, notes: notes || ""},
      success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/cancel.html`
    });

    // Send a notification without blocking checkout if email delivery fails.
    sendBookingNotifications({
      service, date, time, name, phone, email, address, notes,
      amount: prices[service].toFixed(2)
    });

    res.json({url: session.url});
  } catch (err) {
    console.error("Stripe checkout error:", err);
    res.status(err.statusCode || 500).json({
      error: err?.raw?.message || err?.message || "Unable to start secure checkout."
    });
  }
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`Harvex Lawn Care running on port ${PORT}`));
