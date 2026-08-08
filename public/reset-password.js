function getParams(){
  const params = new URLSearchParams(window.location.search);
  return { email: params.get('email'), token: params.get('token') };
}

document.addEventListener('DOMContentLoaded', () => {
  const { email, token } = getParams();
  if (!email || !token){
    document.getElementById('resetFormWrap').style.display = 'none';
    document.getElementById('resetInvalidWrap').style.display = 'block';
  }
});

async function doResetPassword(){
  const { email, token } = getParams();
  const password = document.getElementById('newPassword').value;
  const confirm = document.getElementById('confirmPassword').value;
  const errBox = document.getElementById('resetError');
  const btn = document.getElementById('resetBtn');
  errBox.style.display = 'none';

  if (!password || !confirm){
    errBox.textContent = 'Please fill in both fields.';
    errBox.style.display = 'block';
    return;
  }
  if (password.length < 8){
    errBox.textContent = 'Password must be at least 8 characters.';
    errBox.style.display = 'block';
    return;
  }
  if (password !== confirm){
    errBox.textContent = 'Passwords do not match.';
    errBox.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'RESETTING…';

  try{
    const res = await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, token, password })
    });
    const data = await res.json();

    if (!res.ok){
      if (res.status === 400 && /invalid|expired/i.test(data.error || '')){
        document.getElementById('resetFormWrap').style.display = 'none';
        document.getElementById('resetInvalidWrap').style.display = 'block';
        return;
      }
      errBox.textContent = data.error || 'Something went wrong. Please try again.';
      errBox.style.display = 'block';
      return;
    }

    document.getElementById('resetFormWrap').style.display = 'none';
    document.getElementById('resetSuccessWrap').style.display = 'block';
  } catch(err){
    errBox.textContent = 'Something went wrong. Please try again.';
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'RESET PASSWORD';
  }
}
