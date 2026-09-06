/**
 * tabDolares.js
 * Controlador de la pestaña de Mercado Cambiario y Cotizaciones del Dólar:
 * Dólares financieros (Oficial, MEP, CCL, Blue Compra/Venta, Cripto),
 * divisas oficiales (Mayorista A3500, Euro, Real), cálculo dinámico de brechas,
 * gráfico reactivo multivariable, tabla paginada y exportación a CSV.
 */

import { fetchMercadoLive, fetchDolarBlueLive, fetchDivisasCambiarias, fetchBcraHistorical, fetchBymaHistorical, fetchDolarBlueHistorical } from './api.js';
import { clientCache, appState } from './state.js';
import { formatValue, formatDate, downloadBlob } from './utils.js';
import { maxMinLabelPlugin, registerChart, downloadChartPNG } from './charts.js';
import { showToast } from './ui.js';
import { tabCripto } from './tabCripto.js';

export const tabDolares = {
  initialized: false,

  async init() {
    if (this.initialized) return;

    // Rango rápido de dólares
    const ranges = document.getElementById('dolaresRanges');
    if (ranges) {
      ranges.addEventListener('click', (e) => {
        const btn = e.target.closest('.range-btn');
        if (!btn) return;
        document.querySelectorAll('#dolaresRanges .range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        appState.dolares.days = btn.getAttribute('data-days') === 'all' ? 'all' : parseInt(btn.getAttribute('data-days'), 10);
        appState.dolares.tablePage = 1;
        this.renderChart();
      });
    }

    const applyDatesBtn = document.getElementById('applyDolaresDatesBtn');
    if (applyDatesBtn) {
      applyDatesBtn.addEventListener('click', () => this.applyManualDatesFilter());
    }

    const btnPrices = document.getElementById('btnShowDolarChart');
    const btnBrecha = document.getElementById('btnShowBrechaChart');
    const btnExport = document.getElementById('exportDolaresCsvBtn');
    const btnDownload = document.getElementById('btnDownloadDolaresChart');

    if (btnPrices) btnPrices.addEventListener('click', () => this.switchView('prices'));
    if (btnBrecha) btnBrecha.addEventListener('click', () => this.switchView('brecha'));
    if (btnExport) btnExport.addEventListener('click', () => this.exportToCsv());
    if (btnDownload) {
      btnDownload.addEventListener('click', () => {
        downloadChartPNG(appState.dolares.chart, `dolares_${appState.dolares.activeView}.png`);
      });
    }

    // Checkboxes de visualización
    ['chkOficial', 'chkMep', 'chkBlueCompra', 'chkBlueVenta'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => this.renderChart());
    });

    // Paginación
    const btnPrev = document.getElementById('btnPrevDolaresPage');
    const btnNext = document.getElementById('btnNextDolaresPage');
    if (btnPrev) btnPrev.addEventListener('click', () => this.changeTablePage(-1));
    if (btnNext) btnNext.addEventListener('click', () => this.changeTablePage(1));

    await this.fetchData();
    this.initialized = true;
  },

  applyManualDatesFilter() {
    const startStr = document.getElementById('dolaresStartDate').value;
    const endStr = document.getElementById('dolaresEndDate').value;
    if (!startStr || !endStr) {
      showToast('Selecciona ambas fechas.', 'warning');
      return;
    }
    if (new Date(startStr) > new Date(endStr)) {
      showToast('Fecha de inicio posterior a la fecha de fin.', 'warning');
      return;
    }
    document.querySelectorAll('#dolaresRanges .range-btn').forEach(b => b.classList.remove('active'));
    appState.dolares.days = 'manual';
    appState.dolares.tablePage = 1;
    this.renderChart();
  },

  async fetchData() {
    const cached = clientCache.get('dolares_market_data');
    if (cached) {
      appState.dolares.live = cached.live;
      appState.dolares.historical = cached.historical;
      this.renderLiveCards();
      tabCripto.updateDolarCriptoCard();

      const dates = appState.dolares.historical.mep.map(d => d.date);
      if (dates.length > 0) {
        document.getElementById('dolaresStartDate').value = dates[0];
        document.getElementById('dolaresEndDate').value = dates[dates.length - 1];
        document.getElementById('dolaresStartDate').min = dates[0];
        document.getElementById('dolaresStartDate').max = dates[dates.length - 1];
        document.getElementById('dolaresEndDate').min = dates[0];
        document.getElementById('dolaresEndDate').max = dates[dates.length - 1];
      }
      this.renderChart();
      return;
    }

    const loader = document.getElementById('loadingDolaresOverlay');
    if (loader) loader.classList.remove('hidden');

    try {
      // 1. Obtener Dólar MEP y CCL en vivo
      const [mepRaw, cclRaw] = await Promise.all([
        fetchMercadoLive('mep').catch(() => 1200),
        fetchMercadoLive('ccl').catch(() => 1240)
      ]);

      const getPrice = (data) => {
        if (typeof data === 'number') return data;
        if (typeof data === 'string') return parseFloat(data);
        if (Array.isArray(data) && data.length > 0) return getPrice(data[0]);
        if (data && typeof data === 'object') return parseFloat(data.price || data.valor || data.value || data.close || 0);
        return 0;
      };

      appState.dolares.live.mep = getPrice(mepRaw) || 1200;
      appState.dolares.live.ccl = getPrice(cclRaw) || 1240;

      // 2. Obtener Dólar Oficial actual (Variable 4 del BCRA)
      const oficialVar = appState.bcra.variables.find(v => String(v.idVariable || v.id) === '4');
      appState.dolares.live.oficial = oficialVar ? parseFloat(oficialVar.ultValorInformado) : 950;

      // 2a. Obtener Dólar Blue real en vivo
      try {
        const blueData = await fetchDolarBlueLive();
        appState.dolares.live.blueCompra = parseFloat(blueData.compra || 0);
        appState.dolares.live.blueVenta = parseFloat(blueData.venta || 0);
        appState.dolares.live.blue = appState.dolares.live.blueVenta;
      } catch (e) {
        console.warn('Usando fallback para cotización del Dólar Blue en vivo:', e.message);
        appState.dolares.live.blueCompra = appState.dolares.live.mep * 1.015;
        appState.dolares.live.blueVenta = appState.dolares.live.mep * 1.035;
        appState.dolares.live.blue = appState.dolares.live.blueVenta;
      }

      // 2b. Obtener divisas oficiales (Euro, Real, Dólar Mayorista A3500)
      try {
        const cambData = await fetchDivisasCambiarias();
        let results = [];
        if (cambData && cambData.results) {
          if (Array.isArray(cambData.results)) {
            results = cambData.results;
          } else if (Array.isArray(cambData.results.detalle)) {
            results = cambData.results.detalle;
          }
        } else if (Array.isArray(cambData)) {
          results = cambData;
        }

        const usdMayorista = results.find(d =>
          d.codigoMoneda === 'USD' ||
          (d.descripcion && d.descripcion.toLowerCase().includes('estadounidense')) ||
          (d.detalle && typeof d.detalle === 'string' && d.detalle.toLowerCase().includes('mayorista')) ||
          d.codigo === 'A3500'
        );
        const eurOficial = results.find(d =>
          d.codigoMoneda === 'EUR' ||
          (d.descripcion && d.descripcion.toLowerCase().includes('euro')) ||
          (d.detalle && typeof d.detalle === 'string' && d.detalle.toLowerCase().includes('euro'))
        );
        const brlOficial = results.find(d =>
          d.codigoMoneda === 'BRL' ||
          (d.descripcion && d.descripcion.toLowerCase().includes('real')) ||
          (d.detalle && typeof d.detalle === 'string' && d.detalle.toLowerCase().includes('real'))
        );

        appState.dolares.live.mayorista = usdMayorista ? parseFloat(usdMayorista.tipoCotizacion || usdMayorista.tipoCambioVendedor || usdMayorista.valor || usdMayorista.close) : (appState.dolares.live.oficial * 0.985);
        appState.dolares.live.euro = eurOficial ? parseFloat(eurOficial.tipoCotizacion || eurOficial.tipoCambioVendedor || eurOficial.valor || eurOficial.close) : (appState.dolares.live.oficial * 1.09);
        appState.dolares.live.real = brlOficial ? parseFloat(brlOficial.tipoCotizacion || brlOficial.tipoCambioVendedor || brlOficial.valor || brlOficial.close) : (appState.dolares.live.oficial * 0.185);
      } catch (e) {
        console.warn('Usando fallback para cotizaciones cambiarias oficiales:', e.message);
        appState.dolares.live.mayorista = appState.dolares.live.oficial * 0.985;
        appState.dolares.live.euro = appState.dolares.live.oficial * 1.09;
        appState.dolares.live.real = appState.dolares.live.oficial * 0.185;
      }

      // Actualizar tarjetas en vivo y tarjeta cripto
      this.renderLiveCards();
      tabCripto.updateDolarCriptoCard();

      // 3. Obtener Históricos
      const to = Math.floor(Date.now() / 1000);
      const from = to - (365 * 24 * 60 * 60);
      const [oficialHist, al30Hist, al30dHist, blueHist] = await Promise.all([
        fetchBcraHistorical(4).catch(() => []),
        fetchBymaHistorical('AL30 24HS', from, to).catch(() => ({})),
        fetchBymaHistorical('AL30D 24HS', from, to).catch(() => ({})),
        fetchDolarBlueHistorical().catch(() => [])
      ]);

      const parsedOficial = Array.isArray(oficialHist) ? oficialHist : [];

      const parsedMep = [];
      if (al30Hist && al30Hist.t && al30dHist && al30dHist.t) {
        const al30dMap = {};
        al30dHist.t.forEach((ts, idx) => {
          al30dMap[ts] = al30dHist.c[idx];
        });

        al30Hist.t.forEach((ts, idx) => {
          const pes = al30Hist.c[idx];
          const usd = al30dMap[ts];
          if (pes && usd && usd > 0) {
            const dateStr = new Date(ts * 1000).toISOString().split('T')[0];
            parsedMep.push({
              date: dateStr,
              value: pes / usd
            });
          }
        });
      }

      const parsedBlue = [];
      const rawBlue = Array.isArray(blueHist) ? blueHist : [];
      rawBlue.forEach(item => {
        const valCompra = parseFloat(item.compra);
        const valVenta = parseFloat(item.venta);
        if (item.fecha && !isNaN(valVenta)) {
          parsedBlue.push({
            date: item.fecha,
            compra: isNaN(valCompra) ? valVenta * 0.985 : valCompra,
            venta: valVenta
          });
        }
      });

      appState.dolares.historical.oficial = parsedOficial;
      appState.dolares.historical.mep = parsedMep.sort((a, b) => a.date.localeCompare(b.date));
      appState.dolares.historical.blue = parsedBlue.sort((a, b) => a.date.localeCompare(b.date));

      clientCache.set('dolares_market_data', { live: appState.dolares.live, historical: appState.dolares.historical }, 60 * 1000);

      const dates = appState.dolares.historical.mep.map(d => d.date);
      if (dates.length > 0) {
        document.getElementById('dolaresStartDate').value = dates[0];
        document.getElementById('dolaresEndDate').value = dates[dates.length - 1];
        document.getElementById('dolaresStartDate').min = dates[0];
        document.getElementById('dolaresStartDate').max = dates[dates.length - 1];
        document.getElementById('dolaresEndDate').min = dates[0];
        document.getElementById('dolaresEndDate').max = dates[dates.length - 1];
      }

      this.renderChart();
      showToast('Cotizaciones y brecha cambiaria actualizadas.', 'success');
    } catch (error) {
      console.error(error);
      showToast('Error al obtener cotizaciones del mercado.', 'danger');
    } finally {
      if (loader) loader.classList.add('hidden');
    }
  },

  renderLiveCards() {
    const live = appState.dolares.live;

    const elOficial = document.getElementById('dolarOficialValue');
    const elMep = document.getElementById('dolarMepValue');
    const elCcl = document.getElementById('dolarCclValue');
    const elBlueCompra = document.getElementById('dolarBlueCompraValue');
    const elBlueVenta = document.getElementById('dolarBlueVentaValue');
    const elMayorista = document.getElementById('dolarMayoristaValue');
    const elEuro = document.getElementById('euroOficialValue');
    const elReal = document.getElementById('realOficialValue');

    if (elOficial) elOficial.textContent = `$${formatValue(live.oficial)}`;
    if (elMep) elMep.textContent = `$${formatValue(live.mep)}`;
    if (elCcl) elCcl.textContent = `$${formatValue(live.ccl)}`;
    if (elBlueCompra) elBlueCompra.textContent = `$${formatValue(live.blueCompra)}`;
    if (elBlueVenta) elBlueVenta.textContent = `$${formatValue(live.blueVenta)}`;
    if (elMayorista) elMayorista.textContent = `$${formatValue(live.mayorista)}`;
    if (elEuro) elEuro.textContent = `$${formatValue(live.euro)}`;
    if (elReal) elReal.textContent = `$${formatValue(live.real)}`;

    const brechaMep = live.oficial > 0 ? ((live.mep - live.oficial) / live.oficial) * 100 : 0;
    const brechaCcl = live.oficial > 0 ? ((live.ccl - live.oficial) / live.oficial) * 100 : 0;
    const brechaBlue = live.oficial > 0 ? ((live.blueVenta - live.oficial) / live.oficial) * 100 : 0;

    const elBrechaMep = document.getElementById('brechaMepValue');
    const elBrechaCcl = document.getElementById('brechaCclValue');
    const elBrechaBlue = document.getElementById('brechaBlueValue');

    if (elBrechaMep) elBrechaMep.textContent = `Brecha: ${brechaMep.toFixed(1)}%`;
    if (elBrechaCcl) elBrechaCcl.textContent = `Brecha: ${brechaCcl.toFixed(1)}%`;
    if (elBrechaBlue) elBrechaBlue.textContent = `Brecha: ${brechaBlue.toFixed(1)}%`;
  },

  switchView(view) {
    appState.dolares.activeView = view;

    const btnPrices = document.getElementById('btnShowDolarChart');
    const btnBrecha = document.getElementById('btnShowBrechaChart');
    const selectorContainer = document.getElementById('dolarSelectorContainer');

    if (btnPrices) {
      btnPrices.className = 'btn btn-secondary btn-sm';
      btnPrices.style.backgroundColor = '';
    }
    if (btnBrecha) {
      btnBrecha.className = 'btn btn-secondary btn-sm';
      btnBrecha.style.backgroundColor = '';
    }

    if (view === 'prices') {
      if (btnPrices) {
        btnPrices.classList.add('active', 'btn-primary');
        btnPrices.style.backgroundColor = 'var(--theme-dolares)';
      }
      if (selectorContainer) selectorContainer.classList.remove('hidden');
    } else {
      if (btnBrecha) {
        btnBrecha.classList.add('active', 'btn-primary');
        btnBrecha.style.backgroundColor = 'var(--theme-dolares)';
      }
      if (selectorContainer) selectorContainer.classList.add('hidden');
    }

    appState.dolares.tablePage = 1;
    this.renderChart();
  },

  renderChart() {
    const canvas = document.getElementById('dolaresChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const isDark = document.body.classList.contains('dark-theme');
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';

    const mepData = appState.dolares.historical.mep;
    const oficialData = appState.dolares.historical.oficial;
    const blueData = appState.dolares.historical.blue || [];

    if (mepData.length === 0 || oficialData.length === 0) return;

    let filteredMep = [...mepData];
    if (appState.dolares.days !== 'all' && appState.dolares.days !== 'manual') {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - appState.dolares.days);
      const targetStr = targetDate.toISOString().split('T')[0];
      filteredMep = mepData.filter(d => d.date >= targetStr);
      if (filteredMep.length > 0) {
        document.getElementById('dolaresStartDate').value = filteredMep[0].date;
        document.getElementById('dolaresEndDate').value = filteredMep[filteredMep.length - 1].date;
      }
    } else if (appState.dolares.days === 'all') {
      if (mepData.length > 0) {
        document.getElementById('dolaresStartDate').value = mepData[0].date;
        document.getElementById('dolaresEndDate').value = mepData[mepData.length - 1].date;
      }
    } else if (appState.dolares.days === 'manual') {
      const startStr = document.getElementById('dolaresStartDate').value;
      const endStr = document.getElementById('dolaresEndDate').value;
      filteredMep = mepData.filter(d => d.date >= startStr && d.date <= endStr);
    }

    const dates = filteredMep.map(d => d.date);
    const oficialMap = {};
    oficialData.forEach(d => { oficialMap[d.date] = d.value; });

    const blueMap = {};
    blueData.forEach(d => { blueMap[d.date] = { compra: d.compra, venta: d.venta }; });

    this.renderTable(dates, filteredMep, oficialMap, blueMap);

    const labels = dates.map(d => formatDate(d));
    let datasets = [];

    const showOficial = document.getElementById('chkOficial')?.checked ?? true;
    const showMep = document.getElementById('chkMep')?.checked ?? true;
    const showBlueCompra = document.getElementById('chkBlueCompra')?.checked ?? true;
    const showBlueVenta = document.getElementById('chkBlueVenta')?.checked ?? true;

    if (appState.dolares.activeView === 'prices') {
      const mepPrices = filteredMep.map(d => d.value);
      const oficialPrices = dates.map(d => oficialMap[d] || null);
      const blueCompraPrices = dates.map(d => blueMap[d] ? blueMap[d].compra : null);
      const blueVentaPrices = dates.map(d => blueMap[d] ? blueMap[d].venta : null);

      let maxIdxM = -1, minIdxM = -1, maxValM = -Infinity, minValM = Infinity;
      mepPrices.forEach((val, idx) => {
        if (val !== null && !isNaN(val)) {
          if (val > maxValM) { maxValM = val; maxIdxM = idx; }
          if (val < minValM) { minValM = val; minIdxM = idx; }
        }
      });
      const pointRadiiM = mepPrices.map((val, idx) => (idx === maxIdxM || idx === minIdxM) ? 7 : (mepPrices.length > 80 ? 0 : 3.5));
      const pointBgColorsM = mepPrices.map((val, idx) => (idx === maxIdxM || idx === minIdxM) ? '#ffd60a' : '#30d158');
      const pointHoverRadiiM = mepPrices.map((val, idx) => (idx === maxIdxM || idx === minIdxM) ? 9 : 6);

      let maxIdxO = -1, minIdxO = -1, maxValO = -Infinity, minValO = Infinity;
      oficialPrices.forEach((val, idx) => {
        if (val !== null && !isNaN(val)) {
          if (val > maxValO) { maxValO = val; maxIdxO = idx; }
          if (val < minValO) { minValO = val; minIdxO = idx; }
        }
      });
      const pointRadiiO = oficialPrices.map((val, idx) => (idx === maxIdxO || idx === minIdxO) ? 7 : (mepPrices.length > 80 ? 0 : 3));
      const pointBgColorsO = oficialPrices.map((val, idx) => (idx === maxIdxO || idx === minIdxO) ? '#ffd60a' : '#ffffff');
      const pointHoverRadiiO = oficialPrices.map((val, idx) => (idx === maxIdxO || idx === minIdxO) ? 9 : 5);

      let maxIdxBC = -1, minIdxBC = -1, maxValBC = -Infinity, minValBC = Infinity;
      blueCompraPrices.forEach((val, idx) => {
        if (val !== null && !isNaN(val)) {
          if (val > maxValBC) { maxValBC = val; maxIdxBC = idx; }
          if (val < minValBC) { minValBC = val; minIdxBC = idx; }
        }
      });
      const pointRadiiBC = blueCompraPrices.map((val, idx) => (idx === maxIdxBC || idx === minIdxBC) ? 7 : (blueCompraPrices.length > 80 ? 0 : 3));
      const pointBgColorsBC = blueCompraPrices.map((val, idx) => (idx === maxIdxBC || idx === minIdxBC) ? '#ffd60a' : '#0a84ff');
      const pointHoverRadiiBC = blueCompraPrices.map((val, idx) => (idx === maxIdxBC || idx === minIdxBC) ? 9 : 5);

      let maxIdxBV = -1, minIdxBV = -1, maxValBV = -Infinity, minValBV = Infinity;
      blueVentaPrices.forEach((val, idx) => {
        if (val !== null && !isNaN(val)) {
          if (val > maxValBV) { maxValBV = val; maxIdxBV = idx; }
          if (val < minValBV) { minValBV = val; minIdxBV = idx; }
        }
      });
      const pointRadiiBV = blueVentaPrices.map((val, idx) => (idx === maxIdxBV || idx === minIdxBV) ? 7 : (blueVentaPrices.length > 80 ? 0 : 3.5));
      const pointBgColorsBV = blueVentaPrices.map((val, idx) => (idx === maxIdxBV || idx === minIdxBV) ? '#ffd60a' : '#5e5ce6');
      const pointHoverRadiiBV = blueVentaPrices.map((val, idx) => (idx === maxIdxBV || idx === minIdxBV) ? 9 : 6);

      if (showMep) {
        datasets.push({
          label: 'Dólar MEP ($)',
          data: mepPrices,
          borderColor: '#30d158',
          backgroundColor: 'rgba(48, 209, 88, 0.1)',
          fill: true,
          tension: 0.1,
          borderWidth: 2.5,
          pointRadius: pointRadiiM,
          pointBackgroundColor: pointBgColorsM,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointHoverRadius: pointHoverRadiiM,
          maxIdx: maxIdxM,
          minIdx: minIdxM,
          formatLabel: val => '$' + formatValue(val)
        });
      }

      if (showOficial) {
        datasets.push({
          label: 'Dólar Oficial BNA ($)',
          data: oficialPrices,
          borderColor: '#ffffff',
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.1,
          borderWidth: 2,
          pointRadius: pointRadiiO,
          pointBackgroundColor: pointBgColorsO,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointHoverRadius: pointHoverRadiiO,
          maxIdx: maxIdxO,
          minIdx: minIdxO,
          formatLabel: val => '$' + formatValue(val)
        });
      }

      if (showBlueCompra) {
        datasets.push({
          label: 'Dólar Blue Compra ($)',
          data: blueCompraPrices,
          borderColor: '#0a84ff',
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.1,
          borderWidth: 2,
          pointRadius: pointRadiiBC,
          pointBackgroundColor: pointBgColorsBC,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointHoverRadius: pointHoverRadiiBC,
          maxIdx: maxIdxBC,
          minIdx: minIdxBC,
          formatLabel: val => '$' + formatValue(val)
        });
      }

      if (showBlueVenta) {
        datasets.push({
          label: 'Dólar Blue Venta ($)',
          data: blueVentaPrices,
          borderColor: '#5e5ce6',
          backgroundColor: 'rgba(94, 92, 230, 0.1)',
          fill: true,
          tension: 0.1,
          borderWidth: 2.5,
          pointRadius: pointRadiiBV,
          pointBackgroundColor: pointBgColorsBV,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointHoverRadius: pointHoverRadiiBV,
          maxIdx: maxIdxBV,
          minIdx: minIdxBV,
          formatLabel: val => '$' + formatValue(val)
        });
      }
    } else {
      const brechaData = filteredMep.map(d => {
        const oficialPrice = oficialMap[d.date];
        if (oficialPrice > 0) {
          return ((d.value - oficialPrice) / oficialPrice) * 100;
        }
        return null;
      });

      let maxIdx = -1, minIdx = -1, maxVal = -Infinity, minVal = Infinity;
      brechaData.forEach((val, idx) => {
        if (val !== null && !isNaN(val)) {
          if (val > maxVal) { maxVal = val; maxIdx = idx; }
          if (val < minVal) { minVal = val; minIdx = idx; }
        }
      });

      const pointRadii = brechaData.map((val, idx) => (idx === maxIdx || idx === minIdx) ? 7 : (brechaData.length > 80 ? 0 : 3.5));
      const pointBgColors = brechaData.map((val, idx) => (idx === maxIdx || idx === minIdx) ? '#ffd60a' : '#ffd60a');
      const pointHoverRadii = brechaData.map((val, idx) => (idx === maxIdx || idx === minIdx) ? 9 : 6);

      datasets = [
        {
          label: 'Brecha Cambiaria (%)',
          data: brechaData,
          borderColor: '#ffd60a',
          backgroundColor: 'rgba(255, 214, 10, 0.15)',
          fill: true,
          tension: 0.1,
          borderWidth: 2,
          pointRadius: pointRadii,
          pointBackgroundColor: pointBgColors,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1.5,
          pointHoverRadius: pointHoverRadii,
          maxIdx: maxIdx,
          minIdx: minIdx,
          formatLabel: val => val.toFixed(1) + '%'
        }
      ];
    }

    if (appState.dolares.chart) {
      appState.dolares.chart.data.labels = labels;
      appState.dolares.chart.data.datasets = datasets;
      appState.dolares.chart.update('active');
      return;
    }

    appState.dolares.chart = new Chart(ctx, {
      type: 'line',
      plugins: [maxMinLabelPlugin],
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, labels: { color: textColor } },
          tooltip: {
            backgroundColor: isDark ? '#0f172a' : '#ffffff',
            titleColor: isDark ? '#f8fafc' : '#0f172a',
            bodyColor: isDark ? '#94a3b8' : '#64748b',
            borderColor: gridColor,
            borderWidth: 1,
            callbacks: {
              label: function(context) {
                let labelText = ` ${context.dataset.label}: ${context.raw ? context.raw.toFixed(2) : '-'} `;
                const maxIdx = context.dataset.maxIdx;
                const minIdx = context.dataset.minIdx;
                if (context.dataIndex === maxIdx) labelText += ' 📈 (MÁX)';
                if (context.dataIndex === minIdx) labelText += ' 📉 (MÍN)';
                return labelText;
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: textColor, maxTicksLimit: 10 } },
          y: { grid: { color: gridColor }, ticks: { color: textColor } }
        }
      }
    });

    registerChart(appState.dolares.chart);
  },

  changeTablePage(direction) {
    appState.dolares.tablePage += direction;
    this.renderTable();
  },

  renderTable(dates, filteredMep, oficialMap, blueMap) {
    if (!dates || !filteredMep || !oficialMap || !blueMap) {
      dates = appState.dolares.currentDates || [];
      filteredMep = appState.dolares.currentMep || [];
      oficialMap = appState.dolares.currentOficialMap || {};
      blueMap = appState.dolares.currentBlueMap || {};
    } else {
      appState.dolares.currentDates = dates;
      appState.dolares.currentMep = filteredMep;
      appState.dolares.currentOficialMap = oficialMap;
      appState.dolares.currentBlueMap = blueMap;
    }

    const tbody = document.getElementById('dolaresTableBody');
    const paginationInfo = document.getElementById('dolaresPaginationInfo');
    const btnPrev = document.getElementById('btnPrevDolaresPage');
    const btnNext = document.getElementById('btnNextDolaresPage');

    if (!tbody) return;
    tbody.innerHTML = '';

    if (dates.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center">No hay registros para mostrar.</td></tr>';
      if (paginationInfo) paginationInfo.textContent = 'Mostrando 0-0 de 0 registros';
      if (btnPrev) btnPrev.disabled = true;
      if (btnNext) btnNext.disabled = true;
      return;
    }

    const sortedDates = [...dates].reverse();
    const total = sortedDates.length;
    const pageSize = appState.dolares.tablePageSize;
    const totalPages = Math.ceil(total / pageSize);

    if (appState.dolares.tablePage > totalPages) appState.dolares.tablePage = totalPages;
    if (appState.dolares.tablePage < 1) appState.dolares.tablePage = 1;

    const startIndex = (appState.dolares.tablePage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, total);
    const pageDates = sortedDates.slice(startIndex, endIndex);

    const fullMep = appState.dolares.historical.mep;
    const fullOficial = appState.dolares.historical.oficial;

    const mepIndexMap = new Map();
    fullMep.forEach((d, idx) => mepIndexMap.set(d.date, idx));
    const oficialIndexMap = new Map();
    fullOficial.forEach((d, idx) => oficialIndexMap.set(d.date, idx));
    const filteredMepMap = new Map();
    filteredMep.forEach(d => filteredMepMap.set(d.date, d.value));

    pageDates.forEach(date => {
      const mepVal = filteredMepMap.get(date) || null;
      const oficialVal = oficialMap[date] || null;

      const blueItem = blueMap[date] || null;
      const blueCompraVal = blueItem ? blueItem.compra : null;
      const blueVentaVal = blueItem ? blueItem.venta : null;

      let mepVarText = '-';
      let mepVarClass = '';
      if (mepVal !== null) {
        const fullIdx = mepIndexMap.get(date);
        if (fullIdx !== undefined && fullIdx > 0) {
          const prevVal = fullMep[fullIdx - 1].value;
          const diff = mepVal - prevVal;
          const diffPct = (diff / prevVal) * 100;
          mepVarText = `${diff >= 0 ? '+' : ''}${diffPct.toFixed(2)}%`;
          mepVarClass = diff > 0 ? 'text-success' : (diff < 0 ? 'text-danger' : '');
        }
      }

      let oficialVarText = '-';
      let oficialVarClass = '';
      if (oficialVal !== null) {
        const fullIdx = oficialIndexMap.get(date);
        if (fullIdx !== undefined && fullIdx > 0) {
          const prevVal = fullOficial[fullIdx - 1].value;
          const diff = oficialVal - prevVal;
          const diffPct = (diff / prevVal) * 100;
          oficialVarText = `${diff >= 0 ? '+' : ''}${diffPct.toFixed(2)}%`;
          oficialVarClass = diff > 0 ? 'text-success' : (diff < 0 ? 'text-danger' : '');
        }
      }

      let brechaMepText = '-';
      if (mepVal !== null && oficialVal > 0) {
        const brechaVal = ((mepVal - oficialVal) / oficialVal) * 100;
        brechaMepText = `${brechaVal.toFixed(2)}%`;
      }

      let brechaBlueText = '-';
      if (blueVentaVal !== null && oficialVal > 0) {
        const brechaVal = ((blueVentaVal - oficialVal) / oficialVal) * 100;
        brechaBlueText = `${brechaVal.toFixed(2)}%`;
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${formatDate(date)}</td>
        <td class="text-right font-medium">${mepVal ? formatValue(mepVal) : '-'}</td>
        <td class="text-right ${mepVarClass}">${mepVarText}</td>
        <td class="text-right font-medium">${oficialVal ? formatValue(oficialVal) : '-'}</td>
        <td class="text-right font-medium text-info" style="color: #0a84ff;">${blueCompraVal ? formatValue(blueCompraVal) : '-'}</td>
        <td class="text-right font-medium" style="color: #bf5af2;">${blueVentaVal ? formatValue(blueVentaVal) : '-'}</td>
        <td class="text-right font-medium" style="color: var(--theme-dolares);">${brechaMepText}</td>
        <td class="text-right font-medium" style="color: #ffd60a;">${brechaBlueText}</td>
      `;
      tbody.appendChild(tr);
    });

    if (paginationInfo) paginationInfo.textContent = `Mostrando ${startIndex + 1}-${endIndex} de ${total} registros`;
    if (btnPrev) btnPrev.disabled = appState.dolares.tablePage <= 1;
    if (btnNext) btnNext.disabled = endIndex >= total;
  },

  exportToCsv() {
    const dates = appState.dolares.currentDates || [];
    const filteredMep = appState.dolares.currentMep || [];
    const oficialMap = appState.dolares.currentOficialMap || {};
    const blueMap = appState.dolares.currentBlueMap || {};

    if (dates.length === 0) {
      showToast('No hay datos para exportar.', 'warning');
      return;
    }

    const showOficial = document.getElementById('chkOficial')?.checked ?? true;
    const showMep = document.getElementById('chkMep')?.checked ?? true;
    const showBlueCompra = document.getElementById('chkBlueCompra')?.checked ?? true;
    const showBlueVenta = document.getElementById('chkBlueVenta')?.checked ?? true;

    if (!showOficial && !showMep && !showBlueCompra && !showBlueVenta) {
      showToast('Debes seleccionar al menos un tipo de dólar para exportar.', 'warning');
      return;
    }

    const fullMep = appState.dolares.historical.mep;
    const fullOficial = appState.dolares.historical.oficial;
    const mepIndexMap = new Map();
    fullMep.forEach((d, idx) => mepIndexMap.set(d.date, idx));
    const oficialIndexMap = new Map();
    fullOficial.forEach((d, idx) => oficialIndexMap.set(d.date, idx));
    const filteredMepMap = new Map();
    filteredMep.forEach(d => filteredMepMap.set(d.date, d.value));

    let csvHeader = "Fecha";
    if (showMep) csvHeader += ";Dolar MEP;Variacion MEP %;Brecha MEP %";
    if (showOficial) csvHeader += ";Dolar Oficial BNA;Variacion Oficial %";
    if (showBlueCompra) csvHeader += ";Dolar Blue Compra";
    if (showBlueVenta) csvHeader += ";Dolar Blue Venta;Brecha Blue %";
    csvHeader += "\n";

    let csvContent = csvHeader;

    dates.forEach(date => {
      let row = formatDate(date);

      if (showMep) {
        const mepVal = filteredMepMap.get(date) || null;
        const oficialVal = oficialMap[date] || null;
        let mepVarText = '-';
        if (mepVal !== null) {
          const fullIdx = mepIndexMap.get(date);
          if (fullIdx !== undefined && fullIdx > 0) {
            const prevVal = fullMep[fullIdx - 1].value;
            const diff = mepVal - prevVal;
            const diffPct = (diff / prevVal) * 100;
            mepVarText = `${diff >= 0 ? '+' : ''}${diffPct.toFixed(2)}%`;
          }
        }
        let brechaMepText = '-';
        if (mepVal !== null && oficialVal > 0) {
          brechaMepText = `${(((mepVal - oficialVal) / oficialVal) * 100).toFixed(2)}%`;
        }
        const mepValStr = mepVal ? String(mepVal.toFixed(2)).replace('.', ',') : '-';
        row += `;${mepValStr};${mepVarText};${brechaMepText}`;
      }

      if (showOficial) {
        const oficialVal = oficialMap[date] || null;
        let oficialVarText = '-';
        if (oficialVal !== null) {
          const fullIdx = oficialIndexMap.get(date);
          if (fullIdx !== undefined && fullIdx > 0) {
            const prevVal = fullOficial[fullIdx - 1].value;
            const diff = oficialVal - prevVal;
            const diffPct = (diff / prevVal) * 100;
            oficialVarText = `${diff >= 0 ? '+' : ''}${diffPct.toFixed(2)}%`;
          }
        }
        const oficialValStr = oficialVal ? String(oficialVal.toFixed(2)).replace('.', ',') : '-';
        row += `;${oficialValStr};${oficialVarText}`;
      }

      if (showBlueCompra) {
        const blueItem = blueMap[date] || null;
        const blueCompraVal = blueItem ? blueItem.compra : null;
        const blueCompraValStr = blueCompraVal ? String(blueCompraVal.toFixed(2)).replace('.', ',') : '-';
        row += `;${blueCompraValStr}`;
      }

      if (showBlueVenta) {
        const blueItem = blueMap[date] || null;
        const blueVentaVal = blueItem ? blueItem.venta : null;
        const oficialVal = oficialMap[date] || null;
        let brechaBlueText = '-';
        if (blueVentaVal !== null && oficialVal > 0) {
          brechaBlueText = `${(((blueVentaVal - oficialVal) / oficialVal) * 100).toFixed(2)}%`;
        }
        const blueVentaValStr = blueVentaVal ? String(blueVentaVal.toFixed(2)).replace('.', ',') : '-';
        row += `;${blueVentaValStr};${brechaBlueText}`;
      }

      csvContent += row + "\n";
    });

    downloadBlob(csvContent, `mercado_cambios_${dates[0]}_a_${dates[dates.length - 1]}.csv`, 'text/csv;charset=utf-8;');
  }
};
