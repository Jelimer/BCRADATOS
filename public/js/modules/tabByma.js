/**
 * tabByma.js
 * Controlador de la pestaña de Títulos y Bonos Soberanos (BYMA):
 * Panel en tiempo real de títulos públicos y letras (LECAPs), buscador dinámico,
 * ficha técnica ISIN y motor de proyección de flujo de fondos (Cash Flow).
 */

import { fetchBymaPanel, fetchBymaBondInfo } from './api.js';
import { clientCache, appState } from './state.js';
import { formatValue, formatValueCompact, formatDate, debounce } from './utils.js';
import { showToast } from './ui.js';

export const tabByma = {
  initialized: false,

  async init() {
    if (this.initialized) return;

    const searchInput = document.getElementById('bymaSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', debounce((e) => {
        appState.byma.searchQuery = e.target.value.toUpperCase().trim();
        this.renderTable();
      }, 150));
    }

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

    await this.fetchPanel();
    this.initialized = true;
  },

  async fetchPanel() {
    const cached = clientCache.get('byma_panel_bonds');
    if (cached) {
      appState.byma.bonds = cached.bonds;
      appState.byma.marketOpen = cached.marketOpen;
      appState.byma.isFallback = cached.isFallback;
      this.renderTable();
      return;
    }

    const loader = document.getElementById('loadingBymaOverlay');
    if (loader) loader.classList.remove('hidden');

    try {
      const result = await fetchBymaPanel();
      appState.byma.bonds = Array.isArray(result) ? result : (result.data || []);
      appState.byma.marketOpen = result.marketOpen !== undefined ? result.marketOpen : true;
      appState.byma.isFallback = result.isFallback || false;

      clientCache.set('byma_panel_bonds', {
        bonds: appState.byma.bonds,
        marketOpen: appState.byma.marketOpen,
        isFallback: appState.byma.isFallback
      }, 30 * 1000);

      this.renderTable();
      if (appState.byma.marketOpen === false || appState.byma.isFallback === true) {
        showToast('Panel de bonos BYMA cargado (Mercado cerrado — Último cierre registrado).', 'warning');
      } else {
        showToast('Panel de bonos de BYMA cargado.', 'success');
      }
    } catch (error) {
      console.error(error);
      showToast('Error al conectar con BYMA.', 'danger');
    } finally {
      if (loader) loader.classList.add('hidden');
    }
  },

  renderTable() {
    const tbody = document.getElementById('bymaTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const curados = ['AL30', 'AL30D', 'GD30', 'GD30D', 'AE38', 'AE38D', 'GD35', 'GD35D', 'AL29', 'AL29D'];

    let filtered = appState.byma.bonds.filter(b => {
      if (b.settlementType !== '2') return false;
      const sym = b.symbol;
      if (appState.byma.searchQuery) {
        return sym.includes(appState.byma.searchQuery);
      }
      return curados.includes(sym) || (sym.startsWith('S') && sym.length === 5 && b.volume > 0);
    });

    filtered.sort((a, b) => a.symbol.localeCompare(b.symbol));

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center">No se encontraron especies.</td></tr>';
      return;
    }

    filtered.forEach(b => {
      const tr = document.createElement('tr');
      const varPct = (b.imbalance || 0) * 100;
      const varClass = varPct > 0 ? 'text-success' : (varPct < 0 ? 'text-danger' : '');
      const varText = varPct !== 0 ? `${varPct > 0 ? '+' : ''}${varPct.toFixed(2)}%` : '0.00%';

      tr.setAttribute('data-symbol', b.symbol);
      tr.innerHTML = `
        <td class="font-bold" style="color: var(--text-primary);">${b.symbol}</td>
        <td class="text-right font-medium">${formatValue(b.trade)}</td>
        <td class="text-right ${varClass}">${varText}</td>
        <td class="text-right text-muted">${formatValueCompact(b.volumeAmount)}</td>
      `;

      if (appState.byma.selectedBond && appState.byma.selectedBond.symbol === b.symbol) {
        tr.classList.add('active');
      }

      tbody.appendChild(tr);
    });
  },

  async handleSelectBond(bond, rowElement) {
    appState.byma.selectedBond = bond;

    document.querySelectorAll('#bymaTableBody tr').forEach(r => r.classList.remove('active'));
    rowElement.classList.add('active');

    const noSelection = document.getElementById('bymaNoSelection');
    const dataContainer = document.getElementById('bymaBonoData');
    const nameEl = document.getElementById('bymaBonoName');
    const descEl = document.getElementById('bymaBonoDesc');

    if (noSelection) noSelection.classList.add('hidden');
    if (dataContainer) dataContainer.classList.add('hidden');
    if (nameEl) nameEl.textContent = bond.symbol;
    if (descEl) descEl.textContent = 'Consultando ficha técnica...';

    const cleanSymbol = bond.symbol.replace(/[D|C|X|Y|Z]$/, '');
    const cacheKey = `byma_bond_info_${cleanSymbol}`;
    const cachedInfo = clientCache.get(cacheKey);

    try {
      let info = null;
      if (cachedInfo) {
        info = cachedInfo;
      } else {
        const result = await fetchBymaBondInfo(cleanSymbol);
        info = (result && result.data && result.data.length > 0) ? result.data[0] : (Array.isArray(result) ? result[0] : null);
        if (info) {
          clientCache.set(cacheKey, info, 10 * 60 * 1000);
        }
      }

      if (info) {
        if (descEl) descEl.textContent = info.denominacion || 'Título Público';
        document.getElementById('bonoIsin').textContent = info.codigoIsin || '-';
        document.getElementById('bonoMoneda').textContent = info.moneda || '-';
        document.getElementById('bonoLey').textContent = info.ley || '-';
        document.getElementById('bonoEmisor').textContent = info.emisor || '-';
        document.getElementById('bonoMontoNominal').textContent = formatValueCompact(info.montoNominal);
        document.getElementById('bonoMontoResidual').textContent = info.montoResidual ? `${(info.montoResidual * 100).toFixed(2)}%` : '-';
        document.getElementById('bonoAmortizacion').textContent = info.formaAmortizacion || 'Al vencimiento (Bullet).';
        document.getElementById('bonoInteres').textContent = info.interes || 'Esquema de cupones no especificado.';
        if (dataContainer) dataContainer.classList.remove('hidden');
      } else {
        if (descEl) descEl.textContent = 'Información general';
        document.getElementById('bonoIsin').textContent = '-';
        document.getElementById('bonoMoneda').textContent = bond.denominationCcy || '-';
        document.getElementById('bonoLey').textContent = '-';
        document.getElementById('bonoEmisor').textContent = '-';
        document.getElementById('bonoMontoNominal').textContent = '-';
        document.getElementById('bonoMontoResidual').textContent = '-';
        document.getElementById('bonoAmortizacion').textContent = 'Al vencimiento (Bullet).';
        document.getElementById('bonoInteres').textContent = 'Esquema de cupones no disponible.';
        if (dataContainer) dataContainer.classList.remove('hidden');
      }

      this.renderCashFlow(bond.symbol);
    } catch (error) {
      console.error(error);
      showToast('Error al cargar la ficha del bono.', 'warning');
    }
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
      cashFlowBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">No hay cupones de cobro futuros estimados.</td></tr>';
    }
  },

  calculateBonoCashFlow(symbol) {
    const clean = symbol.replace(/[D|C|X|Y|Z]$/, '').toUpperCase();
    const hoy = new Date('2026-06-08');
    const flows = [];

    if (clean === 'AL30' || clean === 'GD30') {
      const cronograma = [
        { fecha: '2026-07-09', amort: 8.0, int: 0.375 },
        { fecha: '2027-01-09', amort: 8.0, int: 0.375 },
        { fecha: '2027-07-09', amort: 8.0, int: 0.875 },
        { fecha: '2028-01-09', amort: 8.0, int: 0.875 },
        { fecha: '2028-07-09', amort: 8.5, int: 0.875 },
        { fecha: '2029-01-09', amort: 8.5, int: 0.875 },
        { fecha: '2029-07-09', amort: 9.0, int: 0.875 },
        { fecha: '2030-01-09', amort: 9.0, int: 0.875 }
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
        { fecha: '2026-07-09', amort: 0.0, int: 2.125 },
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
        { fecha: '2026-07-09', amort: 0.0, int: 1.75 },
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
        { fecha: '2026-07-09', amort: 10.0, int: 0.50 },
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
    }

    if (symbol.startsWith('S') && symbol.length === 5) {
      const bondInfo = appState.byma.bonds.find(b => b.symbol === symbol);
      if (bondInfo && bondInfo.maturityDate) {
        flows.push({
          fecha: formatDate(bondInfo.maturityDate),
          concepto: 'Amortización + Interés',
          monto: '100% (Capitalización al Vencimiento)'
        });
      }
    }

    return flows;
  }
};
