/* Shared Formspree helper.
   Fires a submission to Formspree alongside whatever the site's own
   backend already does — never blocks or fails the main flow if
   Formspree itself is slow, down, or rate-limited. */

const FORMSPREE_ENDPOINT = 'https://formspree.io/f/xdenabjo';

async function submitToFormspree(fields){
  try {
    await fetch(FORMSPREE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(fields)
    });
  } catch (err) {
    // Non-blocking by design — Formspree is a secondary notification
    // channel here, not the source of truth for the form's success state.
    console.warn('Formspree submission failed (non-blocking):', err);
  }
}
