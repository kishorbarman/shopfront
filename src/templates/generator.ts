import type { Hour, MessageLog, Notice, Service, Shop } from '@prisma/client';
import config from '../config';

type ShopPageData = Shop & {
  services: Service[];
  hours: Hour[];
  notices: Notice[];
  logs?: MessageLog[];
};

type TemplateKind = 'services' | 'menu';

type Palette = {
  accent: string;
  accentSoft: string;
  accentText: string;
};

type ThemeKey = 'barber' | 'restaurant' | 'salon' | 'auto' | 'fitness' | 'clinic' | 'retail' | 'general';

type ThemeProfile = Palette & {
  key: ThemeKey;
  bgTop: string;
  bgBottom: string;
  heroStart: string;
  heroEnd: string;
  motifLabel: string;
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function formatCategory(category: string): string {
  return titleCase(category || 'General');
}

function formatPrice(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '$0';
  }
  return numeric % 1 === 0 ? `$${numeric.toFixed(0)}` : `$${numeric.toFixed(2)}`;
}

function formatHourLabel(hour: Hour): string {
  if (hour.isClosed) {
    return 'Closed';
  }
  return `${hour.openTime} - ${hour.closeTime}`;
}

function getThemeKey(category: string): ThemeKey {
  const lower = category.toLowerCase();

  if (lower.includes('barber')) {
    return 'barber';
  }

  if (lower.includes('restaurant') || lower.includes('food') || lower.includes('bakery')) {
    return 'restaurant';
  }

  if (lower.includes('salon')) {
    return 'salon';
  }

  if (lower.includes('auto') || lower.includes('mechanic') || lower.includes('repair')) {
    return 'auto';
  }

  if (lower.includes('gym') || lower.includes('fitness') || lower.includes('trainer')) {
    return 'fitness';
  }

  if (lower.includes('clinic') || lower.includes('doctor') || lower.includes('dental') || lower.includes('medical')) {
    return 'clinic';
  }

  if (lower.includes('store') || lower.includes('shop') || lower.includes('retail')) {
    return 'retail';
  }

  return 'general';
}

function getThemeProfile(category: string): ThemeProfile {
  const key = getThemeKey(category);

  if (key === 'barber') {
    return {
      key,
      accent: '#0b4b3a',
      accentSoft: '#efe8c4',
      accentText: '#0b4b3a',
      bgTop: '#eef8f3',
      bgBottom: '#f5f4ea',
      heroStart: '#0b4b3a',
      heroEnd: '#7ea598',
      motifLabel: 'Classic Cuts and Grooming',
    };
  }

  if (key === 'restaurant') {
    return {
      key,
      accent: '#8f2f1f',
      accentSoft: '#f4e1d1',
      accentText: '#6e2418',
      bgTop: '#fff5ef',
      bgBottom: '#f8efe7',
      heroStart: '#8f2f1f',
      heroEnd: '#d29563',
      motifLabel: 'Fresh Menu and Daily Specials',
    };
  }

  if (key === 'salon') {
    return {
      key,
      accent: '#7a4fa0',
      accentSoft: '#f1e6fb',
      accentText: '#5a3a79',
      bgTop: '#faf3ff',
      bgBottom: '#f4edf8',
      heroStart: '#7a4fa0',
      heroEnd: '#c69fdf',
      motifLabel: 'Beauty, Style, and Self-Care',
    };
  }

  if (key === 'auto') {
    return {
      key,
      accent: '#164e63',
      accentSoft: '#dff2f8',
      accentText: '#0e3b4a',
      bgTop: '#eff8fb',
      bgBottom: '#edf2f6',
      heroStart: '#164e63',
      heroEnd: '#6795a7',
      motifLabel: 'Reliable Repairs and Service',
    };
  }

  if (key === 'fitness') {
    return {
      key,
      accent: '#6d28d9',
      accentSoft: '#ede9fe',
      accentText: '#4c1d95',
      bgTop: '#f4f1ff',
      bgBottom: '#f1eef9',
      heroStart: '#6d28d9',
      heroEnd: '#9f7aea',
      motifLabel: 'Training, Strength, and Wellness',
    };
  }

  if (key === 'clinic') {
    return {
      key,
      accent: '#0f766e',
      accentSoft: '#dcf4ef',
      accentText: '#0b5d57',
      bgTop: '#eefcf9',
      bgBottom: '#edf5f3',
      heroStart: '#0f766e',
      heroEnd: '#6bb8ae',
      motifLabel: 'Trusted Care and Appointments',
    };
  }

  if (key === 'retail') {
    return {
      key,
      accent: '#7c3f00',
      accentSoft: '#f9ead9',
      accentText: '#633100',
      bgTop: '#fff8ef',
      bgBottom: '#f5efe5',
      heroStart: '#7c3f00',
      heroEnd: '#c08457',
      motifLabel: 'Products, Offers, and Store Hours',
    };
  }

  return {
    key: 'general',
    accent: '#21527d',
    accentSoft: '#e6edf5',
    accentText: '#1b4060',
    bgTop: '#f1f6fb',
    bgBottom: '#eef3f8',
    heroStart: '#21527d',
    heroEnd: '#7294b5',
    motifLabel: 'Services and Hours at a Glance',
  };
}

