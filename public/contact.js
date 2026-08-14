async function submitContactPage(){
  const name = document.getElementById('cpName').value.trim();
  const email = document.getElementById('cpEmail').value.trim();
  const errBox = document.getElementById('cpError');
  const successBox = document.getElementById('cpSuccess');
  const btn = document.getElementById('cpSubmitBtn');
  const label = document.getElementById('cpSubmitLabel');

  errBox.style.display = 'none';
  successBox.style.display = 'none';

  if (!name || !email){
    errBox.textContent = 'Please enter your name and email.';
    errBox.style.display = 'block';
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    errBox.textContent = 'Please enter a valid email address.';
    errBox.style.display = 'block';
    return;
  }

  btn.disabled = true;
  label.textContent = 'SENDING…';

  const payload = {
    name, email,
    company: document.getElementById('cpCompany').value.trim(),
    phone: document.getElementById('cpPhone').value.trim(),
    projectType: document.getElementById('cpProjectType').value,
    budget: document.getElementById('cpBudget').value,
    message: document.getElementById('cpMessage').value.trim()
  };

  // Formspree is a secondary notification channel — it fires alongside
  // our own backend but never determines the form's success/error state.
  submitToFormspree({ ...payload, _subject: 'New contact message — Voice Forge Studios' });

  try{
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok){
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Something went wrong. Please try again.');
    }

    successBox.style.display = 'block';
    ['cpName','cpEmail','cpCompany','cpPhone','cpMessage'].forEach(id => document.getElementById(id).value = '');
  } catch(err){
    errBox.textContent = err.message;
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    label.textContent = 'SEND MESSAGE';
  }
}
