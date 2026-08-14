async function doAdminLogin(){
  const password = document.getElementById('adminPassword').value;
  const errBox = document.getElementById('adminError');
  const btn = document.getElementById('adminLoginBtn');
  errBox.style.display = 'none';

  if (!password){
    errBox.textContent = 'Enter the admin password.';
    errBox.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'LOGGING IN…';

  try{
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (!res.ok){
      errBox.textContent = data.error || 'Login failed.';
      errBox.style.display = 'block';
      return;
    }
    window.location.href = '/admin';
  } catch(err){
    errBox.textContent = 'Something went wrong. Please try again.';
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'LOG IN';
  }
}
