require("dotenv").config();
const express = require("express");
const path = require("path");
const Stripe = require("stripe");

const app = express();
const PORT = process.env.PORT || 3000;
const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeKey ? Stripe(stripeKey) : null;

const SERVICE_RADIUS_MILES = 65;
const SERVICE_CENTER = "1015 County Road 385, Myrtle, MS 38650";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";app.use(express.json());
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
}async function geocodeAddress(address) {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("q", address);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "HarvexLawnCare/1.0 (https://harvexlawncare.com)"
    }
  });

  if (!response.ok) {
    throw new Error("Address lookup failed.");
  }

  const results = await response.json();

  if (!results.length) {
    return null;
  }

  return {
    lat: Number(results[0].lat),
    lon: Number(results[0].lon)
  };
}

function distanceMiles(a, b) {
  const earthRadiusMiles = 3958.7613;

  const toRadians = degrees => degrees * Math.PI / 180;

  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);

  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) *
    Math.cos(lat2) *
    Math.sin(dLon / 2) ** 2;

  return earthRadiusMiles *
    2 *
    Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

let serviceCenterCoordinatesPromise;

function getServiceCenterCoordinates() {
  if (!serviceCenterCoordinatesPromise) {
    serviceCenterCoordinatesPromise = geocodeAddress(SERVICE_CENTER);
  }

  return serviceCenterCoordinatesPromise;
}

async function validateServiceArea(address) {
  const [center, customer] = await Promise.all([
    getServiceCenterCoordinates(),
    geocodeAddress(address)
  ]);

  if (!center) {
    throw new Error("Harvex service area could not be located.");
  }

  if (!customer) {
    return {
      allowed: false,
      reason: "We couldn't locate that service address. Please check the address and try again."
    };
  }

  const distance = distanceMiles(center, customer);

  return {
    allowed: distance <= SERVICE_RADIUS_MILES,
    distance: Number(distance.toFixed(1))
  };
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
    const serviceArea = await validateServiceArea(address);

if (!serviceArea.allowed) {
  const error = serviceArea.reason ||
    `That address is approximately ${serviceArea.distance} miles away. Harvex currently serves locations within ${SERVICE_RADIUS_MILES} miles.`;

  return res.status(400).json({error});
}

    const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
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
