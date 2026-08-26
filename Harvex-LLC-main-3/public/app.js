const form = document.getElementById("booking-form");
const service = document.getElementById("service");
const total = document.getElementById("total");
const date = document.getElementById("date");
const message = document.getElementById("form-message");

if (date) date.min = new Date().toISOString().split("T")[0];

function updateTotal() {
  const opt = service?.options[service.selectedIndex];
  if (total) total.textContent = opt && opt.dataset.price ? `$${opt.dataset.price}` : "$0";
}
if (service) service.addEventListener("change", updateTotal);

document.querySelectorAll("[data-service]").forEach(btn => {
  btn.addEventListener("click", () => {
    if (service) {
      service.value = btn.dataset.service;
      updateTotal();
    }
    document.getElementById("booking")?.scrollIntoView({behavior:"smooth"});
  });
});

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  message.textContent = "Creating your secure checkout…";
  message.style.color = "#4e765c";
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    const res = await fetch("/api/create-checkout-session", {
      method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(data)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || "Unable to start checkout.");
    window.location.href = result.url;
  } catch (err) {
    message.textContent = err.message;
    message.style.color = "#a53b32";
  }
});

const signupForm = document.getElementById("signup-form");
const signupMessage = document.getElementById("signup-message");
const promoResult = document.getElementById("promo-result");
signupForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  signupMessage.textContent = "Creating your offer…";
  signupMessage.style.color = "#4e765c";
  promoResult.hidden = true;
  try {
    const data = Object.fromEntries(new FormData(signupForm).entries());
    const res = await fetch("/api/signup", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data) });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || "Unable to create your offer.");
    signupMessage.textContent = "You're signed up! Use the same email when you book and your 50% discount will be applied automatically.";
    promoResult.textContent = `50% OFF — ${result.code}`;
    promoResult.hidden = false;
    signupForm.reset();
  } catch (err) {
    signupMessage.textContent = err.message;
    signupMessage.style.color = "#a53b32";
  }
});
