// ============================================
// ANALYTICS HUB MODULE — Dashboard analytics panels
// ============================================
// Four modules:
//   1. Gallery Engagement (dwell time, interactions)
//   2. Traffic Analytics  (visits, sources, devices)
//   3. Shop Performance   (impressions vs conversions)
//   4. User Journey        (funnel + Sankey flow)
// ============================================

import { Trace, ctx, setHidden, escHTML } from './utils.js';

export function initAnalytics() {
  Trace.log('ANALYTICS_INIT');

  // ---- DOM refs ----
  const section     = document.getElementById('analyticsSection');
  const periodSelect = document.getElementById('analyticsPeriod');
  const refreshBtn  = document.getElementById('analyticsRefreshBtn');
  const clearBtn    = document.getElementById('analyticsClearBtn');
  const message     = document.getElementById('analyticsMessage');

  // Gallery
  const galleryPanel = document.getElementById('analyticsGalleryPanel');
  // Traffic
  const trafficPanel = document.getElementById('analyticsTrafficPanel');
  // Shop
  const shopPanel    = document.getElementById('analyticsShopPanel');
  // Journey
  const journeyPanel = document.getElementById('analyticsJourneyPanel');

  // Tabs
  const tabButtons = document.querySelectorAll('[data-analytics-tab]');
  const panels     = document.querySelectorAll('[data-analytics-panel]');

  let loaded = false;
  let loading = false;

  // ---- Tab switching ----
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.analyticsTab;
      tabButtons.forEach(b => {
        b.classList.toggle('active', b.dataset.analyticsTab === target);
        b.setAttribute('aria-selected', b.dataset.analyticsTab === target ? 'true' : 'false');
      });
      panels.forEach(p => {
        p.classList.toggle('active', p.dataset.analyticsPanel === target);
      });
    });
  });

  // ---- Period ----
  function getPeriod() {
    return parseInt(periodSelect ? periodSelect.value : 30, 10);
  }
  function periodLabel(days) {
    return days > 0 ? days + 'd' : 'All Time';
  }

  // ---- Message helper ----
  function showMsg(text, isError) {
    if (!message) return;
    message.textContent = text;
    message.className = 'gallery-msg analytics-msg ' + (isError ? 'error' : 'success');
    setHidden(message, false);
    if (!isError) setTimeout(() => setHidden(message, true), 4000);
  }

  // ---- Number formatting helpers ----
  function fmt(n) {
    return Number(n || 0).toLocaleString();
  }
  function fmtPct(n) {
    const v = Number(n || 0);
    return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  }
  function fmtDuration(ms) {
    const s = Math.ceil((ms || 0) / 1000);
    if (s < 60) return s + 's';
    return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  }

  // ---- SVG Bar Chart helper ----
  function renderBarChart(items, labelKey, valueKey, options = {}) {
    if (!items || items.length === 0) {
      return '<p class="text-muted-2 text-xs analytics-empty">No data for this period</p>';
    }

    const maxVal = Math.max(...items.map(i => Number(i[valueKey]) || 0), 1);
    const barColor = options.color || 'var(--color-primary)';
    const suffix = options.suffix || '';
    const secondaryKey = options.secondaryKey;
    const secondarySuffix = options.secondarySuffix || '';
    const secondaryFmt = options.secondaryFmt || null;

    let html = '<div class="analytics-bar-chart">';
    items.forEach((item, idx) => {
      const val = Number(item[valueKey]) || 0;
      const pct = Math.round((val / maxVal) * 100);
      const label = escHTML(String(item[labelKey] || 'Unknown'));
      const rank = idx + 1;

      let secondary = '';
      if (secondaryKey && item[secondaryKey] !== undefined) {
        const secVal = secondaryFmt ? secondaryFmt(item[secondaryKey]) : String(item[secondaryKey]);
        secondary = ' <span class="analytics-bar-secondary">' +
          escHTML(secVal) + secondarySuffix + '</span>';
      }

      html += '<div class="analytics-bar-row">' +
        '<div class="analytics-bar-label">' +
          '<span class="analytics-bar-rank">' + rank + '.</span> ' + label +
        '</div>' +
        '<div class="analytics-bar-track">' +
          '<div class="analytics-bar-fill" style="width:' + pct + '%;background:' + barColor + '"></div>' +
        '</div>' +
        '<div class="analytics-bar-value">' + fmt(val) + suffix + secondary + '</div>' +
      '</div>';
    });
    html += '</div>';
    return html;
  }

  // ---- Horizontal metric cards ----
  function renderMetricCards(metrics) {
    let html = '<div class="analytics-metrics">';
    metrics.forEach(m => {
      const trendClass = m.trend > 0 ? 'up' : m.trend < 0 ? 'down' : '';
      const trendIcon = m.trend > 0 ? '↑' : m.trend < 0 ? '↓' : '';
      html += '<div class="analytics-metric-card">' +
        '<div class="analytics-metric-value">' + escHTML(String(m.value)) + '</div>' +
        '<div class="analytics-metric-label">' + escHTML(m.label) + '</div>' +
        (m.trend !== undefined ? '<div class="analytics-metric-trend ' + trendClass + '">' + trendIcon + ' ' + fmtPct(m.trend) + '</div>' : '') +
      '</div>';
    });
    html += '</div>';
    return html;
  }

  // ---- Sparkline (mini SVG line chart) ----
  function renderSparkline(dailyData, valueKey, options = {}) {
    if (!dailyData || dailyData.length === 0) return '';

    const width = options.width || 500;
    const height = options.height || 80;
    const padding = 4;
    const values = dailyData.map(d => Number(d[valueKey]) || 0);
    const maxVal = Math.max(...values, 1);
    const minVal = 0;
    const range = maxVal - minVal || 1;

    const points = values.map((v, i) => {
      const x = padding + (i / Math.max(values.length - 1, 1)) * (width - padding * 2);
      const y = height - padding - ((v - minVal) / range) * (height - padding * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });

    const polyline = points.join(' ');

    // Fill area
    const fillPoints = points.join(' ') + ' ' +
      (width - padding).toFixed(1) + ',' + (height - padding).toFixed(1) + ' ' +
      padding.toFixed(1) + ',' + (height - padding).toFixed(1);

    return '<svg class="analytics-sparkline" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none">' +
      '<polygon points="' + fillPoints + '" fill="var(--color-primary)" opacity="0.08"/>' +
      '<polyline points="' + polyline + '" fill="none" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
  }

  // ---- Sankey / Flow Diagram (CSS-based) ----
  function renderFunnel(funnelData) {
    if (!funnelData || funnelData.length === 0) {
      return '<p class="text-muted-2 text-xs analytics-empty">No journey data for this period</p>';
    }

    const maxSessions = Math.max(...funnelData.map(f => Number(f.sessions) || 0), 1);

    const stepLabels = {
      landing: 'Landing',
      gallery: 'Gallery',
      shop: 'Shop',
      reviews: 'Reviews',
      about: 'About',
      contact: 'Contact',
      etsy_click: 'Etsy Click'
    };

    let html = '<div class="analytics-funnel">';
    funnelData.forEach(step => {
      const sessions = Number(step.sessions) || 0;
      const pct = Number(step.pct) || 0;
      const widthPct = Math.max(Math.round((sessions / maxSessions) * 100), 8);
      const label = stepLabels[step.step] || escHTML(step.step);

      html += '<div class="analytics-funnel-step">' +
        '<div class="analytics-funnel-label">' + label + '</div>' +
        '<div class="analytics-funnel-bar-track">' +
          '<div class="analytics-funnel-bar" style="width:' + widthPct + '%"></div>' +
        '</div>' +
        '<div class="analytics-funnel-value">' + fmt(sessions) + ' <span class="text-muted-2">(' + pct.toFixed(1) + '%)</span></div>' +
      '</div>';
    });
    html += '</div>';
    return html;
  }

  // ---- Flow Diagram (Sankey-like) ----
  function renderFlow(flowData) {
    if (!flowData || flowData.length === 0) return '';

    const maxCount = Math.max(...flowData.map(f => Number(f.count) || 0), 1);

    const stepLabels = {
      landing: 'Landing',
      gallery: 'Gallery',
      shop: 'Shop',
      reviews: 'Reviews',
      about: 'About',
      contact: 'Contact',
      etsy_click: 'Etsy'
    };

    let html = '<div class="analytics-flow">' +
      '<h5 class="analytics-flow-title">User Flow (Step → Step)</h5>';

    flowData.slice(0, 15).forEach(f => {
      const fromLabel = stepLabels[f.from] || escHTML(f.from);
      const toLabel = stepLabels[f.to] || escHTML(f.to);
      const count = Number(f.count) || 0;
      const widthPct = Math.max(Math.round((count / maxCount) * 100), 5);

      html += '<div class="analytics-flow-row">' +
        '<span class="analytics-flow-from">' + fromLabel + '</span>' +
        '<span class="analytics-flow-arrow">→</span>' +
        '<span class="analytics-flow-to">' + toLabel + '</span>' +
        '<div class="analytics-flow-bar-track">' +
          '<div class="analytics-flow-bar" style="width:' + widthPct + '%"></div>' +
        '</div>' +
        '<span class="analytics-flow-count">' + fmt(count) + '</span>' +
      '</div>';
    });

    html += '</div>';
    return html;
  }

  // ---- Source badges (pie-chart-like) ----
  function renderSourceBadges(sources) {
    if (!sources || sources.length === 0) return '';

    const colors = [
      'var(--color-primary)', 'var(--color-success)', 'var(--color-info)',
      'var(--color-warning)', 'var(--color-danger)', '#8b5cf6', '#06b6d4', '#f97316'
    ];

    let html = '<div class="analytics-source-badges">';
    sources.slice(0, 8).forEach((s, i) => {
      const color = colors[i % colors.length];
      html += '<span class="analytics-source-badge" style="border-color:' + color + '">' +
        '<span class="analytics-source-dot" style="background:' + color + '"></span>' +
        escHTML(s.source || 'Unknown') + ' <strong>' + s.pct + '%</strong>' +
      '</span>';
    });
    html += '</div>';
    return html;
  }

  // ---- Device breakdown ----
  function renderDevices(devices) {
    if (!devices || devices.length === 0) return '';

    const icons = { desktop: 'Desktop', mobile: 'Mobile', tablet: 'Tablet' };
    let html = '<div class="analytics-devices">';
    devices.forEach(d => {
      html += '<span class="analytics-device-badge">' +
        escHTML(icons[d.device] || d.device) + ' <strong>' + d.pct + '%</strong>' +
      '</span>';
    });
    html += '</div>';
    return html;
  }

  // ==================================================================
  // FETCH & RENDER ALL PANELS
  // ==================================================================

  async function loadAll() {
    if (loading) return;
    loading = true;
    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.textContent = 'Loading...';
    }

    const days = getPeriod();

    try {
      // Fetch all four in parallel
      const [galleryRes, trafficRes, shopRes, journeyRes] = await Promise.all([
        ctx.db.rpc('admin_get_gallery_analytics', { p_admin_code: ctx.adminCode, p_days: days }),
        ctx.db.rpc('admin_get_traffic_analytics', { p_admin_code: ctx.adminCode, p_days: days }),
        ctx.db.rpc('admin_get_shop_analytics', { p_admin_code: ctx.adminCode, p_days: days }),
        ctx.db.rpc('admin_get_journey_analytics', { p_admin_code: ctx.adminCode, p_days: days }),
      ]);

      // ---- Gallery Engagement ----
      if (galleryPanel) {
        const gd = galleryRes?.data;
        if (gd && gd.success) {
          const items = gd.items || [];
          const totalViews = items.reduce((s, i) => s + (Number(i.total_views) || 0), 0);
          const avgDwell = items.length > 0
            ? Math.round(items.reduce((s, i) => s + (Number(i.avg_dwell_ms) || 0), 0) / items.length)
            : 0;
          const topItem = items[0];

          // Note: Total Views includes bot traffic & inflated referrer data
          galleryPanel.innerHTML =
            '<div class="analytics-data-notice">' +
              '<small class="text-muted-2">⚠️ Note: View counts may include bot traffic from external referrers. ' +
              'Use Avg Dwell Time and Unique Sessions for more reliable engagement metrics.</small>' +
            '</div>' +
            renderMetricCards([
              { label: 'Total Views (' + periodLabel(days) + ')', value: fmt(totalViews) },
              { label: 'Avg Dwell Time', value: fmtDuration(avgDwell) },
              { label: 'Artworks Tracked', value: fmt(items.length) },
              { label: 'Unique Sessions', value: fmt(items.reduce((s, i) => s + (Number(i.unique_sessions) || 0), 0)) },
            ]) +
            '<h5 class="analytics-panel-subtitle">Top Performing Gallery Items</h5>' +
            renderBarChart(
              items.slice(0, 15),
              'title', 'total_views',
              {
                color: 'var(--color-primary)',
                suffix: ' views',
                secondaryKey: 'avg_dwell_ms',
                secondaryFmt: v => String(Math.ceil((Number(v) || 0) / 1000)),
                secondarySuffix: 's avg'
              }
            );
        } else {
          galleryPanel.innerHTML = '<p class="text-muted-2 text-xs analytics-empty">Could not load gallery analytics</p>';
        }
      }

      // ---- Traffic Analytics ----
      if (trafficPanel) {
        const td = trafficRes?.data;
        if (td && td.success) {
          const growth = Number(td.growth_pct) || 0;
          const sources = td.sources || [];
          const facebookSource = sources.find(s => s.source?.toLowerCase().includes('facebook'));
          const facebookNote = facebookSource
            ? '<small class="text-muted-2"><strong>⚠️ Facebook traffic detected (' + facebookSource.pct + '%):</strong> May include bot activity. Consider using Unique Sessions and Dwell Time metrics for accuracy.</small>'
            : '';

          trafficPanel.innerHTML =
            '<div class="analytics-data-notice">' + facebookNote + '</div>' +
            renderMetricCards([
              { label: 'Total Views (' + periodLabel(days) + ')', value: fmt(td.total_views), trend: days > 0 ? growth : undefined },
              { label: 'Unique Sessions', value: fmt(td.unique_sessions) },
              { label: 'Period', value: periodLabel(days) },
              ...(days > 0 ? [{ label: 'Prev Period', value: fmt(td.prev_period_views) + ' views' }] : []),
            ]) +
            '<h5 class="analytics-panel-subtitle">Daily Traffic</h5>' +
            renderSparkline(td.daily || [], 'views') +
            '<h5 class="analytics-panel-subtitle">Traffic Sources</h5>' +
            renderSourceBadges(td.sources || []) +
            '<h5 class="analytics-panel-subtitle">Page Performance</h5>' +
            renderBarChart(
              td.pages || [],
              'page', 'views',
              { color: 'var(--color-info)', suffix: ' views', secondaryKey: 'avg_duration_s', secondarySuffix: 's avg' }
            ) +
            '<h5 class="analytics-panel-subtitle">Device Breakdown</h5>' +
            renderDevices(td.devices || []);
        } else {
          trafficPanel.innerHTML = '<p class="text-muted-2 text-xs analytics-empty">Could not load traffic analytics</p>';
        }
      }

      // ---- Shop Performance ----
      if (shopPanel) {
        const sd = shopRes?.data;
        if (sd && sd.success) {
          const items = sd.items || [];
          const totalImpressions = items.reduce((s, i) => s + (Number(i.impressions) || 0), 0);
          const totalClicks = items.reduce((s, i) => s + (Number(i.etsy_clicks) || 0), 0);
          const overallConversion = totalImpressions > 0
            ? (totalClicks / totalImpressions * 100).toFixed(1)
            : '0.0';

          // Identify sleeper hits: high impressions, low conversion
          const sleepers = items
            .filter(i => (Number(i.impressions) || 0) > 5 && (Number(i.conversion_rate) || 0) < 5)
            .slice(0, 3);
          // High converters
          const hotItems = items
            .filter(i => (Number(i.conversion_rate) || 0) >= 10)
            .slice(0, 3);

          shopPanel.innerHTML =
            renderMetricCards([
              { label: 'Impressions (' + periodLabel(days) + ')', value: fmt(totalImpressions) },
              { label: 'Etsy Clicks', value: fmt(totalClicks) },
              { label: 'Conversion Rate', value: overallConversion + '%' },
              { label: 'Products Tracked', value: fmt(items.length) },
            ]) +
            '<h5 class="analytics-panel-subtitle">Impressions vs Clicks</h5>' +
            renderBarChart(
              items.slice(0, 10),
              'title', 'impressions',
              { color: 'var(--color-info)', suffix: ' imp', secondaryKey: 'etsy_clicks', secondarySuffix: ' clicks' }
            ) +
            (hotItems.length > 0
              ? '<h5 class="analytics-panel-subtitle">High Converters</h5>' +
                renderInsightList(hotItems, 'conversion_rate', '%')
              : '') +
            (sleepers.length > 0
              ? '<h5 class="analytics-panel-subtitle">Sleeper Hits</h5>' +
                renderInsightList(sleepers, 'conversion_rate', '%')
              : '');
        } else {
          shopPanel.innerHTML = '<p class="text-muted-2 text-xs analytics-empty">Could not load shop analytics</p>';
        }
      }

      // ---- User Journey ----
      if (journeyPanel) {
        const jd = journeyRes?.data;
        if (jd && jd.success) {
          journeyPanel.innerHTML =
            renderMetricCards([
              { label: 'Sessions (' + periodLabel(days) + ')', value: fmt(jd.total_sessions) },
              { label: 'Period', value: periodLabel(days) },
            ]) +
            '<h5 class="analytics-panel-subtitle">Visitor Funnel</h5>' +
            renderFunnel(jd.funnel || []) +
            renderFlow(jd.flow || []);
        } else {
          journeyPanel.innerHTML = '<p class="text-muted-2 text-xs analytics-empty">Could not load journey analytics</p>';
        }
      }

      loaded = true;
      Trace.log('ANALYTICS_LOADED');
    } catch (err) {
      showMsg('Failed to load analytics: ' + err.message, true);
      Trace.log('ANALYTICS_ERROR', { error: err.message });
    } finally {
      loading = false;
      if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Refresh';
      }
    }
  }

  // ---- Insight list helper ----
  function renderInsightList(items, valueKey, suffix) {
    let html = '<div class="analytics-insight-list">';
    items.forEach(item => {
      html += '<div class="analytics-insight-item">' +
        '<strong>' + escHTML(item.title || 'Unknown') + '</strong>' +
        ' — ' + Number(item[valueKey] || 0).toFixed(1) + suffix +
      '</div>';
    });
    html += '</div>';
    return html;
  }

  // ==================================================================
  // CLEAR ALL DATA — 2-click confirmation (mirrors Review Manager)
  // ==================================================================

  const CLEAR_CONFIRM_MS = 4000;
  let clearArmed = false;
  let clearTimer = null;

  function resetClearBtn() {
    if (!clearBtn) return;
    clearArmed = false;
    clearBtn.textContent = 'Clear All Data';
    clearBtn.classList.remove('confirm-armed');
    clearBtn.classList.add('danger');
    clearBtn.disabled = false;
  }

  async function executeClear() {
    if (!clearBtn) return;
    clearBtn.disabled = true;
    clearBtn.textContent = 'Clearing...';

    try {
      const { data, error } = await ctx.db.rpc('admin_clear_analytics', {
        p_admin_code: ctx.adminCode,
      });
      if (error) throw new Error(error.message);
      if (!data || !data.success) {
        throw new Error(data?.error || 'Unknown error');
      }

      showMsg('All analytics data cleared.', false);
      Trace.log('ANALYTICS_CLEARED');

      // Refresh panels to reflect empty state
      loaded = false;
      loadAll();
    } catch (err) {
      showMsg('Clear failed: ' + err.message, true);
      Trace.log('ANALYTICS_CLEAR_ERROR', { error: err.message });
    } finally {
      resetClearBtn();
    }
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (!clearArmed) {
        // First click — arm the confirmation
        clearArmed = true;
        clearBtn.textContent = '⚠️ Sure?';
        clearBtn.classList.remove('danger');
        clearBtn.classList.add('confirm-armed');
        clearTimer = setTimeout(() => {
          resetClearBtn();
        }, CLEAR_CONFIRM_MS);
        return;
      }

      // Second click — execute
      clearTimeout(clearTimer);
      clearArmed = false;
      executeClear();
    });
  }

  // ---- Event Listeners ----
  if (section) {
    // Lazy load on section open
    section.addEventListener('toggle', () => {
      if (section.open && !loaded) {
        loadAll();
      }
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loaded = false;
      loadAll();
    });
  }

  if (periodSelect) {
    periodSelect.addEventListener('change', () => {
      loaded = false;
      loadAll();
    });
  }

  Trace.log('ANALYTICS_INIT_DONE');
}
