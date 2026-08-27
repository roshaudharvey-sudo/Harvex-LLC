require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Stripe = require("stripe");

const app = express();
const PORT = process.env.PORT || 3000;
const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeKey ? Stripe(stripeKey) : null;

// IMPORTANT: JSON parsing must happen before API routes.
// This fixes: "Cannot destructure property 'service' of 'req.body' ... undefined."
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const SERVICE_RADIUS_MILES = 65;
const SERVICE_CENTER = { lat: 34.465341, lon: -89.127076 };
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

const prices = {
  "Lawn Mowing": 45,
  "Mow + Full Cleanup": 65,
  "Hedge Trimming": 50,
  "Yard Cleanup": 75
};

// -----------------------------
// Employee / owner authentication
// -----------------------------
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const EMPLOYEE_FILE = path.join(DATA_DIR, "employees.json");
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const OWNER_LOGIN_EMAIL = (process.env.OWNER_LOGIN_EMAIL || process.env.OWNER_EMAIL || "owner@harvexlawncare.com").trim().toLowerCase();
const OWNER_LOGIN_PASSWORD = process.env.OWNER_LOGIN_PASSWORD || "";

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(EMPLOYEE_FILE)) fs.writeFileSync(EMPLOYEE_FILE, "[]", "utf8");

