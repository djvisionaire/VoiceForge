function formatDateLabel(dateStr){
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric', year:'numeric' });
}

function formatTimeLabel(t){
  const [h,m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2,'0')} ${period}`;
}

async function loadAccount(){
  try{
    const meRes = await fetch('/api/me');
    if (!meRes.ok){
      window.location.href = '/login?redirect=/account';
      return;
    }
    const { user } = await meRes.json();
    document.getElementById('accountEmailLine').textContent = `Signed in as ${user.name} (${user.email})`;

    const bkRes = await fetch('/api/my-bookings');
    const { bookings } = bkRes.ok ? await bkRes.json() : { bookings: [] };

    const list = document.getElementById('bookingsList');
    if (!bookings.length){
      list.innerHTML = `
        <div class="empty-state">
          <i class="fa-regular fa-calendar"></i>
          No bookings yet.<br>
          <a href="/#book" style="color:var(--orange-2);">Book your first session →</a>
        </div>`;
    } else {
      list.innerHTML = bookings
        .sort((a,b) => (a.date + a.time).localeCompare(b.date + b.time))
        .map(b => `
          <div class="booking-row">
            <div>
              <div class="bk-main">${b.projectType} — ${formatDateLabel(b.date)} at ${formatTimeLabel(b.time)}</div>
              <div class="bk-sub">${b.scriptLength} • ${b.deliveryTime} delivery</div>
            </div>
            <div class="bk-id">#${b.bookingId}</div>
          </div>
        `).join('');
    }

    document.getElementById('accountLoading').style.display = 'none';
    document.getElementById('accountContent').style.display = 'block';
  } catch(err){
    console.error(err);
    document.getElementById('accountLoading').textContent = 'Something went wrong loading your account.';
  }
}

async function doLogout(){
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
}

loadAccount();
