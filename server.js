require("dotenv").config();
const express = require("express");
const path = require("path");
const Stripe = require("stripe");

const app = express();
const PORT = process.env.PORT || 3000;
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const prices = {
  "Lawn Mowing": 45,
  "Mow + Full Cleanup": 65,
  "Hedge Trimming": 50,
  "Yard Cleanup": 75
};

app.post("/api/create-checkout-session", async (req, res) => {
  try {
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
          product_data: {name: service},
          unit_amount: prices[service] * 100
        }
      }],
      metadata: {service, date, time, name, phone, address, notes: notes || ""},
      success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/cancel.html`
    });

    res.json({url: session.url});
  } catch (err) {
    console.error(err);
    res.status(500).json({error: "Checkout is not configured yet. Add your Stripe secret key to .env."});
  }
});

app.get("*", (req,res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`Harvey Lawn Care running on port ${PORT}`));
