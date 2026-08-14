/* Instant Quote modal — shared across every page.
   Injects its own markup so every page only needs:
     <script src="quote.js"></script>
   and a button with onclick="openQuoteModal()" */

const QUOTE_PRICING = {
  Commercial:  { base: 150, unit: 'project', lengths: ['Up to 60 Seconds', '60–120 Seconds', '2–5 Minutes'], multipliers: [1, 1.6, 2.5] },
  'Corporate Narration': { base: 350, unit: 'project', lengths: ['Up to 60 Seconds', '60–120 Seconds', '2–5 Minutes'], multipliers: [1, 1.6, 2.5] },
  Audiobook: { base: 120, unit: 'finished hour', lengths: ['Up to 1 Hour', '2–5 Hours', '6+ Hours'], multipliers: [1, 4, 9] },
  'Custom / Enterprise': null // no computed estimate — always "contact us"
};

const DELIVERY_MULTIPLIERS = {
  'Standard (3-5 Days)': 1,
  'Rush (24-48 Hours)': 1.25,
  'Same Day': 1.5
};

function injectQuoteModal(){
  if (document.getElementById('quoteModal')) return; // already injected

  const html = `
  <div class="modal-overlay" id="quoteModal">
    <div class="modal-box">
      <button class="modal-close" onclick="closeQuoteModal()"><i class="fa-solid fa-xmark"></i></button>

      <div id="quoteStep1">
        <h3 class="modal-title">GET AN <span>INSTANT QUOTE</span></h3>
        <div class="modal-sub">A rough estimate in seconds — final pricing is confirmed when you book.</div>

        <div class="field">
          <label>Project Type</label>
          <div class="select">
            <select id="quoteProjectType" onchange="onQuoteProjectTypeChange()">
              <option>Commercial</option>
              <option>Corporate Narration</option>
              <option>Audiobook</option>
              <option>Custom / Enterprise</option>
            </select>
            <i class="fa-solid fa-chevron-down"></i>
          </div>
        </div>

        <div class="field" id="quoteLengthField">
          <label>Script Length</label>
          <div class="select">
            <select id="quoteScriptLength"></select>
            <i class="fa-solid fa-chevron-down"></i>
          </div>
        </div>

        <div class="field" id="quoteDeliveryField">
          <label>Delivery Time</label>
          <div class="select">
            <select id="quoteDeliveryTime">
              <option>Standard (3-5 Days)</option>
              <option>Rush (24-48 Hours)</option>
              <option>Same Day</option>
            </select>
            <i class="fa-solid fa-chevron-down"></i>
          </div>
        </div>

        <button class="btn btn-orange" style="width:100%;" onclick="calculateQuote()">CALCULATE ESTIMATE</button>
      </div>

      <div id="quoteStep2" style="display:none;">
        <h3 class="modal-title">YOUR <span>ESTIMATE</span></h3>
        <div id="quoteResultBox" style="background:var(--panel-2);border:1px solid var(--border);border-radius:8px;padding:20px;text-align:center;margin-bottom:18px;">
          <div id="quoteAmount" style="font-family:'Oswald';font-size:30px;font-weight:700;color:var(--orange);"></div>
          <div id="quoteDetail" style="color:var(--muted);font-size:12.5px;margin-top:6px;"></div>
        </div>

        <div id="quoteEmailFields" style="display:none;">
          <div class="field"><label>Your Name</label><input class="input" id="quoteName" placeholder="Your name"></div>
          <div class="field"><label>Your Email</label><input class="input" id="quoteEmail" placeholder="you@example.com"></div>
          <div id="quoteEmailError" style="color:#ff6b6b;font-size:12px;margin-bottom:10px;display:none;"></div>
          <div id="quoteEmailSuccess" style="color:var(--green);font-size:12.5px;margin-bottom:10px;display:none;"><i class="fa-solid fa-circle-check"></i> Sent! We'll follow up shortly.</div>
        </div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn btn-outline" style="flex:1;" onclick="backToQuoteStep1()">BACK</button>
          <button class="btn btn-outline" style="flex:1;" id="quoteEmailToggleBtn" onclick="toggleQuoteEmailFields()">EMAIL ME THIS</button>
          <button class="btn btn-orange" style="flex:1;" onclick="goToBooking()">BOOK THIS</button>
        </div>
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);

  const overlay = document.getElementById('quoteModal');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeQuoteModal(); });

  onQuoteProjectTypeChange();
}

function openQuoteModal(){
  injectQuoteModal();
  document.getElementById('quoteStep1').style.display = 'block';
  document.getElementById('quoteStep2').style.display = 'none';
  document.getElementById('quoteModal').classList.add('open');
}

function closeQuoteModal(){
  const overlay = document.getElementById('quoteModal');
  if (overlay) overlay.classList.remove('open');
}

function onQuoteProjectTypeChange(){
  const type = document.getElementById('quoteProjectType').value;
  const config = QUOTE_PRICING[type];
  const lengthSelect = document.getElementById('quoteScriptLength');
  const lengthField = document.getElementById('quoteLengthField');
  const deliveryField = document.getElementById('quoteDeliveryField');

  if (!config){
    lengthField.style.display = 'none';
    deliveryField.style.display = 'none';
    return;
  }
  lengthField.style.display = 'block';
  deliveryField.style.display = 'block';
  lengthSelect.innerHTML = config.lengths.map(l => `<option>${l}</option>`).join('');
}

function calculateQuote(){
  const type = document.getElementById('quoteProjectType').value;
  const config = QUOTE_PRICING[type];
  const amountEl = document.getElementById('quoteAmount');
  const detailEl = document.getElementById('quoteDetail');

  document.getElementById('quoteStep1').style.display = 'none';
  document.getElementById('quoteStep2').style.display = 'block';
  document.getElementById('quoteEmailFields').style.display = 'none';
  document.getElementById('quoteEmailToggleBtn').textContent = 'EMAIL ME THIS';

  if (!config){
    amountEl.textContent = "LET'S TALK";
    detailEl.textContent = 'Custom and enterprise projects are quoted individually — reach out and we\'ll follow up fast.';
    return;
  }

  const scriptLength = document.getElementById('quoteScriptLength').value;
  const deliveryTime = document.getElementById('quoteDeliveryTime').value;
  const lengthIndex = config.lengths.indexOf(scriptLength);
  const lengthMultiplier = config.multipliers[lengthIndex] ?? 1;
  const deliveryMultiplier = DELIVERY_MULTIPLIERS[deliveryTime] ?? 1;

  const mid = config.base * lengthMultiplier * deliveryMultiplier;
  const low = Math.round(mid * 0.9 / 5) * 5;
  const high = Math.round(mid * 1.15 / 5) * 5;

  amountEl.textContent = `$${low} – $${high}`;
  detailEl.textContent = `Estimated for ${type} • ${scriptLength} • ${deliveryTime}`;
}

function backToQuoteStep1(){
  document.getElementById('quoteStep2').style.display = 'none';
  document.getElementById('quoteStep1').style.display = 'block';
}

function goToBooking(){
  closeQuoteModal();
  window.location.href = '/#book';
}

function toggleQuoteEmailFields(){
  const fields = document.getElementById('quoteEmailFields');
  const isOpen = fields.style.display === 'block';
  if (isOpen){
    sendQuoteEmail();
  } else {
    fields.style.display = 'block';
    document.getElementById('quoteEmailToggleBtn').textContent = 'SEND';
  }
}

async function sendQuoteEmail(){
  const name = document.getElementById('quoteName').value.trim();
  const email = document.getElementById('quoteEmail').value.trim();
  const errBox = document.getElementById('quoteEmailError');
  const successBox = document.getElementById('quoteEmailSuccess');
  errBox.style.display = 'none';

  if (!name || !email){
    errBox.textContent = 'Enter your name and email.';
    errBox.style.display = 'block';
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    errBox.textContent = 'Enter a valid email.';
    errBox.style.display = 'block';
    return;
  }

  const type = document.getElementById('quoteProjectType').value;
  const amount = document.getElementById('quoteAmount').textContent;
  const detail = document.getElementById('quoteDetail').textContent;
  const message = `Instant quote request — estimate shown: ${amount}. ${detail}`;

  // Formspree is a secondary notification channel — it fires alongside
  // our own backend but never determines the form's success/error state.
  submitToFormspree({ name, email, projectType: type, message, _subject: 'New instant quote request — Voice Forge Studios' });

  try{
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, projectType: type, message })
    });
    if (!res.ok) throw new Error();
    successBox.style.display = 'block';
    document.getElementById('quoteEmailToggleBtn').style.display = 'none';
  } catch(err){
    errBox.textContent = 'Something went wrong sending that — please try again.';
    errBox.style.display = 'block';
  }
}
