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

function getPalette(category: string): Palette {
  const lower = category.toLowerCase();

  if (lower.includes('barber')) {
    return { accent: '#0b4b3a', accentSoft: '#efe8c4', accentText: '#0b4b3a' };
  }

  if (lower.includes('restaurant') || lower.includes('food') || lower.includes('bakery')) {
    return { accent: '#8f2f1f', accentSoft: '#f4e1d1', accentText: '#6e2418' };
  }

  if (lower.includes('salon')) {
    return { accent: '#7a4fa0', accentSoft: '#f1e6fb', accentText: '#5a3a79' };
  }

  return { accent: '#21527d', accentSoft: '#e6edf5', accentText: '#1b4060' };
}

function getTemplateKind(category: string): TemplateKind {
  const lower = category.toLowerCase();
  if (lower.includes('restaurant') || lower.includes('food') || lower.includes('bakery')) {
    return 'menu';
  }
  return 'services';
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
    return `<section class="section" aria-label="Logs"><h2>Logs</h2><p class="empty">No message history yet.</p></section>`;
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

  return `<section class="section" aria-label="Logs"><h2>Logs</h2><div class="logs-list">${rows}</div></section>`;
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
  const palette = getPalette(shop.category);
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
    : `<div class="hero-fallback" aria-hidden="true"></div>`;

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
      --accent: ${palette.accent};
      --accent-soft: ${palette.accentSoft};
      --accent-text: ${palette.accentText};
      --bg: #f6f7f8;
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
      background: linear-gradient(180deg, #ffffff, var(--bg));
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
      background: linear-gradient(120deg, var(--accent), #ffffff 130%);
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
