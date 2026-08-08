// Shared across every page: checks session state and swaps the nav
// LOGIN button for a MY ACCOUNT link when the person is signed in.
(async function(){
  const btn = document.getElementById('navLoginBtn');
  if (!btn) return;

  try{
    const res = await fetch('/api/me');
    if (res.ok){
      const { user } = await res.json();
      btn.textContent = user.name.split(' ')[0].toUpperCase();
      btn.href = '/account';
      btn.title = user.email;
    }
    // If not logged in, leave the default "LOGIN" → /login link as-is.
  } catch(err){
    // Network hiccup — leave the default LOGIN link, no need to alarm anyone.
  }
})();
