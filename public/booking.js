/* Booking modal logic for "Book a Session" */

const TIME_SLOTS = ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00'];

let calViewYear, calViewMonth; // month currently shown in calendar
let selectedDate = null;       // 'YYYY-MM-DD'
let selectedTime = null;       // '09:00' etc.

const MIN_DATE = new Date();
MIN_DATE.setHours(0,0,0,0);
const MAX_MONTHS_AHEAD = 2;

function pad(n){ return n.toString().padStart(2,'0'); }
function dateKey(y,m,d){ return `${y}-${pad(m+1)}-${pad(d)}`; }

function formatTimeLabel(t){
  const [h,m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${period}`;
}

function formatDateLabel(dateStr){
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });
}

function openBookingModal(){
  const today = new Date();
  calViewYear = today.getFullYear();
  calViewMonth = today.getMonth();
  selectedDate = null;
  selectedTime = null;

  document.getElementById('bookStep1').style.display = 'block';
  document.getElementById('bookStep2').style.display = 'none';
  document.getElementById('bookStep3').style.display = 'none';
  document.getElementById('slotsWrap').style.display = 'none';
  document.getElementById('genError')?.classList.add('hidden');

  updateSummary();
  renderCalendar();
  document.getElementById('bookingModal').classList.add('open');
}

function closeBookingModal(){
  document.getElementById('bookingModal').classList.remove('open');
}

function updateSummary(){
  const projectType = document.getElementById('bookProjectType').value;
  const scriptLength = document.getElementById('bookScriptLength').value;
  const deliveryTime = document.getElementById('bookDeliveryTime').value;
  const text = `${projectType} • ${scriptLength} • ${deliveryTime}`;
  const el1 = document.getElementById('bookSummary');
  const el2 = document.getElementById('bookSummary2');
  if (el1) el1.textContent = text;
  if (el2) el2.textContent = text;
}

function calShift(dir){
  calViewMonth += dir;
  if (calViewMonth < 0){ calViewMonth = 11; calViewYear--; }
  if (calViewMonth > 11){ calViewMonth = 0; calViewYear++; }
  renderCalendar();
}

function renderCalendar(){
  const label = document.getElementById('calMonthLabel');
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  label.textContent = `${monthNames[calViewMonth]} ${calViewYear}`;

  const today = new Date();
  const minMonth = today.getMonth(), minYear = today.getFullYear();
  const maxDate = new Date(minYear, minMonth + MAX_MONTHS_AHEAD, 1);

  document.getElementById('calPrev').disabled = (calViewYear === minYear && calViewMonth === minMonth);
  document.getElementById('calNext').disabled = (calViewYear === maxDate.getFullYear() && calViewMonth === maxDate.getMonth());

  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';
  ['S','M','T','W','T','F','S'].forEach(d => {
    const el = document.createElement('div');
    el.className = 'cal-dow';
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDay = new Date(calViewYear, calViewMonth, 1).getDay();
  const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();

  for (let i = 0; i < firstDay; i++){
    const el = document.createElement('div');
    el.className = 'cal-day empty';
    grid.appendChild(el);
  }

  for (let d = 1; d <= daysInMonth; d++){
    const el = document.createElement('div');
    el.className = 'cal-day';
    el.textContent = d;
    const thisDate = new Date(calViewYear, calViewMonth, d);
    const dow = thisDate.getDay();
    const key = dateKey(calViewYear, calViewMonth, d);

    const isPast = thisDate < MIN_DATE;
    const isSunday = dow === 0; // studio closed Sundays

    if (isPast || isSunday){
      el.classList.add('disabled');
    } else {
      el.onclick = () => selectDate(key, el);
      if (key === selectedDate) el.classList.add('selected');
    }
    grid.appendChild(el);
  }
}

function selectDate(key, el){
  document.querySelectorAll('.cal-day.selected').forEach(n => n.classList.remove('selected'));
  el.classList.add('selected');
  selectedDate = key;
  selectedTime = null;

  document.getElementById('slotsDateLabel').textContent = formatDateLabel(key);
  document.getElementById('slotsWrap').style.display = 'block';
  document.getElementById('slotsLoading').style.display = 'block';
  document.getElementById('slotsGrid').innerHTML = '';

  fetchAvailability(key);
}

async function fetchAvailability(dateKeyStr){
  try{
    const res = await fetch(`/api/availability?date=${dateKeyStr}`);
    const data = res.ok ? await res.json() : { taken: [] };
    renderSlots(dateKeyStr, data.taken || []);
  } catch(err){
    console.error(err);
    renderSlots(dateKeyStr, []);
  } finally {
    document.getElementById('slotsLoading').style.display = 'none';
  }
}

function renderSlots(dateKeyStr, taken){
  const grid = document.getElementById('slotsGrid');
  grid.innerHTML = '';
  const now = new Date();
  const isToday = dateKeyStr === dateKey(now.getFullYear(), now.getMonth(), now.getDate());

  TIME_SLOTS.forEach(t => {
    const btn = document.createElement('div');
    btn.className = 'slot-btn';
    btn.textContent = formatTimeLabel(t);

    const isTaken = taken.includes(t);
    const [h] = t.split(':').map(Number);
    const isPastToday = isToday && h <= now.getHours();

    if (isTaken || isPastToday){
      btn.classList.add('taken');
    } else {
      btn.onclick = () => {
        selectedTime = t;
        goToStep2();
      };
    }
    grid.appendChild(btn);
  });
}

function goToStep2(){
  if (!selectedDate || !selectedTime) return;
  updateSummary();
  const sub = document.getElementById('bookSummary2');
  sub.textContent += ` — ${formatDateLabel(selectedDate)} at ${formatTimeLabel(selectedTime)}`;
  document.getElementById('bookStep1').style.display = 'none';
  document.getElementById('bookStep2').style.display = 'block';
}

function backToStep1(){
  document.getElementById('bookStep2').style.display = 'none';
  document.getElementById('bookStep1').style.display = 'block';
}

async function submitBooking(){
  const name = document.getElementById('bkName').value.trim();
  const email = document.getElementById('bkEmail').value.trim();
  const phone = document.getElementById('bkPhone').value.trim();
  const errBox = document.getElementById('bookError');
  errBox.style.display = 'none';

  if (!name || !email){
    errBox.textContent = 'Please enter your name and email.';
    errBox.style.display = 'block';
    return;
  }
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!emailOk){
    errBox.textContent = 'Please enter a valid email address.';
    errBox.style.display = 'block';
    return;
  }

  const btn = document.getElementById('confirmBookBtn');
  btn.disabled = true;
  btn.textContent = 'BOOKING…';

  try{
    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectType: document.getElementById('bookProjectType').value,
        scriptLength: document.getElementById('bookScriptLength').value,
        deliveryTime: document.getElementById('bookDeliveryTime').value,
        date: selectedDate,
        time: selectedTime,
        name, email, phone
      })
    });

    const data = await res.json();

    if (!res.ok){
      errBox.textContent = data.error || 'That slot was just taken — please pick another time.';
      errBox.style.display = 'block';
      if (res.status === 409){
        backToStep1();
        selectDate(selectedDate, document.querySelector('.cal-day.selected'));
      }
      return;
    }

    document.getElementById('bookConfirmText').textContent =
      `${formatDateLabel(selectedDate)} at ${formatTimeLabel(selectedTime)} — confirmation #${data.bookingId}. We've got your details and will follow up by email.`;
    document.getElementById('bookStep2').style.display = 'none';
    document.getElementById('bookStep3').style.display = 'block';

  } catch(err){
    console.error(err);
    errBox.textContent = 'Something went wrong submitting your booking. Please try again.';
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'CONFIRM BOOKING';
  }
}

// Close modal when clicking the dark overlay itself (not the box)
document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('bookingModal');
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeBookingModal();
  });
});
