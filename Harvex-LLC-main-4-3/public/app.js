const form = document.getElementById("booking-form");
const service = document.getElementById("service");
const total = document.getElementById("total");
const date = document.getElementById("date");
const message = document.getElementById("form-message");

function isBlockedBookingDay(value) {
  if (!value) return false;
  const [year, month, day] = value.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 3 || weekday === 4 || weekday === 5; // Wed, Thu, Fri
}

function localDateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Custom calendar: Wed–Fri are visibly crossed out and cannot be selected.
const calendarGrid = document.getElementById("calendar-grid");
const calendarMonth = document.getElementById("calendar-month");
const calendarSelected = document.getElementById("calendar-selected");
const calendarPrev = document.getElementById("calendar-prev");
const calendarNext = document.getElementById("calendar-next");
let calendarView = new Date();
calendarView.setDate(1);

function renderCalendar() {
  if (!calendarGrid || !calendarMonth || !date) return;
  calendarMonth.textContent = calendarView.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  calendarGrid.innerHTML = "";

  const year = calendarView.getFullYear();
  const month = calendarView.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = startOfToday();

  for (let i = 0; i < firstWeekday; i++) {
    const empty = document.createElement("span");
    empty.className = "calendar-day empty";
    calendarGrid.appendChild(empty);
  }

  for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber++) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-day";
    cell.textContent = dayNumber;
    const current = new Date(year, month, dayNumber);
    const value = localDateString(current);
    const weekday = current.getDay();
    const closed = weekday === 3 || weekday === 4 || weekday === 5;
    const past = current < today;
    const selected = date.value === value;

    cell.dataset.date = value;
    if (closed) {
      cell.classList.add("closed");
      cell.disabled = true;
      cell.setAttribute("aria-label", `${current.toLocaleDateString(undefined, {month:"long", day:"numeric", year:"numeric"})} — closed Wednesday through Friday`);
      cell.title = "Closed Wednesday through Friday";
    } else if (past) {
      cell.classList.add("past");
      cell.disabled = true;
    } else {
      cell.classList.add("available");
      cell.setAttribute("aria-label", `${current.toLocaleDateString(undefined, {month:"long", day:"numeric", year:"numeric"})} — available`);
      cell.addEventListener("click", () => selectCalendarDate(value, current));
    }
    if (selected) cell.classList.add("selected");
    calendarGrid.appendChild(cell);
  }

  const prevMonth = new Date(year, month - 1, 1);
  calendarPrev.disabled = prevMonth.getFullYear() < today.getFullYear() ||
    (prevMonth.getFullYear() === today.getFullYear() && prevMonth.getMonth() < today.getMonth());
}

function selectCalendarDate(value, current) {
  if (isBlockedBookingDay(value)) return;
  date.value = value;
  calendarSelected.textContent = `Selected: ${current.toLocaleDateString(undefined, {weekday:"long", month:"long", day:"numeric", year:"numeric"})}`;
  calendarSelected.classList.add("has-date");
  if (message) message.textContent = "";
  renderCalendar();
}

calendarPrev?.addEventListener("click", () => {
  calendarView.setMonth(calendarView.getMonth() - 1);
  renderCalendar();
});
calendarNext?.addEventListener("click", () => {
  calendarView.setMonth(calendarView.getMonth() + 1);
  renderCalendar();
});
renderCalendar();

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
  if (!date?.value) {
    if (message) {
      message.textContent = "Please select an available date from the calendar.";
      message.style.color = "#a53b32";
    }
    return;
  }
  if (isBlockedBookingDay(date.value)) {
    date.value = "";
    renderCalendar();
    if (message) {
      message.textContent = "Wednesday through Friday are unavailable. Please choose an available date.";
      message.style.color = "#a53b32";
    }
    return;
  }
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
