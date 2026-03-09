const revealItems = document.querySelectorAll('.reveal');
const counters = document.querySelectorAll('[data-count]');
const yearNode = document.getElementById('year');
const earlyAccessBtn = document.getElementById('early-access-btn');
const toast = document.getElementById('toast');
const header = document.querySelector('.site-header');

if (yearNode) {
  yearNode.textContent = String(new Date().getFullYear());
}

let toastTimer = null;

function showToast(message) {
  if (!toast) {
    return;
  }

  toast.textContent = message;
  toast.classList.add('visible');

  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toastTimer = setTimeout(() => {
    toast.classList.remove('visible');
  }, 1800);
}

if (earlyAccessBtn) {
  earlyAccessBtn.addEventListener('click', (event) => {
    event.preventDefault();
    showToast('Coming soon');
  });
}

let lastScrollY = window.scrollY;
let downDistance = 0;
let upDistance = 0;
const toggleDistance = 6;

function updateHeaderVisibility() {
  if (!header) {
    return;
  }

  const currentScrollY = window.scrollY;
  const delta = currentScrollY - lastScrollY;

  if (currentScrollY <= 36) {
    header.classList.remove('is-hidden');
    downDistance = 0;
    upDistance = 0;
    lastScrollY = currentScrollY;
    return;
  }

  if (delta > 0) {
    downDistance += delta;
    upDistance = 0;

    if (downDistance >= toggleDistance) {
      header.classList.add('is-hidden');
      downDistance = 0;
    }
  } else if (delta < 0) {
    upDistance += Math.abs(delta);
    downDistance = 0;

    if (upDistance >= toggleDistance) {
      header.classList.remove('is-hidden');
      upDistance = 0;
    }
  }

  lastScrollY = currentScrollY;
}

window.addEventListener('scroll', updateHeaderVisibility, { passive: true });

const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) {
        continue;
      }

      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  },
  { threshold: 0.15 },
);

for (const item of revealItems) {
  revealObserver.observe(item);
}

function animateCounter(node) {
  const target = Number.parseInt(node.dataset.count || '0', 10);
  const durationMs = 900;
  const start = performance.now();

  function step(timestamp) {
    const progress = Math.min((timestamp - start) / durationMs, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = Math.round(target * eased);
    node.textContent = String(value);

    if (progress < 1) {
      requestAnimationFrame(step);
    }
  }

  requestAnimationFrame(step);
}

const statObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) {
        continue;
      }

      animateCounter(entry.target);
      statObserver.unobserve(entry.target);
    }
  },
  { threshold: 0.7 },
);

for (const counter of counters) {
  statObserver.observe(counter);
}

const blobs = document.querySelectorAll('.blob');
window.addEventListener('pointermove', (event) => {
  const xShift = (event.clientX / window.innerWidth - 0.5) * 14;
  const yShift = (event.clientY / window.innerHeight - 0.5) * 14;

  blobs.forEach((blob, index) => {
    const factor = (index + 1) * 0.6;
    blob.style.transform = `translate(${xShift * factor}px, ${yShift * factor}px)`;
  });
});
