let allBookings = [];
let allMessages = [];

function formatDateTime(iso){
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

function formatBookingDate(dateStr, timeStr){
  const d = new Date(dateStr + 'T00:00:00');
  const dateLabel = d.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });
  const [h,m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${dateLabel} at ${h12}:${m.toString().padStart(2,'0')} ${period}`;
}

async function initAdmin(){
  try{
    const meRes = await fetch('/api/admin/me');
    if (!meRes.ok){
      window.location.href = '/admin-login';
      return;
    }
  } catch(err){
    window.location.href = '/admin-login';
    return;
  }

  document.getElementById('adminLoading').style.display = 'none';
  document.getElementById('adminContent').style.display = 'block';

  await Promise.all([loadBookings(), loadMessages()]);
}

function switchAdminTab(tab){
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('bookingsPanel').classList.toggle('active', tab === 'bookings');
  document.getElementById('messagesPanel').classList.toggle('active', tab === 'messages');
}

async function loadBookings(){
  const res = await fetch('/api/admin/bookings');
  const data = res.ok ? await res.json() : { bookings: [] };
  allBookings = data.bookings;
  document.getElementById('bookingsCount').textContent = allBookings.length;
  renderBookings();
}

function renderBookings(){
  const list = document.getElementById('bookingsList');
  if (!allBookings.length){
    list.innerHTML = `<div class="empty-state"><i class="fa-regular fa-calendar" style="font-size:26px;color:var(--muted-2);display:block;margin-bottom:10px;"></i>No bookings yet.</div>`;
    return;
  }

  list.innerHTML = allBookings.map(b => `
    <div class="data-row">
      <div class="main">
        <div class="t">${b.projectType} — ${formatBookingDate(b.date, b.time)}</div>
        <div class="sub">
          ${b.scriptLength} • ${b.deliveryTime} delivery<br>
          ${b.name} • ${b.email}${b.phone ? ' • ' + b.phone : ''}<br>
          ${formatPaymentBadge(b)}
        </div>
      </div>
      <div class="actions">
        <select class="status-select ${b.status || 'pending'}" onchange="updateBookingStatus('${b.bookingId}', this)">
          <option value="pending" ${(!b.status || b.status==='pending') ? 'selected' : ''}>Pending</option>
          <option value="confirmed" ${b.status==='confirmed' ? 'selected' : ''}>Confirmed</option>
          <option value="completed" ${b.status==='completed' ? 'selected' : ''}>Completed</option>
          <option value="cancelled" ${b.status==='cancelled' ? 'selected' : ''}>Cancelled</option>
        </select>
      </div>
      <div class="meta">#${b.bookingId}<br>${formatDateTime(b.createdAt)}</div>
    </div>
  `).join('');
}

function formatPaymentBadge(b){
  if (b.priceCents == null) {
    return `<span style="color:var(--muted-2);">Custom pricing — no online payment</span>`;
  }
  const amount = (b.priceCents / 100).toFixed(2);
  if (b.paid) {
    return `<span style="color:var(--green);"><i class="fa-solid fa-circle-check"></i> Paid $${amount}</span>`;
  }
  return `<span style="color:#ff6b6b;"><i class="fa-regular fa-clock"></i> Unpaid — $${amount} (checkout ${b.status === 'cancelled' ? 'cancelled' : 'pending/abandoned'})</span>`;
}

async function updateBookingStatus(bookingId, selectEl){
  const status = selectEl.value;
  selectEl.className = `status-select ${status}`;
  try{
    await fetch(`/api/admin/bookings/${bookingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const booking = allBookings.find(b => b.bookingId === bookingId);
    if (booking) booking.status = status;
  } catch(err){
    console.error('Failed to update booking status', err);
  }
}

async function loadMessages(){
  const res = await fetch('/api/admin/messages');
  const data = res.ok ? await res.json() : { messages: [] };
  allMessages = data.messages;
  const unreadCount = allMessages.filter(m => !m.read).length;
  document.getElementById('messagesCount').textContent = unreadCount;
  renderMessages();
}

function renderMessages(){
  const list = document.getElementById('messagesList');
  if (!allMessages.length){
    list.innerHTML = `<div class="empty-state"><i class="fa-regular fa-envelope" style="font-size:26px;color:var(--muted-2);display:block;margin-bottom:10px;"></i>No messages yet.</div>`;
    return;
  }

  list.innerHTML = allMessages.map(m => `
    <div class="data-row ${m.read ? '' : 'unread'}">
      <div class="main">
        <div class="t">${m.name} ${m.projectType ? '— ' + m.projectType : ''}</div>
        <div class="sub">
          ${m.email}${m.phone ? ' • ' + m.phone : ''}${m.company ? ' • ' + m.company : ''}
          ${m.budget ? '<br>Budget: ' + m.budget : ''}
        </div>
        ${m.message ? `<div class="msg">${m.message}</div>` : ''}
      </div>
      <div class="actions">
        <button class="mark-read-btn ${m.read ? 'is-read' : ''}" onclick="toggleMessageRead('${m.id}', this)" title="${m.read ? 'Mark unread' : 'Mark read'}">
          <i class="fa-solid ${m.read ? 'fa-check' : 'fa-envelope'}"></i>
        </button>
      </div>
      <div class="meta">${formatDateTime(m.createdAt)}</div>
    </div>
  `).join('');
}

async function toggleMessageRead(id, btnEl){
  const message = allMessages.find(m => m.id === id);
  if (!message) return;
  const newRead = !message.read;

  try{
    await fetch(`/api/admin/messages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: newRead })
    });
    message.read = newRead;
    renderMessages();
    document.getElementById('messagesCount').textContent = allMessages.filter(m => !m.read).length;
  } catch(err){
    console.error('Failed to update message', err);
  }
}

async function doAdminLogout(){
  await fetch('/api/admin/logout', { method: 'POST' });
  window.location.href = '/admin-login';
}

initAdmin();