function loadEmployees() {
  try {
    const raw = fs.readFileSync(EMPLOYEE_FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("Could not read employee directory:", err.message);
    return [];
  }
}

function saveEmployees(employees) {
  const temp = `${EMPLOYEE_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(employees, null, 2), "utf8");
  fs.renameSync(temp, EMPLOYEE_FILE);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, expected] = String(stored).split(":");
    if (!salt || !expected) return false;
    const actual = crypto.scryptSync(password, salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

function base64url(value) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function fromBase64url(value) {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}
function signSession(payload) {
  const body = base64url(JSON.stringify({ ...payload, exp: Date.now() + 1000 * 60 * 60 * 12 }));
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function readSession(req) {
  const raw = req.headers.cookie?.split(";").map(v => v.trim()).find(v => v.startsWith("harvex_session="));
  if (!raw) return null;
  const token = decodeURIComponent(raw.slice("harvex_session=".length));
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(fromBase64url(body));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}
function setSession(res, payload) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `harvex_session=${encodeURIComponent(signSession(payload))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${secure}`);
}
function clearSession(res) {
  res.setHeader("Set-Cookie", "harvex_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}
function requireAuth(req, res, next) {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: "Please log in first." });
  req.user = session;
  next();
}
function requireOwner(req, res, next) {
  const session = readSession(req);
  if (!session || session.role !== "owner") return res.status(403).json({ error: "Owner access required." });
  req.user = session;
  next();
}

app.post("/api/auth/login", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !password) return res.status(400).json({ error: "Enter your email and password." });

  if (email === OWNER_LOGIN_EMAIL) {
    if (!OWNER_LOGIN_PASSWORD) {
      return res.status(500).json({ error: "Owner login is not configured. Add OWNER_LOGIN_PASSWORD in Render." });
    }
    if (password.length !== OWNER_LOGIN_PASSWORD.length || !crypto.timingSafeEqual(Buffer.from(password), Buffer.from(OWNER_LOGIN_PASSWORD))) {
      return res.status(401).json({ error: "Invalid email or password." });
    }
    setSession(res, { role: "owner", email: OWNER_LOGIN_EMAIL, name: "Harvex Owner" });
    return res.json({ success: true, role: "owner", redirect: "/employee-directory.html" });
  }

  const employee = loadEmployees().find(e => e.active !== false && e.email === email);
  if (!employee || !verifyPassword(password, employee.passwordHash)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  setSession(res, { role: "employee", employeeId: employee.id, email: employee.email, name: employee.name });
  res.json({ success: true, role: "employee", redirect: "/employee-directory.html" });
});

app.post("/api/auth/logout", (req, res) => { clearSession(res); res.json({ success: true }); });
app.get("/api/auth/me", requireAuth, (req, res) => {
  const session = req.user;
  if (session.role === "employee") {
    const employee = loadEmployees().find(e => e.id === session.employeeId);
    if (!employee || employee.active === false) {
      clearSession(res);
      return res.status(401).json({ error: "This employee account is inactive." });
    }
    return res.json({ role: "employee", user: { id: employee.id, name: employee.name, email: employee.email, phone: employee.phone, title: employee.title } });
  }
  res.json({ role: "owner", user: { email: OWNER_LOGIN_EMAIL, name: "Harvex Owner" } });
});

app.get("/api/employees", requireOwner, (req, res) => {
  const employees = loadEmployees().map(({passwordHash, ...safe}) => safe);
  res.json({ employees });
});

app.post("/api/employees", requireOwner, (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const phone = String(req.body?.phone || "").trim();
  const title = String(req.body?.title || "Employee").trim() || "Employee";
  const password = String(req.body?.password || "");
  if (!name || !email || !password) return res.status(400).json({ error: "Name, email and temporary password are required." });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter a valid email." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  if (email === OWNER_LOGIN_EMAIL || loadEmployees().some(e => e.email === email)) return res.status(409).json({ error: "That email is already in use." });

  const employees = loadEmployees();
  const employee = { id: crypto.randomUUID(), name, email, phone, title, active: true, createdAt: new Date().toISOString(), passwordHash: hashPassword(password) };
  employees.push(employee);
  saveEmployees(employees);
  const { passwordHash, ...safe } = employee;
  res.status(201).json({ employee: safe });
});

app.patch("/api/employees/:id", requireOwner, (req, res) => {
  const employees = loadEmployees();
  const employee = employees.find(e => e.id === req.params.id);
  if (!employee) return res.status(404).json({ error: "Employee not found." });
  if (typeof req.body?.active === "boolean") employee.active = req.body.active;
  if (typeof req.body?.name === "string" && req.body.name.trim()) employee.name = req.body.name.trim();
  if (typeof req.body?.phone === "string") employee.phone = req.body.phone.trim();
  if (typeof req.body?.title === "string" && req.body.title.trim()) employee.title = req.body.title.trim();
  if (typeof req.body?.password === "string" && req.body.password.length >= 8) employee.passwordHash = hashPassword(req.body.password);
  saveEmployees(employees);
  const { passwordHash, ...safe } = employee;
  res.json({ employee: safe });
});

// -----------------------------
// Customer first-purchase offer
// -----------------------------
async function findCustomerByEmail(email) {
  if (!stripe) return null;
  const customers = await stripe.customers.list({ email, limit: 10 });
  return customers.data[0] || null;
}

app.post("/api/signup", async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: "Stripe is not configured on the server." });
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Please enter a valid name and email." });

    let customer = await findCustomerByEmail(email);
    if (customer?.metadata?.harvex_first_purchase_promo_id) {
      try {
        const existing = await stripe.promotionCodes.retrieve(customer.metadata.harvex_first_purchase_promo_id);
        if (existing.active && existing.times_redeemed < 1) return res.json({ success: true, code: existing.code });
      } catch {}
    }

    if (!customer) customer = await stripe.customers.create({ name, email, metadata: { harvex_signup: "true" } });

    // Do not issue the offer if Stripe already shows a successful charge for this customer.
    const priorCharges = await stripe.charges.list({ customer: customer.id, limit: 1 });
    if (priorCharges.data.length) {
      return res.status(409).json({ error: "This email has already made a purchase and is not eligible for the new-customer offer." });
    }

    const coupon = await stripe.coupons.create({ percent_off: 50, duration: "once", name: "Harvex First Purchase — 50% Off" });
    const promotionCode = await stripe.promotionCodes.create({
      promotion: { type: "coupon", coupon: coupon.id },
      customer: customer.id,
      max_redemptions: 1,
      restrictions: { first_time_transaction: true }
    });

    await stripe.customers.update(customer.id, {
      name,
      metadata: { ...customer.metadata, harvex_signup: "true", harvex_first_purchase_promo_id: promotionCode.id }
    });

    res.json({ success: true, code: promotionCode.code });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(err.statusCode || 500).json({ error: err?.raw?.message || err?.message || "Unable to create your signup offer." });
  }
});

// -----------------------------
// Service area / booking / Stripe
// -----------------------------
function isBlockedBookingDate(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateString))) return false;
  const [year, month, day] = String(dateString).split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 3 || weekday === 4 || weekday === 5; // Wednesday-Friday
}

async function geocodeAddress(address) {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("q", address);
  const response = await fetch(url, { headers: { "User-Agent": "HarvexLawnCare/1.0 (https://harvexlawncare.com)" } });
  if (!response.ok) throw new Error("Address lookup failed.");
  const results = await response.json();
  if (!results.length) return null;
  return { lat: Number(results[0].lat), lon: Number(results[0].lon) };
}
function distanceMiles(a, b) {
  const earthRadiusMiles = 3958.7613;
  const toRadians = degrees => degrees * Math.PI / 180;
  const dLat = toRadians(b.lat - a.lat), dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat), lat2 = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
async function validateServiceArea(address) {
  const customer = await geocodeAddress(address);
  if (!customer) return { allowed: false, reason: "We couldn't locate that service address. Please check the address and try again." };
  const distance = distanceMiles(SERVICE_CENTER, customer);
  return { allowed: distance <= SERVICE_RADIUS_MILES, distance: Number(distance.toFixed(1)) };
}

async function sendEmail({to, subject, html, replyTo}) {
  const apiKey = process.env.RESEND_API_KEY, from = process.env.RESEND_FROM;
  if (!apiKey || !from || !to) return;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html, ...(replyTo ? {reply_to: replyTo} : {}) })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.name || `Resend returned ${response.status}`);
  return body;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
async function sendBookingNotifications({service, date, time, name, phone, email, address, notes, amount}) {
  const ownerEmail = process.env.OWNER_EMAIL;
  if (!ownerEmail || !process.env.RESEND_FROM || !process.env.RESEND_API_KEY) return;
  const safe = {service, date, time, name, phone, email, address, notes: notes || "None", amount};
  const ownerHtml = `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>🌱 New Harvex Lawn Care Booking</h2><p><strong>Checkout started</strong> — payment is handled by Stripe.</p><hr><p><strong>Service:</strong> ${escapeHtml(safe.service)}</p><p><strong>Date:</strong> ${escapeHtml(safe.date)}</p><p><strong>Time:</strong> ${escapeHtml(safe.time)}</p><p><strong>Customer:</strong> ${escapeHtml(safe.name)}</p><p><strong>Phone:</strong> ${escapeHtml(safe.phone)}</p><p><strong>Email:</strong> ${escapeHtml(safe.email)}</p><p><strong>Address:</strong> ${escapeHtml(safe.address)}</p><p><strong>Notes:</strong> ${escapeHtml(safe.notes)}</p><p><strong>Total:</strong> $${escapeHtml(safe.amount)}</p></div>`;
  try { await sendEmail({ to: ownerEmail, subject: `New Harvex booking — ${safe.service} — ${safe.date}`, html: ownerHtml, replyTo: safe.email }); }
  catch (emailError) { console.error("Booking email failed:", emailError.message); }
}

app.post("/api/create-checkout-session", async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({error: "Stripe is not configured on the server. Add STRIPE_SECRET_KEY in Render and redeploy."});
    const {service, date, time, name, phone, email, address, notes} = req.body;
    if (!prices[service] || !date || !time || !name || !phone || !email || !address) return res.status(400).json({error: "Please complete all required booking fields."});
    if (isBlockedBookingDate(date)) return res.status(400).json({error: "Online scheduling is unavailable Wednesday through Friday. Please choose Monday, Tuesday, Saturday, or Sunday."});
    const serviceArea = await validateServiceArea(address);
    if (!serviceArea.allowed) {
      const error = serviceArea.reason || `That address is approximately ${serviceArea.distance} miles away. Harvex currently serves locations within ${SERVICE_RADIUS_MILES} miles.`;
      return res.status(400).json({error});
    }

    let customer = await findCustomerByEmail(email.trim().toLowerCase());
    let discount = null;
    if (customer?.metadata?.harvex_first_purchase_promo_id) {
      try {
        const promo = await stripe.promotionCodes.retrieve(customer.metadata.harvex_first_purchase_promo_id);
        if (promo.active && promo.times_redeemed < 1) discount = { promotion_code: promo.id };
      } catch (promoError) { console.warn("Could not load first-purchase promotion:", promoError.message); }
    }

    const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
    const sessionParams = {
      mode: "payment",
      ...(customer ? { customer: customer.id } : { customer_creation: "always", customer_email: email }),
      line_items: [{ quantity: 1, price_data: { currency: "usd", product_data: {name: `Harvex Lawn Care — ${service}`}, unit_amount: prices[service] * 100 } }],
      metadata: {service, date, time, name, phone, email, address, notes: notes || "", first_purchase_discount: discount ? "50%" : "none"},
      success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/cancel.html`
    };
    if (discount) sessionParams.discounts = [discount];

    const session = await stripe.checkout.sessions.create(sessionParams);
    sendBookingNotifications({service, date, time, name, phone, email, address, notes, amount: discount ? (prices[service] * 0.5).toFixed(2) : prices[service].toFixed(2)});
    res.json({url: session.url, discounted: Boolean(discount)});
  } catch (err) {
    console.error("Stripe checkout error:", err);
    res.status(err.statusCode || 500).json({ error: err?.raw?.message || err?.message || "Unable to start secure checkout." });
  }
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`Harvex Lawn Care running on port ${PORT}`));
