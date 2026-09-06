/**
 * tabByma.js
 * Controlador de la pestaña de Títulos y Bonos Soberanos (BYMA / Mercado Argentino):
 * Panel en tiempo real de títulos públicos y letras (LECAPs), buscador dinámico,
 * filtros por categoría (USD, CER, LECAP), gráfico interactivo de evolución de precios,
 * indicadores macroeconómicos (Riesgo País, MEP implícito, spread de arbitraje),
 * ficha técnica ISIN oficial y motor de proyección de flujo de fondos (Cash Flow).
 */

import { fetchBymaPanel, fetchBymaBondInfo, fetchBymaHistorical, fetchBymaIndicadores } from './api.js';
import { clientCache, appState } from './state.js';
import { formatValue, formatValueCompact, formatDate, debounce } from './utils.js';
import { showToast } from './ui.js';

export const tabByma = {
  initialized: false,

  async init() {
    if (this.initialized) return;

    // Buscador por ticker o descripción
    const searchInput = document.getElementById('bymaSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', debounce((e) => {
        appState.byma.searchQuery = e.target.value.toUpperCase().trim();
        this.renderTable();
      }, 150));
    }

    // Filtros de categoría (Todos, Soberanos USD, CER/Pesos, LECAP)
    const catContainer = document.getElementById('bymaCategoryFilters');
    if (catContainer) {
      catContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-cat]');
        if (btn) {
          catContainer.querySelectorAll('button').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          appState.byma.category = btn.getAttribute('data-cat') || 'all';
          this.renderTable();
        }
      });
    }

    // Selector de rango temporal para el gráfico histórico del bono
    const chartRanges = document.getElementById('bymaChartRanges');
    if (chartRanges) {
      chartRanges.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-days]');
        if (btn) {
          chartRanges.querySelectorAll('button').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          appState.byma.chartRange = btn.getAttribute('data-days') || '180';
          if (appState.byma.selectedBond) {
            this.loadAndRenderChart(appState.byma.selectedBond);
          }
        }
      });
    }

    // Delegación de eventos en tabla de bonos
    const tableBody = document.getElementById('bymaTableBody');
    if (tableBody) {
      tableBody.addEventListener('click', (e) => {
        const tr = e.target.closest('tr[data-symbol]');
        if (tr) {
          const sym = tr.getAttribute('data-symbol');
          const bond = appState.byma.bonds.find(b => b.symbol === sym);
          if (bond) this.handleSelectBond(bond, tr);
        }
      });
    }

    // Cargar panel e indicadores macroeconómicos concurrentemente
    await Promise.all([
      this.fetchPanel(),
      this.fetchIndicadores()
    ]);

    this.initialized = true;
  },

  async fetchIndicadores() {
    try {
      const data = await fetchBymaIndicadores();
      if (data) {
        appState.byma.indicadores = data;
        const rpEl = document.getElementById('bymaRiesgoPaisValue');
        const rpSub = document.getElementById('bymaRiesgoPaisSubtext');
        const mepAl30El = document.getElementById('bymaMepAl30Value');
        const mepGd30El = document.getElementById('bymaMepGd30Value');
        const spreadSub = document.getElementById('bymaSpreadSubtext');

        if (rpEl && data.riesgoPais?.valor) {
          rpEl.textContent = `${data.riesgoPais.valor} pts`;
        }
        if (rpSub && data.riesgoPais?.fecha) {
          rpSub.textContent = `Al ${formatDate(data.riesgoPais.fecha)} • JP Morgan / ArgentinaDatos`;
        }
        if (mepAl30El && data.mepAl30) {
          mepAl30El.textContent = `$${data.mepAl30.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
        if (mepGd30El && data.mepGd30) {
          mepGd30El.textContent = `$${data.mepGd30.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
        if (spreadSub && data.spreadCanje !== undefined) {
          spreadSub.textContent = `Arbitraje GD30/AL30: ${data.spreadCanje >= 0 ? '+' : ''}${data.spreadCanje.toFixed(2)}%`;
        }
      }
    } catch (e) {
      console.warn('[BYMA] Error cargando indicadores macro:', e.message);
    }
  },

  async fetchPanel() {
    const cached = clientCache.get('byma_panel_bonds');
    if (cached) {
      appState.byma.bonds = cached.bonds;
      appState.byma.marketOpen = cached.marketOpen;
      appState.byma.isFallback = cached.isFallback;
      this.updateMarketStatusUI();
      this.renderTable();
      this.autoSelectFirstBond();
      return;
    }

    const loader = document.getElementById('loadingBymaOverlay');
    if (loader) loader.classList.remove('hidden');

    try {
      const result = await fetchBymaPanel();
      const bondList = Array.isArray(result) ? result : (result.data || []);
      appState.byma.bonds = bondList;
      appState.byma.marketOpen = result.marketOpen !== undefined ? result.marketOpen : false;
      appState.byma.isFallback = result.isFallback || false;

      clientCache.set('byma_panel_bonds', {
        bonds: appState.byma.bonds,
        marketOpen: appState.byma.marketOpen,
        isFallback: appState.byma.isFallback
      }, 60 * 1000);

      this.updateMarketStatusUI();
      this.renderTable();
      this.autoSelectFirstBond();

      if (appState.byma.marketOpen === false || appState.byma.isFallback === true) {
        showToast('Panel de bonos BYMA cargado (Mercado cerrado — Precios de último cierre oficial).', 'warning');
      } else {
        showToast('Panel de bonos de BYMA conectado en vivo.', 'success');
      }
    } catch (error) {
      console.error('[BYMA] Error al conectar con panel:', error);
      showToast('Error al conectar con BYMA.', 'danger');
    } finally {
      if (loader) loader.classList.add('hidden');
    }
  },

  updateMarketStatusUI() {
    const statusText = document.getElementById('bymaMarketStatusText');
    const statusSubtext = document.getElementById('bymaMarketStatusSubtext');
    const statusIconWrapper = document.querySelector('#cardMercadoStatus .kpi-icon-wrapper');

    if (statusText) {
      if (appState.byma.marketOpen === true) {
        statusText.textContent = 'Mercado Abierto';
        statusText.style.color = 'var(--success)';
        if (statusSubtext) statusSubtext.textContent = 'Rueda bursátil BYMA en vivo';
        if (statusIconWrapper) {
          statusIconWrapper.style.background = 'rgba(48, 209, 88, 0.15)';
          statusIconWrapper.style.color = '#30d158';
        }
      } else {
        statusText.textContent = 'Mercado Cerrado';
        statusText.style.color = 'var(--warning)';
        if (statusSubtext) statusSubtext.textContent = 'Mostrando último cierre oficial';
        if (statusIconWrapper) {
          statusIconWrapper.style.background = 'rgba(255, 214, 10, 0.15)';
          statusIconWrapper.style.color = '#ffd60a';
        }
      }
    }
  },

  renderTable() {
    const tbody = document.getElementById('bymaTableBody');
    const badge = document.getElementById('bymaCountBadge');
    if (!tbody) return;
    tbody.innerHTML = '';

    const query = (appState.byma.searchQuery || '').toUpperCase().trim();
    const category = appState.byma.category || 'all';

    let filtered = appState.byma.bonds.filter(b => {
      // Filtrar por categoría
      if (category === 'soberano_usd') {
        const isUsd = b.category === 'soberano_usd' || /^(AL|GD|AE)[0-9]{2}D?$/i.test(b.symbol);
        if (!isUsd) return false;
      } else if (category === 'soberano_cer') {
        const isCer = b.category === 'soberano_cer' || /^(TX|DICP|PARP|TO|T2)[0-9]*/i.test(b.symbol);
        if (!isCer) return false;
      } else if (category === 'lecap') {
        const isLecap = b.category === 'lecap' || b.symbol.startsWith('S') || b.symbol.startsWith('B');
        if (!isLecap) return false;
      }

      // Filtrar por búsqueda de texto
      if (query) {
        const matchSym = b.symbol.toUpperCase().includes(query);
        const matchDesc = (b.description || '').toUpperCase().includes(query);
        const matchIsin = (b.codigoIsin || '').toUpperCase().includes(query);
        return matchSym || matchDesc || matchIsin;
      }

      return true;
    });

    // Ordenamiento representativo: AL30 primero, luego GD30, luego el resto
    const priority = ['AL30', 'AL30D', 'GD30', 'GD30D', 'AE38', 'AE38D', 'AL35', 'AL35D', 'GD35', 'GD35D', 'AL29', 'AL29D', 'GD29', 'GD29D'];
    filtered.sort((a, b) => {
      const idxA = priority.indexOf(a.symbol);
      const idxB = priority.indexOf(b.symbol);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.symbol.localeCompare(b.symbol);
    });

    if (badge) {
      badge.textContent = `${filtered.length} especie${filtered.length === 1 ? '' : 's'} encontrada${filtered.length === 1 ? '' : 's'}`;
    }

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4" style="color: var(--text-secondary);">No se encontraron especies con los filtros aplicados.</td></tr>';
      return;
    }

    filtered.forEach(b => {
      const tr = document.createElement('tr');
      const varPct = (b.imbalance || 0) * 100;
      const varClass = varPct > 0 ? 'text-success' : (varPct < 0 ? 'text-danger' : '');
      const varText = varPct !== 0 ? `${varPct > 0 ? '+' : ''}${varPct.toFixed(2)}%` : '0.00%';

      const isUsd = b.denominationCcy === 'USD' || b.symbol.endsWith('D');
      const ccySymbol = isUsd ? 'US$' : '$';
      const formattedPrice = `${ccySymbol} ${formatValue(b.trade)}`;

      tr.setAttribute('data-symbol', b.symbol);
      tr.style.cursor = 'pointer';
      tr.innerHTML = `
        <td>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="font-bold" style="color: var(--text-primary); font-size: 13.5px;">${b.symbol}</span>
            <span style="font-size: 9.5px; padding: 1px 5px; border-radius: 3px; font-weight: 600; background: ${isUsd ? 'rgba(10, 132, 255, 0.2); color: #0a84ff;' : 'rgba(48, 209, 88, 0.2); color: #30d158;'}">${isUsd ? 'USD' : 'ARS'}</span>
          </div>
        </td>
        <td class="text-right font-medium" style="font-size: 13px;">${formattedPrice}</td>
        <td class="text-right ${varClass}" style="font-weight: 600;">${varText}</td>
        <td class="text-right text-muted" style="font-size: 12px;">${formatValueCompact(b.volumeAmount || b.tradeVolume)}</td>
      `;

      if (appState.byma.selectedBond && appState.byma.selectedBond.symbol === b.symbol) {
        tr.classList.add('active');
      }

      tbody.appendChild(tr);
    });
  },

  autoSelectFirstBond() {
    if (appState.byma.bonds.length === 0) return;
    const defaultBond = appState.byma.bonds.find(b => b.symbol === 'AL30') || appState.byma.bonds[0];
    if (defaultBond) {
      const tr = document.querySelector(`#bymaTableBody tr[data-symbol="${defaultBond.symbol}"]`);
      this.handleSelectBond(defaultBond, tr);
    }
  },

  async handleSelectBond(bond, rowElement) {
    appState.byma.selectedBond = bond;

    document.querySelectorAll('#bymaTableBody tr').forEach(r => r.classList.remove('active'));
    if (rowElement) {
      rowElement.classList.add('active');
    }

    const noSelection = document.getElementById('bymaNoSelection');
    const dataContainer = document.getElementById('bymaBonoData');
    const nameEl = document.getElementById('bymaBonoName');
    const ccyBadgeEl = document.getElementById('bymaBonoCcyBadge');
    const priceDisplayEl = document.getElementById('bymaBonoPriceDisplay');
    const varDisplayEl = document.getElementById('bymaBonoVarDisplay');
    const descEl = document.getElementById('bymaBonoDesc');

    if (noSelection) noSelection.classList.add('hidden');
    if (dataContainer) dataContainer.classList.remove('hidden');

    const isUsd = bond.denominationCcy === 'USD' || bond.symbol.endsWith('D');
    const ccyPrefix = isUsd ? 'US$' : '$';

    if (nameEl) nameEl.textContent = bond.symbol;
    if (ccyBadgeEl) {
      ccyBadgeEl.textContent = isUsd ? 'USD Cable / MEP' : 'Pesos (ARS)';
      ccyBadgeEl.style.background = isUsd ? 'rgba(10, 132, 255, 0.2)' : 'rgba(48, 209, 88, 0.2)';
      ccyBadgeEl.style.color = isUsd ? '#0a84ff' : '#30d158';
    }
    if (priceDisplayEl) {
      priceDisplayEl.textContent = `${ccyPrefix} ${formatValue(bond.trade)}`;
    }
    if (varDisplayEl) {
      const varPct = (bond.imbalance || 0) * 100;
      varDisplayEl.className = varPct > 0 ? 'text-success' : (varPct < 0 ? 'text-danger' : 'text-muted');
      varDisplayEl.textContent = varPct !== 0 ? `${varPct > 0 ? '+' : ''}${varPct.toFixed(2)}%` : '0.00%';
    }
    if (descEl) {
      descEl.textContent = bond.description || 'Título Público Soberano';
    }

    // 1. Cargar ficha técnica
    await this.loadTechnicalSheet(bond);

    // 2. Cargar gráfico histórico de precios
    await this.loadAndRenderChart(bond);

    // 3. Renderizar flujo de fondos futuro
    this.renderCashFlow(bond.symbol);
  },

  async loadTechnicalSheet(bond) {
    const cleanSymbol = bond.symbol.replace(/\s+(24HS|CI|48HS|72HS)$/i, '').replace(/[D|C|X|Y|Z]$/, '').trim();
    const cacheKey = `byma_bond_info_${cleanSymbol}`;
    let info = clientCache.get(cacheKey);

    if (!info) {
      try {
        const result = await fetchBymaBondInfo(cleanSymbol);
        info = (result && result.data && result.data.length > 0) ? result.data[0] : (Array.isArray(result) ? result[0] : null);
        if (!info && bond.technicalSheet) {
          info = bond.technicalSheet;
        }
        if (info) {
          clientCache.set(cacheKey, info, 10 * 60 * 1000);
        }
      } catch (e) {
        console.warn(`[BYMA] Error al cargar ficha ${bond.symbol}:`, e.message);
        info = bond.technicalSheet || null;
      }
    }

    const descEl = document.getElementById('bymaBonoDesc');
    const isinEl = document.getElementById('bonoIsin');
    const monedaEl = document.getElementById('bonoMoneda');
    const leyEl = document.getElementById('bonoLey');
    const emisorEl = document.getElementById('bonoEmisor');
    const nominalEl = document.getElementById('bonoMontoNominal');
    const residualEl = document.getElementById('bonoMontoResidual');
    const amortEl = document.getElementById('bonoAmortizacion');
    const interesEl = document.getElementById('bonoInteres');

    if (info) {
      if (descEl && info.denominacion) descEl.textContent = info.denominacion;
      if (isinEl) isinEl.textContent = info.codigoIsin || bond.codigoIsin || '-';
      if (monedaEl) monedaEl.textContent = info.moneda || (bond.denominationCcy === 'USD' ? 'Dólares' : 'Pesos');
      if (leyEl) leyEl.textContent = info.ley || bond.ley || '-';
      if (emisorEl) emisorEl.textContent = info.emisor || 'Gobierno Nacional';
      if (nominalEl) nominalEl.textContent = formatValueCompact(info.montoNominal);
      if (residualEl) {
        if (typeof info.montoResidual === 'number') {
          residualEl.textContent = formatValueCompact(info.montoResidual);
        } else {
          residualEl.textContent = info.montoResidual || '-';
        }
      }
      if (amortEl) amortEl.textContent = info.formaAmortizacion || 'Al vencimiento (Bullet).';
      if (interesEl) interesEl.textContent = info.interes || 'Esquema de cupones no especificado.';
    } else {
      if (isinEl) isinEl.textContent = bond.codigoIsin || '-';
      if (monedaEl) monedaEl.textContent = bond.denominationCcy || '-';
      if (leyEl) leyEl.textContent = bond.ley || '-';
      if (emisorEl) emisorEl.textContent = 'Gobierno Nacional';
      if (nominalEl) nominalEl.textContent = '-';
      if (residualEl) residualEl.textContent = '-';
      if (amortEl) amortEl.textContent = 'Amortización semestral / al vencimiento.';
      if (interesEl) interesEl.textContent = 'Cupones fijos o flotantes según condiciones de emisión.';
    }
  },

  async loadAndRenderChart(bond) {
    const canvas = document.getElementById('bymaBonoChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let historyData = null;
    const cacheKey = `byma_hist_${bond.symbol}`;
    const cachedHist = clientCache.get(cacheKey);

    if (cachedHist) {
      historyData = cachedHist;
    } else {
      try {
        const nowUnix = Math.floor(Date.now() / 1000);
        const fromUnix = nowUnix - 365 * 24 * 3600;
        const res = await fetchBymaHistorical(bond.symbol, fromUnix, nowUnix);
        if (res && res.s === 'ok' && Array.isArray(res.c) && res.c.length > 0) {
          historyData = res;
          clientCache.set(cacheKey, historyData, 5 * 60 * 1000);
        } else if (bond.historicalSeries && bond.historicalSeries.c && bond.historicalSeries.c.length > 0) {
          historyData = bond.historicalSeries;
        }
      } catch (e) {
        console.warn(`[BYMA] Error en histórico de ${bond.symbol}:`, e.message);
        if (bond.historicalSeries && bond.historicalSeries.c) {
          historyData = bond.historicalSeries;
        }
      }
    }

    if (!historyData || !Array.isArray(historyData.c) || historyData.c.length === 0) {
      return;
    }

    // Filtrar por rango temporal
    const daysRange = appState.byma.chartRange || '180';
    let count = historyData.c.length;
    if (daysRange !== 'all') {
      const targetDays = parseInt(daysRange, 10);
      // Asumir ~20 días bursátiles por mes
      const points = Math.min(count, Math.round(targetDays * (21 / 30)));
      count = points > 5 ? points : count;
    }

    const tSlice = historyData.t.slice(-count);
    const cSlice = historyData.c.slice(-count);

    const labels = tSlice.map(ts => {
      const d = new Date(ts * 1000);
      return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
    });

    const isUsd = bond.denominationCcy === 'USD' || bond.symbol.endsWith('D');
    const lineColor = isUsd ? '#0a84ff' : '#30d158';

    if (appState.byma.chart) {
      appState.byma.chart.destroy();
      appState.byma.chart = null;
    }

    // Gradiente de fondo
    const gradient = ctx.createLinearGradient(0, 0, 0, 260);
    gradient.addColorStop(0, isUsd ? 'rgba(10, 132, 255, 0.28)' : 'rgba(48, 209, 88, 0.28)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    appState.byma.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: `Precio Cierre (${isUsd ? 'USD' : 'ARS'})`,
          data: cSlice,
          borderColor: lineColor,
          backgroundColor: gradient,
          fill: true,
          tension: 0.25,
          borderWidth: 2,
          pointRadius: cSlice.length > 60 ? 0 : 2.5,
          pointHoverRadius: 5,
          pointBackgroundColor: lineColor
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(20, 24, 33, 0.95)',
            titleColor: '#fff',
            bodyColor: '#e0e0e0',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            borderWidth: 1,
            callbacks: {
              label: (item) => {
                const val = item.raw;
                const formatted = isUsd ? `US$ ${val.toFixed(2)}` : `$ ${formatValue(val)}`;
                return ` Cotización: ${formatted}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              color: 'rgba(255, 255, 255, 0.05)',
              drawBorder: false
            },
            ticks: {
              color: 'rgba(255, 255, 255, 0.5)',
              font: { size: 11 },
              maxTicksLimit: 8
            }
          },
          y: {
            grid: {
              color: 'rgba(255, 255, 255, 0.05)',
              drawBorder: false
            },
            ticks: {
              color: 'rgba(255, 255, 255, 0.5)',
              font: { size: 11 },
              callback: (v) => isUsd ? `US$ ${v}` : `$ ${formatValueCompact(v)}`
            }
          }
        }
      }
    });
  },

  renderCashFlow(symbol) {
    const cashFlowBody = document.getElementById('bonoCashFlowBody');
    if (!cashFlowBody) return;
    cashFlowBody.innerHTML = '';

    const flows = this.calculateBonoCashFlow(symbol);
    if (flows.length > 0) {
      flows.forEach(f => {
        const tr = document.createElement('tr');
        const colorStyle = f.concepto === 'Amortización' ? 'color: var(--theme-byma); font-weight: 600;' : '';
        tr.innerHTML = `
          <td>${f.fecha}</td>
          <td>${f.concepto}</td>
          <td class="text-right font-medium" style="${colorStyle}">${f.monto}</td>
        `;
        cashFlowBody.appendChild(tr);
      });
    } else {
      cashFlowBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3">No hay cupones de cobro futuros proyectados.</td></tr>';
    }
  },

  calculateBonoCashFlow(symbol) {
    const clean = symbol.replace(/\s+(24HS|CI|48HS|72HS)$/i, '').replace(/[D|C|X|Y|Z]$/, '').toUpperCase();
    const hoy = new Date('2026-09-06');
    const flows = [];

    if (clean === 'AL30' || clean === 'GD30') {
      const cronograma = [
        { fecha: '2027-01-09', amort: 8.0, int: 0.375 },
        { fecha: '2027-07-09', amort: 8.0, int: 0.875 },
        { fecha: '2028-01-09', amort: 8.0, int: 0.875 },
        { fecha: '2028-07-09', amort: 8.5, int: 0.875 },
        { fecha: '2029-01-09', amort: 8.5, int: 0.875 },
        { fecha: '2029-07-09', amort: 9.0, int: 0.875 },
        { fecha: '2030-01-09', amort: 9.0, int: 0.875 },
        { fecha: '2030-07-09', amort: 9.0, int: 0.875 }
      ];
      cronograma.forEach(c => {
        if (new Date(c.fecha) >= hoy) {
          const f = formatDate(c.fecha);
          flows.push({ fecha: f, concepto: 'Interés', monto: `${c.int.toFixed(3)}%` });
          flows.push({ fecha: f, concepto: 'Amortización', monto: `${c.amort.toFixed(1)}%` });
        }
      });
    } else if (clean === 'AE38' || clean === 'GD38') {
      const cronograma = [
        { fecha: '2027-01-09', amort: 0.0, int: 2.125 },
        { fecha: '2027-07-09', amort: 4.54, int: 2.50 },
        { fecha: '2028-01-09', amort: 4.54, int: 2.50 }
      ];
      for (let anio = 2028; anio <= 2037; anio++) {
        cronograma.push({ fecha: `${anio}-07-09`, amort: 4.54, int: 2.50 });
        cronograma.push({ fecha: `${anio + 1}-01-09`, amort: 4.54, int: 2.50 });
      }
      cronograma.forEach(c => {
        if (new Date(c.fecha) >= hoy) {
          const f = formatDate(c.fecha);
          flows.push({ fecha: f, concepto: 'Interés', monto: `${c.int.toFixed(3)}%` });
          if (c.amort > 0) {
            flows.push({ fecha: f, concepto: 'Amortización', monto: `${c.amort.toFixed(2)}%` });
          }
        }
      });
    } else if (clean === 'GD35' || clean === 'AL35') {
      const cronograma = [
        { fecha: '2027-01-09', amort: 0.0, int: 1.75 },
        { fecha: '2027-07-09', amort: 0.0, int: 1.75 },
        { fecha: '2028-01-09', amort: 0.0, int: 1.75 },
        { fecha: '2028-07-09', amort: 6.66, int: 2.00 }
      ];
      for (let anio = 2028; anio <= 2034; anio++) {
        cronograma.push({ fecha: `${anio}-07-09`, amort: 6.66, int: 2.00 });
        cronograma.push({ fecha: `${anio + 1}-01-09`, amort: 6.66, int: 2.00 });
      }
      cronograma.forEach(c => {
        if (new Date(c.fecha) >= hoy) {
          const f = formatDate(c.fecha);
          flows.push({ fecha: f, concepto: 'Interés', monto: `${c.int.toFixed(3)}%` });
          if (c.amort > 0) {
            flows.push({ fecha: f, concepto: 'Amortización', monto: `${c.amort.toFixed(2)}%` });
          }
        }
      });
    } else if (clean === 'AL29' || clean === 'GD29') {
      const cronograma = [
        { fecha: '2027-01-09', amort: 10.0, int: 0.50 },
        { fecha: '2027-07-09', amort: 10.0, int: 0.875 },
        { fecha: '2028-01-09', amort: 10.0, int: 0.875 },
        { fecha: '2028-07-09', amort: 10.0, int: 0.875 },
        { fecha: '2029-01-09', amort: 10.0, int: 0.875 },
        { fecha: '2029-07-09', amort: 10.0, int: 0.875 }
      ];
      cronograma.forEach(c => {
        if (new Date(c.fecha) >= hoy) {
          const f = formatDate(c.fecha);
          flows.push({ fecha: f, concepto: 'Interés', monto: `${c.int.toFixed(3)}%` });
          flows.push({ fecha: f, concepto: 'Amortización', monto: `${c.amort.toFixed(1)}%` });
        }
      });
    } else if (clean === 'TX26') {
      flows.push({ fecha: '09/11/2026', concepto: 'Amortización Final + CER', monto: '100% + CER' });
    } else if (clean === 'TX28') {
      flows.push({ fecha: '09/11/2027', concepto: 'Amortización Cuota 1 + CER', monto: '50% + CER' });
      flows.push({ fecha: '09/11/2028', concepto: 'Amortización Final + CER', monto: '50% + CER' });
    }

    if (symbol.startsWith('S') || symbol.startsWith('B')) {
      const bondInfo = appState.byma.bonds.find(b => b.symbol === symbol);
      if (bondInfo && bondInfo.maturityDate) {
        flows.push({
          fecha: formatDate(bondInfo.maturityDate),
          concepto: 'Amortización + Rendimiento Capitalizable',
          monto: '100% (Liquidación al Vencimiento)'
        });
      }
    }

    return flows;
  }
};
