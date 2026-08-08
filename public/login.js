function switchAuthTab(tab){
  document.querySelector('.auth-tabs').style.display = 'flex';
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('loginForm').classList.toggle('active', tab === 'login');
  document.getElementById('signupForm').classList.toggle('active', tab === 'signup');
  document.getElementById('forgotForm').classList.remove('active');
}

function showForgotView(){
  document.querySelector('.auth-tabs').style.display = 'none';
  document.getElementById('loginForm').classList.remove('active');
  document.getElementById('signupForm').classList.remove('active');
  document.getElementById('forgotForm').classList.add('active');
}

async function doForgotPassword(){
  const email = document.getElementById('forgotEmail').value.trim();
  const errBox = document.getElementById('forgotError');
  const successBox = document.getElementById('forgotSuccess');
  const btn = document.getElementById('forgotBtn');
  errBox.style.display = 'none';
  successBox.style.display = 'none';

  if (!email){
    errBox.textContent = 'Enter your email.';
    errBox.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'SENDING…';

  try{
    const res = await fetch('/api/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    // This endpoint always responds success (by design, so it can't be used
    // to check which emails have accounts) — just show the confirmation.
    successBox.style.display = 'block';
    document.getElementById('forgotEmail').value = '';
  } catch(err){
    errBox.textContent = 'Something went wrong. Please try again.';
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'SEND RESET LINK';
  }
}

function getRedirectTarget(){
  const params = new URLSearchParams(window.location.search);
  return params.get('redirect') || '/account';
}

async function doLogin(){
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errBox = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');
  errBox.style.display = 'none';

  if (!email || !password){
    errBox.textContent = 'Enter your email and password.';
    errBox.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'LOGGING IN…';

  try{
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok){
      errBox.textContent = data.error || 'Login failed.';
      errBox.style.display = 'block';
      return;
    }
    window.location.href = getRedirectTarget();
  } catch(err){
    errBox.textContent = 'Something went wrong. Please try again.';
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'LOG IN';
  }
}

async function doSignup(){
  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const errBox = document.getElementById('signupError');
  const btn = document.getElementById('signupBtn');
  errBox.style.display = 'none';

  if (!name || !email || !password){
    errBox.textContent = 'Fill in all fields.';
    errBox.style.display = 'block';
    return;
  }
  if (password.length < 8){
    errBox.textContent = 'Password must be at least 8 characters.';
    errBox.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'CREATING ACCOUNT…';

  try{
    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    const data = await res.json();
    if (!res.ok){
      errBox.textContent = data.error || 'Sign up failed.';
      errBox.style.display = 'block';
      return;
    }
    window.location.href = getRedirectTarget();
  } catch(err){
    errBox.textContent = 'Something went wrong. Please try again.';
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'CREATE ACCOUNT';
  }
}

// If a ?tab=signup query param is present, open that tab by default
document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('tab') === 'signup') switchAuthTab('signup');
});