function getTemplateKind(category: string): TemplateKind {
  const theme = getThemeKey(category);
  if (theme === 'restaurant') {
    return 'menu';
  }
  return 'services';
}

function heroIconSvg(theme: ThemeKey): string {
  if (theme === 'barber') {
    return `<g stroke="#ffffff" stroke-width="8" stroke-linecap="round" fill="none">
      <circle cx="290" cy="148" r="12" />
      <circle cx="350" cy="148" r="12" />
      <line x1="300" y1="136" x2="340" y2="166" />
      <line x1="300" y1="166" x2="340" y2="136" />
    </g>`;
  }

  if (theme === 'restaurant') {
    return `<g fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round">
      <line x1="296" y1="120" x2="296" y2="176" />
      <line x1="284" y1="120" x2="284" y2="145" />
      <line x1="308" y1="120" x2="308" y2="145" />
      <line x1="344" y1="120" x2="336" y2="176" />
      <path d="M336 120 C352 122 352 145 336 148" />
    </g>`;
  }

  if (theme === 'salon') {
    return `<g fill="#ffffff">
      <polygon points="320,116 331,141 358,144 338,162 343,188 320,174 297,188 302,162 282,144 309,141" />
    </g>`;
  }

  if (theme === 'auto') {
    return `<g fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round">
      <circle cx="320" cy="152" r="26" />
      <line x1="320" y1="118" x2="320" y2="186" />
      <line x1="286" y1="152" x2="354" y2="152" />
      <line x1="296" y1="128" x2="344" y2="176" />
      <line x1="344" y1="128" x2="296" y2="176" />
    </g>`;
  }

  if (theme === 'fitness') {
    return `<g fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round">
      <line x1="284" y1="152" x2="356" y2="152" />
      <rect x="264" y="136" width="14" height="32" rx="2" />
      <rect x="278" y="142" width="8" height="20" rx="1" />
      <rect x="354" y="142" width="8" height="20" rx="1" />
      <rect x="362" y="136" width="14" height="32" rx="2" />
    </g>`;
  }

  if (theme === 'clinic') {
    return `<g fill="#ffffff">
      <rect x="308" y="120" width="24" height="64" rx="4" />
      <rect x="288" y="140" width="64" height="24" rx="4" />
    </g>`;
  }

  if (theme === 'retail') {
    return `<g fill="none" stroke="#ffffff" stroke-width="8" stroke-linejoin="round">
      <rect x="284" y="138" width="72" height="48" rx="4" />
      <line x1="284" y1="138" x2="294" y2="120" />
      <line x1="356" y1="138" x2="346" y2="120" />
      <line x1="294" y1="120" x2="346" y2="120" />
    </g>`;
  }

  return `<g fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round">
    <rect x="290" y="128" width="60" height="48" rx="8" />
    <line x1="308" y1="176" x2="308" y2="194" />
    <line x1="332" y1="176" x2="332" y2="194" />
  </g>`;
}

