// Small, pointer-driven depth cues for the glass surfaces.
const motion = window.matchMedia('(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)');

for (const card of document.querySelectorAll('.date-controls, .map-toolbar')) {
  let frame = 0;
  let dragging = false;
  let pending;

  function reset() {
    cancelAnimationFrame(frame);
    frame = 0;
    card.classList.remove('is-tilting');
    card.style.removeProperty('--tilt-x');
    card.style.removeProperty('--tilt-y');
    card.style.removeProperty('--light-x');
    card.style.removeProperty('--light-y');
  }

  card.addEventListener('pointermove', (event) => {
    if (!motion.matches || event.pointerType !== 'mouse' || dragging || event.buttons) return;
    pending = { x: event.clientX, y: event.clientY };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      // offset geometry remains stable while the card's contents tilt.
      const rect = card.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (pending.x - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (pending.y - rect.top) / rect.height));
      card.style.setProperty('--tilt-x', `${(0.5 - y) * 5}deg`);
      card.style.setProperty('--tilt-y', `${(x - 0.5) * 5}deg`);
      card.style.setProperty('--light-x', `${x * 100}%`);
      card.style.setProperty('--light-y', `${y * 100}%`);
      card.classList.add('is-tilting');
    });
  });
  card.addEventListener('pointerdown', () => { dragging = true; reset(); });
  card.addEventListener('pointerup', () => { dragging = false; });
  card.addEventListener('pointerleave', () => { dragging = false; reset(); });
  card.addEventListener('pointercancel', () => { dragging = false; reset(); });
  motion.addEventListener('change', reset);
}
