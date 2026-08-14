function toggleMobileNav(){
  const navlinks = document.querySelector('.navlinks');
  const icon = document.querySelector('#navHamburger i');
  if (!navlinks) return;

  const isOpen = navlinks.classList.toggle('mobile-open');
  if (icon) {
    icon.classList.toggle('fa-bars', !isOpen);
    icon.classList.toggle('fa-xmark', isOpen);
  }
}

// Close the mobile menu automatically if the viewport grows past the
// mobile breakpoint (e.g. rotating a tablet, or resizing a browser window).
window.addEventListener('resize', () => {
  if (window.innerWidth > 760) {
    const navlinks = document.querySelector('.navlinks');
    const icon = document.querySelector('#navHamburger i');
    if (navlinks) navlinks.classList.remove('mobile-open');
    if (icon) { icon.classList.add('fa-bars'); icon.classList.remove('fa-xmark'); }
  }
});

// Close the menu after tapping a nav link (better UX than leaving it open
// while the new page loads).
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.navlinks a').forEach(a => {
    a.addEventListener('click', () => {
      const navlinks = document.querySelector('.navlinks');
      if (navlinks) navlinks.classList.remove('mobile-open');
    });
  });
});