function heroFallbackMarkup(theme: ThemeProfile): string {
  return `<div class="hero-fallback" aria-hidden="true">
    <svg class="hero-art" viewBox="0 0 640 300" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="heroGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${theme.heroStart}" />
          <stop offset="100%" stop-color="${theme.heroEnd}" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="640" height="300" fill="url(#heroGradient)" />
      <circle cx="150" cy="90" r="84" fill="#ffffff22" />
      <circle cx="540" cy="220" r="120" fill="#ffffff1a" />
      <circle cx="320" cy="150" r="62" fill="#ffffff1f" />
      ${heroIconSvg(theme.key)}
    </svg>
    <div class="hero-motif">${escapeHtml(theme.motifLabel)}</div>
  </div>`;
}

function topServicesDescription(services: Service[]): string {

  const names = services.slice(0, 3).map((service) => service.name);
  if (names.length === 0) {
    return 'Browse services and opening hours.';
  }

  return `Top services: ${names.join(', ')}.`;
}

function hasUsableAddress(address: string | null | undefined): address is string {
  const value = address?.trim();
  if (!value) {
    return false;
  }

  return !/^(address coming soon|address not provided)$/i.test(value);
}

function noticesMarkup(notices: Notice[]): string {
  if (notices.length === 0) {
    return '';
  }

  const items = notices
    .map((notice) => {
      const kind = notice.type.toLowerCase();
      return `<div class="notice notice-${kind}">${escapeHtml(notice.message)}</div>`;
    })
    .join('');

  return `<section class="section notices" aria-label="Notices">${items}</section>`;
}

function servicesMarkup(services: Service[], template: TemplateKind): string {
  if (services.length === 0) {
    return '<p class="empty">No services listed yet.</p>';
  }

  if (template === 'menu') {
    return `<div class="menu-grid">${services
      .map(
        (service) => `
      <article class="menu-item">
        <div class="menu-top">
          <h3>${escapeHtml(service.name)}</h3>
          <strong>${formatPrice(service.price)}</strong>
        </div>
        ${service.description ? `<p>${escapeHtml(service.description)}</p>` : ''}
      </article>`,
      )
      .join('')}</div>`;
  }

  return `<ul class="service-list">${services
    .map(
      (service) => `
    <li>
      <div class="service-row">
        <h3>${escapeHtml(service.name)}</h3>
        <strong>${formatPrice(service.price)}</strong>
      </div>
      ${service.description ? `<p>${escapeHtml(service.description)}</p>` : ''}
    </li>`,
    )
    .join('')}</ul>`;
}

function hoursMarkup(hours: Hour[]): string {
  if (hours.length === 0) {
    return '<p class="empty">Hours not available.</p>';
  }

  const today = new Date().getDay();
  const ordered = [...hours].sort((a, b) => a.dayOfWeek - b.dayOfWeek);

  return `<table class="hours-table"><tbody>${ordered
    .map((hour) => {
      const isToday = hour.dayOfWeek === today;
      return `<tr class="${isToday ? 'today' : ''}">
        <th>${DAY_NAMES[hour.dayOfWeek] ?? `Day ${hour.dayOfWeek}`}</th>
        <td class="${hour.isClosed ? 'closed' : ''}">${formatHourLabel(hour)}</td>
      </tr>`;
    })
    .join('')}</tbody></table>`;
}



function formatLogTimestamp(value: Date): string {
  const iso = new Date(value).toISOString();
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}

function trimForLog(value: string, limit = 180): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit - 1)}...`;
}

function logsMarkup(logs: MessageLog[] | undefined): string {
  const items = logs ?? [];

  if (items.length === 0) {
    return '<section class="section" aria-label="Logs"><details class="logs-disclosure"><summary>Logs <span class="logs-hint">Expand</span></summary><p class="empty">No message history yet.</p></details></section>';
  }

  const rows = items
    .map((log) => {
      const outcome = log.status === 'FAILED' ? 'Failed' : log.updateApplied ? 'Updated' : 'No update';
      const parsed = log.parsedIntent ?? 'unknown';
      const detail = log.parsedSummary ?? log.errorMessage ?? log.responseText ?? '';

      return `<article class="log-item">
        <div class="log-head">
          <strong>${escapeHtml(formatLogTimestamp(log.createdAt))}</strong>
          <span class="log-outcome ${log.status === 'FAILED' ? 'log-failed' : log.updateApplied ? 'log-updated' : 'log-neutral'}">${outcome}</span>
        </div>
        <p class="log-line"><span>Text:</span> ${escapeHtml(trimForLog(log.inboundText || '(empty)'))}</p>
        <p class="log-line"><span>Parsed:</span> ${escapeHtml(parsed)}</p>
        ${detail ? `<p class="log-line"><span>Detail:</span> ${escapeHtml(trimForLog(detail))}</p>` : ''}
      </article>`;
    })
    .join('');

  return `<section class="section" aria-label="Logs"><details class="logs-disclosure"><summary>Logs <span class="logs-hint">Expand</span></summary><div class="logs-list">${rows}</div></details></section>`;
}
function shopUrl(shop: Shop): string {
  const baseUrl = config.BASE_URL || 'http://localhost:3000';
  const root = baseUrl.replace(/\/$/, '');
  return `${root}/s/${encodeURIComponent(shop.slug)}`;
}

function safeJsonLd(input: object): string {
  return JSON.stringify(input).replace(/</g, '\\u003c');
}

export async function generateShopPage(shop: ShopPageData): Promise<string> {
  const theme = getThemeProfile(shop.category);
  const templateKind = getTemplateKind(shop.category);
  const categoryLabel = formatCategory(shop.category);
  const desc = `${shop.name} is a ${categoryLabel.toLowerCase()} business. ${topServicesDescription(shop.services)}`;
  const ogImage = shop.photoUrl || `${config.BASE_URL || 'http://localhost:3000'}/public/default-og.png`;
  const displayAddress = shop.address?.trim() || 'Address not provided';
  const mapsSearchTarget = hasUsableAddress(shop.address) ? shop.address.trim() : shop.name;
  const mapsQuery = encodeURIComponent(mapsSearchTarget);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: shop.name,
    telephone: shop.phone,
    address: hasUsableAddress(shop.address) ? shop.address.trim() : undefined,
    image: shop.photoUrl || undefined,
    url: shopUrl(shop),
    openingHoursSpecification: shop.hours.map((hour) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: DAY_NAMES[hour.dayOfWeek] ?? 'Monday',
      opens: hour.isClosed ? undefined : hour.openTime,
      closes: hour.isClosed ? undefined : hour.closeTime,
    })),
  };

  const heroImage = shop.photoUrl
    ? `<img class="hero-image" src="${escapeHtml(shop.photoUrl)}" alt="${escapeHtml(shop.name)} banner" />`
    : heroFallbackMarkup(theme);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(shop.name)} - ${escapeHtml(categoryLabel)} | Services &amp; Hours</title>
  <meta name="description" content="${escapeHtml(desc)}" />
  <meta property="og:title" content="${escapeHtml(shop.name)} - ${escapeHtml(categoryLabel)}" />
  <meta property="og:description" content="${escapeHtml(desc)}" />
  <meta property="og:image" content="${escapeHtml(ogImage)}" />
  <meta property="og:url" content="${escapeHtml(shopUrl(shop))}" />
  <meta property="og:type" content="website" />
  <script type="application/ld+json">${safeJsonLd(jsonLd)}</script>
  <style>
    :root {
      --accent: ${theme.accent};
      --accent-soft: ${theme.accentSoft};
      --accent-text: ${theme.accentText};
      --bg-top: ${theme.bgTop};
      --bg-bottom: ${theme.bgBottom};
      --text: #1d252d;
      --muted: #576373;
      --card: #ffffff;
      --line: #d8dee6;
      --warn: #ffd66b;
      --danger: #d94b41;
      --info: #85bbff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: radial-gradient(circle at 10% 0%, #ffffff 0%, var(--bg-top) 48%, var(--bg-bottom) 100%);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.45;
    }
    .page {
      max-width: 860px;
      margin: 0 auto;
      padding: 0 14px 28px;
    }
    .hero {
      margin-top: 12px;
      border-radius: 18px;
      overflow: hidden;
      background: var(--card);
      box-shadow: 0 10px 24px rgba(16, 32, 48, 0.08);
      border: 1px solid var(--line);
    }
    .hero-image, .hero-fallback {
      width: 100%;
      display: block;
      min-height: 180px;
      max-height: 300px;
      object-fit: cover;
    }
    .hero-fallback {
      position: relative;
      background: linear-gradient(120deg, ${theme.heroStart}, ${theme.heroEnd});
    }
    .hero-art {
      width: 100%;
      height: 220px;
      display: block;
      object-fit: cover;
    }
    .hero-motif {
      position: absolute;
      left: 14px;
      bottom: 12px;
      display: inline-block;
      padding: 7px 11px;
      border-radius: 999px;
      background: #ffffffd9;
      color: var(--accent-text);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.01em;
    }
    .hero-content {
      padding: 14px;
    }
    .badge {
      display: inline-block;
      background: var(--accent-soft);
      color: var(--accent-text);
      border: 1px solid color-mix(in srgb, var(--accent) 40%, #fff 60%);
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    h1 {
      margin: 10px 0 0;
      font-size: 30px;
      line-height: 1.1;
    }
    .section {
      margin-top: 14px;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 14px;
      box-shadow: 0 4px 14px #00000005;
    }
    .section h2 {
      margin: 0 0 10px;
      font-size: 19px;
    }
    .notices {
      display: grid;
      gap: 8px;
      background: transparent;
      border: 0;
      padding: 0;
    }
    .notice {
      padding: 10px 12px;
      border-radius: 12px;
      font-weight: 600;
      border: 1px solid transparent;
    }
    .notice-info { background: color-mix(in srgb, var(--info) 24%, #fff 76%); border-color: var(--info); }
    .notice-warning { background: color-mix(in srgb, var(--warn) 32%, #fff 68%); border-color: var(--warn); }
    .notice-closure { background: color-mix(in srgb, var(--danger) 20%, #fff 80%); border-color: var(--danger); }
    .service-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
    .service-list li { border-bottom: 1px dashed var(--line); padding-bottom: 10px; }
    .service-list li:last-child { border-bottom: 0; padding-bottom: 0; }
    .service-row, .menu-top {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
    }
    .service-row h3, .menu-top h3 { margin: 0; font-size: 17px; }
    .service-row strong, .menu-top strong { color: var(--accent); font-size: 18px; }
    .service-list p, .menu-item p { margin: 5px 0 0; color: var(--muted); font-size: 14px; }
    .menu-grid { display: grid; gap: 10px; }
    .menu-item {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px;
      background: #fff;
    }
    .hours-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 15px;
    }
    .hours-table th, .hours-table td {
      text-align: left;
      padding: 9px 6px;
      border-bottom: 1px solid var(--line);
    }
    .hours-table tr.today th, .hours-table tr.today td { background: var(--accent-soft); }
    .hours-table td.closed { color: var(--danger); font-weight: 700; }
    .contact-actions {
      display: grid;
      gap: 10px;
      grid-template-columns: 1fr;
    }
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 48px;
      border-radius: 12px;
      text-decoration: none;
      font-weight: 700;
      border: 1px solid var(--line);
      color: var(--text);
      background: #fff;
    }
    .button-primary {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }
    .location a {
      color: var(--accent);
      text-decoration: none;
      font-weight: 700;
      display: inline-block;
      margin-top: 6px;
      padding: 10px 0;
      min-height: 44px;
    }
    .footer {
      text-align: center;
      color: var(--muted);
      padding: 16px 6px 0;
      font-size: 13px;
    }

    .logs-disclosure {
      border: 1px solid var(--line);
      border-radius: 14px;
      background: #fff;
      padding: 0;
    }
    .logs-disclosure > summary {
      list-style: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 14px 14px;
      font-weight: 800;
      font-size: 20px;
      color: var(--text);
    }
    .logs-disclosure > summary::-webkit-details-marker { display: none; }
    .logs-hint {
      font-size: 12px;
      font-weight: 700;
      color: var(--muted);
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 3px 8px;
    }
    .logs-disclosure[open] > summary { border-bottom: 1px solid var(--line); }
    .logs-disclosure > .logs-list,
    .logs-disclosure > .empty { padding: 12px 14px 14px; }
    .logs-list { display: grid; gap: 10px; }
    .log-item {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px;
      background: #fff;
    }
    .log-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }
    .log-head strong { font-size: 13px; color: var(--muted); }
    .log-outcome {
      font-size: 12px;
      border-radius: 999px;
      padding: 4px 8px;
      font-weight: 700;
      border: 1px solid var(--line);
      background: #f3f5f7;
      color: var(--muted);
    }
    .log-updated { color: #0b4b3a; background: #e5f4ef; border-color: #b8e0d2; }
    .log-failed { color: #8b1f18; background: #fdebea; border-color: #f2c7c5; }
    .log-neutral { color: #444f5c; background: #eef2f6; border-color: #d7dfe7; }
    .log-line {
      margin: 6px 0 0;
      font-size: 14px;
      color: var(--text);
      overflow-wrap: anywhere;
    }
    .log-line span { color: var(--muted); font-weight: 700; }
    .empty { margin: 0; color: var(--muted); }
    @media (min-width: 720px) {
      .page { padding: 0 20px 34px; }
      .hero-content { padding: 18px; }
      .contact-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .menu-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <main class="page">
    <header class="hero">
      ${heroImage}
      <div class="hero-content">
        <span class="badge">${escapeHtml(categoryLabel)}</span>
        <h1>${escapeHtml(shop.name)}</h1>
      </div>
    </header>

    ${noticesMarkup(shop.notices)}

    <section class="section" aria-label="Services">
      <h2>${templateKind === 'menu' ? 'Menu' : 'Services'}</h2>
      ${servicesMarkup(shop.services, templateKind)}
    </section>

    <section class="section" aria-label="Hours">
      <h2>Hours</h2>
      ${hoursMarkup(shop.hours)}
    </section>

    <section class="section location" aria-label="Location">
      <h2>Location</h2>
      <p>${escapeHtml(displayAddress)}</p>
      <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
    </section>

    <section class="section" aria-label="Contact">
      <h2>Contact</h2>
      <div class="contact-actions">
        <a class="button button-primary" href="tel:${escapeHtml(shop.phone)}">Call ${escapeHtml(shop.phone)}</a>
        <a class="button" href="sms:${escapeHtml(shop.phone)}">Text ${escapeHtml(shop.phone)}</a>
      </div>
    </section>

    ${logsMarkup(shop.logs)}

    <footer class="footer">Powered by Shopfront</footer>
  </main>
</body>
</html>`;
}
