/**
 * tabComparador.js
 * Controlador de la pestaña de Comparador Bancario y Financiero:
 * Régimen de Transparencia del BCRA: Plazos fijos digitales a 30 días,
 * comisiones de mantenimiento de cajas de ahorro y tarjetas de crédito,
 * préstamos personales, Billeteras Virtuales & Cuentas Remuneradas Fintech,
 * y Préstamos Hipotecarios UVA (tasas clientes vs no clientes, requisitos, plazos y simulador).
 */

import { fetchPlazosFijos, fetchComisiones, fetchPrestamos, fetchHipotecarios } from './api.js';
import { clientCache, appState } from './state.js';
import { formatValue, debounce } from './utils.js';
import { tabCripto } from './tabCripto.js';

export const tabComparador = {
  initialized: false,
  activeTab: 'plazosFijos', // 'plazosFijos', 'comisiones', 'prestamos', 'cuentasRemuneradas', 'hipotecarios'
  hipoFilter: 'todos',

  async init() {
    if (this.initialized) {
      this.render();
      return;
    }

    const btnPf = document.getElementById('btnShowPlazosFijos');
    const btnCom = document.getElementById('btnShowComisiones');
    const btnPrest = document.getElementById('btnShowPrestamos');
    const btnRem = document.getElementById('btnShowCuentasRemuneradas');
    const btnHipo = document.getElementById('btnShowHipotecarios');

    if (btnPf) btnPf.addEventListener('click', () => this.switchSubTab('plazosFijos'));
    if (btnCom) btnCom.addEventListener('click', () => this.switchSubTab('comisiones'));
    if (btnPrest) btnPrest.addEventListener('click', () => this.switchSubTab('prestamos'));
    if (btnRem) btnRem.addEventListener('click', () => this.switchSubTab('cuentasRemuneradas'));
    if (btnHipo) btnHipo.addEventListener('click', () => this.switchSubTab('hipotecarios'));

    const searchInput = document.getElementById('bankSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', debounce(() => this.render(), 150));
    }

    // Eventos del Simulador Hipotecario
    const hipoPropiedadInput = document.getElementById('hipoValorPropiedad');
    const hipoLtvSelect = document.getElementById('hipoLtvSelect');
    const hipoPlazoSelect = document.getElementById('hipoPlazoSelect');
    const hipoCondicionSelect = document.getElementById('hipoCondicionSelect');

    if (hipoPropiedadInput) hipoPropiedadInput.addEventListener('input', debounce(() => this.recalculateSimulator(), 100));
    if (hipoLtvSelect) hipoLtvSelect.addEventListener('change', () => this.recalculateSimulator());
    if (hipoPlazoSelect) hipoPlazoSelect.addEventListener('change', () => this.recalculateSimulator());
    if (hipoCondicionSelect) hipoCondicionSelect.addEventListener('change', () => this.recalculateSimulator());

    // Filtros rápidos de la tabla hipotecaria
    const filterContainer = document.getElementById('hipoTableFilters');
    if (filterContainer) {
      filterContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.range-btn');
        if (!btn) return;
        filterContainer.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.hipoFilter = btn.getAttribute('data-filter') || 'todos';
        this.renderHipotecarios(document.getElementById('bankSearchInput')?.value.toLowerCase().trim() || '');
      });
    }

    // Modal de requisitos
    const btnCloseModal = document.getElementById('btnCloseHipoModal');
    const modal = document.getElementById('hipoRequisitosModal');
    if (btnCloseModal && modal) {
      btnCloseModal.addEventListener('click', () => modal.classList.add('hidden'));
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
      });
    }

    await this.fetchData();
    this.recalculateSimulator();
    this.initialized = true;
  },

  switchSubTab(tab) {
    this.activeTab = tab;
    appState.comparador.activeTab = tab;

    const tabs = ['plazosFijos', 'comisiones', 'prestamos', 'cuentasRemuneradas', 'hipotecarios'];
    const tabBtns = {
      plazosFijos: document.getElementById('btnShowPlazosFijos'),
      comisiones: document.getElementById('btnShowComisiones'),
      prestamos: document.getElementById('btnShowPrestamos'),
      cuentasRemuneradas: document.getElementById('btnShowCuentasRemuneradas'),
      hipotecarios: document.getElementById('btnShowHipotecarios')
    };

    tabs.forEach(t => {
      const btn = tabBtns[t];
      const view = document.getElementById(`subview${t.charAt(0).toUpperCase() + t.slice(1)}`);
      if (t === tab) {
        if (btn) btn.classList.add('active');
        if (view) view.classList.remove('hidden');
      } else {
        if (btn) btn.classList.remove('active');
        if (view) view.classList.add('hidden');
      }
    });

    this.render();
  },

  async fetchData() {
    const cached = clientCache.get('transparencia_comparador');
    if (cached) {
      appState.comparador.plazosFijos = cached.plazosFijos || [];
      appState.comparador.comisiones = cached.comisiones || [];
      appState.comparador.prestamos = cached.prestamos || [];
      appState.comparador.hipotecarios = cached.hipotecarios || [];
      appState.comparador.valorUva = cached.valorUva || 2196.12;
      this.render();
      return;
    }

    const loader = document.getElementById('loadingComparadorOverlay');
    if (loader) loader.classList.remove('hidden');

    // 1. Plazos Fijos
    try {
      const pfData = await fetchPlazosFijos();
      const rawList = pfData.results || pfData.data || pfData;
      if (Array.isArray(rawList) && rawList.length > 0) {
        appState.comparador.plazosFijos = rawList;
      } else {
        throw new Error('Datos vacíos de plazos fijos');
      }
    } catch (e) {
      console.warn('Usando contingencia para plazos fijos del comparador:', e.message);
      appState.comparador.plazosFijos = this.getMockPlazosFijos();
    }

    // 2. Comisiones
    try {
      const comData = await fetchComisiones();
      const rawList = comData.results || comData.data || comData;
      if (Array.isArray(rawList) && rawList.length > 0) {
        appState.comparador.comisiones = rawList;
      } else {
        throw new Error('Datos vacíos de comisiones');
      }
    } catch (e) {
      console.warn('Usando contingencia para comisiones bancarias:', e.message);
      appState.comparador.comisiones = this.getMockComisiones();
    }

    // 3. Préstamos
    try {
      const prestData = await fetchPrestamos();
      const rawList = prestData.results || prestData.data || prestData;
      if (Array.isArray(rawList) && rawList.length > 0) {
        appState.comparador.prestamos = rawList;
      } else {
        throw new Error('Datos vacíos de préstamos');
      }
    } catch (e) {
      console.warn('Usando contingencia para préstamos personales:', e.message);
      appState.comparador.prestamos = this.getMockPrestamos();
    }

    // 4. Préstamos Hipotecarios UVA
    try {
      const hipoData = await fetchHipotecarios();
      const rawList = hipoData.results || hipoData.data || hipoData;
      if (Array.isArray(rawList) && rawList.length > 0) {
        appState.comparador.hipotecarios = rawList;
        if (hipoData.valorUvaReferencia) {
          appState.comparador.valorUva = hipoData.valorUvaReferencia;
        }
      } else {
        throw new Error('Datos vacíos de hipotecarios');
      }
    } catch (e) {
      console.warn('Usando contingencia para préstamos hipotecarios UVA:', e.message);
      appState.comparador.hipotecarios = this.getMockHipotecarios();
    }

    clientCache.set('transparencia_comparador', {
      plazosFijos: appState.comparador.plazosFijos,
      comisiones: appState.comparador.comisiones,
      prestamos: appState.comparador.prestamos,
      hipotecarios: appState.comparador.hipotecarios,
      valorUva: appState.comparador.valorUva
    }, 5 * 60 * 1000);

    if (loader) loader.classList.add('hidden');
    this.render();
  },

  render() {
    const filterInput = document.getElementById('bankSearchInput');
    const filterText = filterInput ? filterInput.value.toLowerCase().trim() : '';

    if (this.activeTab === 'plazosFijos') {
      this.renderPlazosFijos(filterText);
    } else if (this.activeTab === 'comisiones') {
      this.renderComisiones(filterText);
    } else if (this.activeTab === 'prestamos') {
      this.renderPrestamos(filterText);
    } else if (this.activeTab === 'cuentasRemuneradas') {
      tabCripto.loadRendimientos(filterText);
    } else if (this.activeTab === 'hipotecarios') {
      this.renderHipotecarios(filterText);
    }
  },

  renderPlazosFijos(filterText) {
    const tbody = document.getElementById('plazosFijosTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const list = appState.comparador.plazosFijos.filter(item => {
      const name = (item.descripcionEntidad || item.entidad || item.descripcion || '').toLowerCase();
      return name.includes(filterText);
    });

    list.sort((a, b) => {
      const valB = parseFloat(b.tasaEfectivaAnualMinima || b.tna || 0);
      const valA = parseFloat(a.tasaEfectivaAnualMinima || a.tna || 0);
      return valB - valA;
    });

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center">No se encontraron entidades registradas.</td></tr>';
      return;
    }

    list.forEach(item => {
      const tna = parseFloat(item.tasaEfectivaAnualMinima || item.tna || 0);
      const rendimientoDirecto = tna / 12;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="font-medium">${item.descripcionEntidad || item.entidad || item.descripcion || 'Entidad no informada'}</td>
        <td class="text-right font-medium text-success" style="font-size: 14.5px;">${tna.toFixed(2)}%</td>
        <td class="text-right">${rendimientoDirecto.toFixed(2)}%</td>
        <td class="text-right" style="color: var(--text-secondary);">${item.canalConstitucion || item.canal || 'Digital / Home Banking'}</td>
      `;
      tbody.appendChild(tr);
    });
  },

  renderComisiones(filterText) {
    const tbody = document.getElementById('comisionesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const list = appState.comparador.comisiones.filter(item => {
      const name = (item.descripcionEntidad || item.entidad || item.descripcion || '').toLowerCase();
      return name.includes(filterText);
    });

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center">No se encontraron productos registrados.</td></tr>';
      return;
    }

    list.forEach(item => {
      const mensual = parseFloat(item.comisionMaximaMantenimiento || item.mensual || item.mantenimiento || 0);
      const anual = parseFloat(item.anual || item.renovacion || 0);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="font-medium">${item.descripcionEntidad || item.entidad || 'Banco Comercial'}</td>
        <td>${item.nombreCompleto || item.nombreCorto || item.producto || item.paquete || 'Servicio de Cuentas / Paquete'}</td>
        <td class="text-right font-medium">${mensual > 0 ? '$' + formatValue(mensual) : 'Bonificado / Gratis'}</td>
        <td class="text-right">${anual > 0 ? '$' + formatValue(anual) : 'Gratis / N/A'}</td>
      `;
      tbody.appendChild(tr);
    });
  },

  renderPrestamos(filterText) {
    const tbody = document.getElementById('prestamosTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const list = appState.comparador.prestamos.filter(item => {
      const name = (item.descripcionEntidad || item.entidad || item.descripcion || '').toLowerCase();
      return name.includes(filterText);
    });

    list.sort((a, b) => {
      const valA = parseFloat(a.tasaEfectivaAnualMaxima || a.tna || a.tnaPromedio || 0);
      const valB = parseFloat(b.tasaEfectivaAnualMaxima || b.tna || b.tnaPromedio || 0);
      return valA - valB;
    });

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center">No se encontraron líneas de préstamos.</td></tr>';
      return;
    }

    list.forEach(item => {
      const tna = parseFloat(item.tasaEfectivaAnualMaxima || item.tna || item.tnaPromedio || 0);
      const cft = parseFloat(item.costoFinancieroEfectivoTotalMaximo || item.cft || item.cftMaximo || 0);
      const plazoVal = item.plazoMaximoOtorgable ? `${item.plazoMaximoOtorgable} meses` : (item.plazo || 'Hasta 60 meses');
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="font-medium">${item.descripcionEntidad || item.entidad || 'Entidad Financiera'}</td>
        <td class="text-right font-medium text-warning">${tna.toFixed(2)}%</td>
        <td class="text-right font-medium text-danger">${cft > 0 ? cft.toFixed(2) + '%' : '-'}</td>
        <td class="text-right" style="color: var(--text-secondary);">${plazoVal}</td>
      `;
      tbody.appendChild(tr);
    });
  },

  getMockPlazosFijos() {
    return [
      { entidad: 'Banco de la Nación Argentina', tna: 37.0, canal: 'Home Banking / BIP' },
      { entidad: 'Banco de la Provincia de Buenos Aires', tna: 37.0, canal: 'BIP / App BIP' },
      { entidad: 'Banco de Galicia y Buenos Aires', tna: 36.0, canal: 'Home Banking Galicia' },
      { entidad: 'Banco Macro S.A.', tna: 36.5, canal: 'Banca Internet Macro' },
      { entidad: 'Banco Santander Argentina S.A.', tna: 35.5, canal: 'App Santander' },
      { entidad: 'BBVA Argentina', tna: 35.0, canal: 'Banca Net BBVA' },
      { entidad: 'Banco Credicoop Cooperativo Limitado', tna: 36.0, canal: 'Banca Internet Credicoop' },
      { entidad: 'Banco de la Ciudad de Buenos Aires', tna: 35.0, canal: 'Home Banking Ciudad' },
      { entidad: 'Banco Supervielle S.A.', tna: 36.25, canal: 'Supervielle Móvil' },
      { entidad: 'Banco Patagonia S.A.', tna: 35.5, canal: 'Patagonia e-Bank' },
      { entidad: 'HSBC Bank Argentina S.A.', tna: 34.5, canal: 'Online Banking HSBC' },
      { entidad: 'ICBC Argentina', tna: 34.0, canal: 'Access Banking ICBC' }
    ];
  },

  getMockComisiones() {
    return [
      { entidad: 'Banco de la Nación Argentina', producto: 'Caja de Ahorro Pesos Extra', mensual: 0, anual: 0 },
      { entidad: 'Banco de la Nación Argentina', producto: 'Paquete Nación Simple', mensual: 4500, anual: 0 },
      { entidad: 'Banco de Galicia y Buenos Aires', producto: 'Paquete Classic Galicia', mensual: 9800, anual: 45000 },
      { entidad: 'Banco Santander Argentina S.A.', producto: 'Paquete Supercuenta 3', mensual: 9500, anual: 42000 },
      { entidad: 'BBVA Argentina', producto: 'Paquete Classic BBVA', mensual: 9200, anual: 41000 },
      { entidad: 'Banco Macro S.A.', producto: 'Paquete Valora Inicial', mensual: 8900, anual: 38000 },
      { entidad: 'Banco de la Provincia de Buenos Aires', producto: 'Paquete Provincia Ahorro', mensual: 5200, anual: 15000 },
      { entidad: 'Banco Credicoop', producto: 'Paquete Credicoop Básico', mensual: 6200, anual: 22000 },
      { entidad: 'Banco Supervielle S.A.', producto: 'Paquete Familia Supervielle', mensual: 8500, anual: 35000 },
      { entidad: 'Banco Patagonia S.A.', producto: 'Paquete Patagonia Activa', mensual: 8800, anual: 36000 }
    ];
  },

  getMockPrestamos() {
    return [
      { entidad: 'Banco de la Nación Argentina', tnaPromedio: 55.0, cftMaximo: 72.5, plazo: 'Hasta 72 meses' },
      { entidad: 'Banco de la Provincia de Buenos Aires', tnaPromedio: 58.0, cftMaximo: 75.2, plazo: 'Hasta 60 meses' },
      { entidad: 'Banco Credicoop', tnaPromedio: 60.0, cftMaximo: 78.5, plazo: 'Hasta 60 meses' },
      { entidad: 'BBVA Argentina', tnaPromedio: 64.0, cftMaximo: 86.4, plazo: 'Hasta 60 meses' },
      { entidad: 'Banco de Galicia y Buenos Aires', tnaPromedio: 65.0, cftMaximo: 88.0, plazo: 'Hasta 60 meses' },
      { entidad: 'Banco Santander Argentina S.A.', tnaPromedio: 66.0, cftMaximo: 89.5, plazo: 'Hasta 72 meses' },
      { entidad: 'Banco Supervielle S.A.', tnaPromedio: 67.5, cftMaximo: 91.0, plazo: 'Hasta 48 meses' },
      { entidad: 'Banco Macro S.A.', tnaPromedio: 68.0, cftMaximo: 92.1, plazo: 'Hasta 60 meses' }
    ];
  },

  recalculateSimulator() {
    const valorPropiedadUsd = parseFloat(document.getElementById('hipoValorPropiedad')?.value) || 80000;
    const ltv = parseFloat(document.getElementById('hipoLtvSelect')?.value) || 75;
    const plazoAnos = parseInt(document.getElementById('hipoPlazoSelect')?.value, 10) || 20;
    const condicion = document.getElementById('hipoCondicionSelect')?.value || 'cliente';

    const mepPrice = (appState.dolares && appState.dolares.live && appState.dolares.live.mep > 0) ? appState.dolares.live.mep : 1570;
    const valorUva = (appState.comparador && appState.comparador.valorUva) || 2196.12;

    const valorPropiedadPesos = valorPropiedadUsd * mepPrice;
    const montoPrestamoPesos = valorPropiedadPesos * (ltv / 100);
    const montoPrestamoUvas = montoPrestamoPesos / valorUva;

    const anticipoPesos = valorPropiedadPesos * (1 - (ltv / 100));
    const anticipoUsd = valorPropiedadUsd * (1 - (ltv / 100));

    // Tasa benchmark promedio de mercado según condición
    const tnaBenchmark = condicion === 'cliente' ? 5.5 : 8.0;
    const rMensual = (tnaBenchmark / 100) / 12;
    const totalMeses = plazoAnos * 12;

    // Cuota en UVAs (Amortización Francesa)
    const factor = Math.pow(1 + rMensual, totalMeses);
    const cuotaUvas = factor > 1 ? montoPrestamoUvas * ((rMensual * factor) / (factor - 1)) : 0;
    const cuotaPesos = cuotaUvas * valorUva;
    const ingresoRequeridoPesos = cuotaPesos / 0.25;

    // Actualizar DOM
    const elSubtextPesos = document.getElementById('hipoValorPesosSubtext');
    if (elSubtextPesos) elSubtextPesos.textContent = `Aprox. $${formatValue(valorPropiedadPesos)} (Dólar MEP $${formatValue(mepPrice)})`;

    const elMontoPrestamo = document.getElementById('simMontoPrestamo');
    if (elMontoPrestamo) elMontoPrestamo.textContent = `$${formatValue(montoPrestamoPesos)}`;

    const elMontoUvas = document.getElementById('simMontoUvas');
    if (elMontoUvas) elMontoUvas.textContent = `~${formatValue(Math.round(montoPrestamoUvas))} UVAs (USD ${formatValue(valorPropiedadUsd * (ltv / 100))})`;

    const elAnticipo = document.getElementById('simAnticipo');
    if (elAnticipo) elAnticipo.textContent = `$${formatValue(anticipoPesos)}`;

    const elAnticipoUsd = document.getElementById('simAnticipoUsd');
    if (elAnticipoUsd) elAnticipoUsd.textContent = `USD ${formatValue(anticipoUsd)} (${100 - ltv}%)`;

    const elCuota = document.getElementById('simCuotaInicial');
    if (elCuota) elCuota.textContent = `$${formatValue(Math.round(cuotaPesos))} / mes`;

    const elCuotaUvas = document.getElementById('simCuotaUvas');
    if (elCuotaUvas) elCuotaUvas.textContent = `~${formatValue(Math.round(cuotaUvas))} UVAs (TNA ref. ${tnaBenchmark.toFixed(2)}%)`;

    const elIngreso = document.getElementById('simIngresoRequerido');
    if (elIngreso) elIngreso.textContent = `$${formatValue(Math.round(ingresoRequeridoPesos))} / mes`;

    // Re-renderizar tabla para actualizar la columna "Cuota Sim. ($)" por cada banco
    if (this.activeTab === 'hipotecarios') {
      const filterText = document.getElementById('bankSearchInput')?.value.toLowerCase().trim() || '';
      this.renderHipotecarios(filterText);
    }
  },

  renderHipotecarios(filterText = '') {
    const tbody = document.getElementById('hipotecariosTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const list = (appState.comparador.hipotecarios || []).filter(item => {
      const name = (item.entidad || item.linea || '').toLowerCase();
      const matchText = name.includes(filterText);
      if (!matchText) return false;

      if (this.hipoFilter === '30' && item.plazoMaxAnos < 30) return false;
      if (this.hipoFilter === '80' && item.ltvMax < 80) return false;

      return true;
    });

    list.sort((a, b) => {
      const valA = parseFloat(a.tnaClientes || 0);
      const valB = parseFloat(b.tnaClientes || 0);
      return valA - valB;
    });

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center">No se encontraron líneas hipotecarias que coincidan con la búsqueda o filtro.</td></tr>';
      return;
    }

    const valorPropiedadUsd = parseFloat(document.getElementById('hipoValorPropiedad')?.value) || 80000;
    const ltv = parseFloat(document.getElementById('hipoLtvSelect')?.value) || 75;
    const plazoAnos = parseInt(document.getElementById('hipoPlazoSelect')?.value, 10) || 20;
    const condicion = document.getElementById('hipoCondicionSelect')?.value || 'cliente';
    const mepPrice = (appState.dolares && appState.dolares.live && appState.dolares.live.mep > 0) ? appState.dolares.live.mep : 1570;
    const valorUva = (appState.comparador && appState.comparador.valorUva) || 2196.12;

    const valorPropiedadPesos = valorPropiedadUsd * mepPrice;
    const montoPrestamoPesos = valorPropiedadPesos * (ltv / 100);
    const montoPrestamoUvas = montoPrestamoPesos / valorUva;

    list.forEach(item => {
      // Calcular cuota personalizada para cada banco
      const tnaBanco = condicion === 'cliente' ? item.tnaClientes : item.tnaNoClientes;
      const rMensual = (tnaBanco / 100) / 12;
      const mesesEfectivos = Math.min(plazoAnos, item.plazoMaxAnos) * 12;
      const factor = Math.pow(1 + rMensual, mesesEfectivos);
      const cuotaUvasBanco = factor > 1 ? montoPrestamoUvas * ((rMensual * factor) / (factor - 1)) : 0;
      const cuotaPesosBanco = cuotaUvasBanco * valorUva;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="hipo-bank-name">${item.entidad}</div>
          <div class="hipo-bank-tag">
            <i class="fa-solid fa-tag"></i> ${item.destacado || item.linea}
          </div>
        </td>
        <td class="text-right font-medium hipo-tna-clientes">${item.tnaClientesTexto || 'UVA + ' + item.tnaClientes.toFixed(2) + '%'}</td>
        <td class="text-right font-medium hipo-tna-noclients">${item.tnaNoClientesTexto || 'UVA + ' + item.tnaNoClientes.toFixed(2) + '%'}</td>
        <td class="text-right font-medium">${item.plazoMaxAnos} años</td>
        <td class="text-right font-medium">${item.ltvMax}%</td>
        <td class="text-right" style="font-size: 12px; color: var(--text-secondary); max-width: 140px;">${item.montoMaximoTexto}</td>
        <td class="text-right font-medium">${item.relacionCuotaIngreso}%</td>
        <td class="text-right hipo-cuota-sim">$${formatValue(Math.round(cuotaPesosBanco))}</td>
        <td class="text-center">
          <button class="btn btn-sm btn-secondary btn-ver-requisitos" data-id="${item.id}" style="padding: 4px 10px; font-size: 12px; border-radius: 6px;">
            <i class="fa-solid fa-list-check"></i> Requisitos
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Delegación de eventos para el botón de requisitos
    tbody.querySelectorAll('.btn-ver-requisitos').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        this.showHipotecarioModal(id);
      });
    });
  },

  showHipotecarioModal(bankId) {
    const bank = (appState.comparador.hipotecarios || []).find(b => b.id === bankId);
    if (!bank) return;

    const modal = document.getElementById('hipoRequisitosModal');
    const titleEl = document.getElementById('modalHipoBancoNombre');
    const lineEl = document.getElementById('modalHipoLineaNombre');
    const contentEl = document.getElementById('modalHipoDetallesContent');

    if (!modal || !contentEl) return;

    if (titleEl) titleEl.textContent = bank.entidad;
    if (lineEl) lineEl.textContent = `${bank.linea} (${bank.tipo})`;

    contentEl.innerHTML = `
      <div class="hipo-modal-section">
        <div class="hipo-modal-section-gold"><i class="fa-solid fa-percent"></i> Tasas y Condiciones Financieras</div>
        <div><strong>Clientes (Haberes):</strong> ${bank.tnaClientesTexto || 'UVA + ' + bank.tnaClientes.toFixed(2) + '%'}</div>
        <div><strong>Mercado Abierto (No Clientes):</strong> ${bank.tnaNoClientesTexto || 'UVA + ' + bank.tnaNoClientes.toFixed(2) + '%'}</div>
        <div><strong>Plazo Máximo:</strong> Hasta ${bank.plazoMaxAnos} años (${bank.plazoMaxMeses} cuotas mensuales)</div>
        <div><strong>Financiación Máxima:</strong> Hasta el ${bank.ltvMax}% de tasación</div>
        <div><strong>Relación Cuota / Ingreso Neto:</strong> Máximo ${bank.relacionCuotaIngreso}%</div>
        <div><strong>Tope de Monto:</strong> ${bank.montoMaximoTexto}</div>
      </div>

      <div class="hipo-modal-section">
        <div class="hipo-modal-section-green"><i class="fa-solid fa-briefcase"></i> Requisitos de Antigüedad Laboral</div>
        <div><strong>Relación de Dependencia:</strong> ${bank.antiguedadDependencia}</div>
        <div><strong>Independientes / Monotributo:</strong> ${bank.antiguedadIndependiente}</div>
      </div>

      <div class="hipo-modal-section">
        <div class="hipo-modal-section-blue"><i class="fa-solid fa-users"></i> Codeudores y Límites de Edad</div>
        <div><strong>Suma de Ingresos:</strong> ${bank.codeudores}</div>
        <div><strong>Edad Límite:</strong> ${bank.edadLimite}</div>
      </div>

      <div class="hipo-modal-section">
        <div class="hipo-modal-section-purple"><i class="fa-solid fa-house"></i> Destinos y Gastos Asociados</div>
        <div><strong>Destinos Permitidos:</strong> ${bank.destinos}</div>
        <div><strong>Seguros y Gastos:</strong> ${bank.segurosYGastos}</div>
      </div>

      <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
        <a href="${bank.sitioWeb}" target="_blank" rel="noopener noreferrer" class="btn btn-primary" style="text-decoration: none; display: inline-flex; align-items: center; gap: 8px;">
          <i class="fa-solid fa-arrow-up-right-from-square"></i> Visitar Sitio Oficial del Banco
        </a>
      </div>
    `;

    modal.classList.remove('hidden');
  },

  getMockHipotecarios() {
    return [
      {
        id: 'bna',
        entidad: 'Banco de la Nación Argentina (BNA)',
        linea: '+Hogares con BNA',
        tipo: 'Público Nacional',
        tnaClientes: 4.5,
        tnaClientesTexto: 'UVA + 4.50%',
        tnaNoClientes: 8.0,
        tnaNoClientesTexto: 'UVA + 8.00%',
        plazoMaxAnos: 30,
        plazoMaxMeses: 360,
        ltvMax: 75,
        montoMaximoTexto: 'Sin tope preestablecido (Aprox. hasta USD 250.000)',
        relacionCuotaIngreso: 25,
        destacado: 'Opción tope CVS (+1.5%) y hasta 30 años',
        antiguedadDependencia: '1 año de antigüedad continua (o 6 meses cobrando haberes en el BNA)',
        antiguedadIndependiente: '2 años en la misma actividad (Monotributo / Responsable Inscripto)',
        codeudores: 'Permite sumar hasta 2 codeudores familiares directos (cónyuge, conviviente, padres, hijos, hermanos)',
        edadLimite: 'Hasta 80 años cumplidos al momento del vencimiento de la última cuota',
        destinos: 'Adquisición de vivienda única y familiar, cambio de vivienda, refacción o ampliación',
        segurosYGastos: 'Seguro de vida bonificado para menores de 65 años; seguro contra incendio 0.05% s/tasación',
        sitioWeb: 'https://www.bna.com.ar'
      },
      {
        id: 'hipotecario',
        entidad: 'Banco Hipotecario',
        linea: 'Crédito Hipotecario UVA Tradicional y Construcción',
        tipo: 'Privado / Mixto',
        tnaClientes: 4.25,
        tnaClientesTexto: 'UVA + 4.25% (1er año, luego 8.50%)',
        tnaNoClientes: 8.5,
        tnaNoClientesTexto: 'UVA + 8.50%',
        plazoMaxAnos: 30,
        plazoMaxMeses: 360,
        ltvMax: 80,
        montoMaximoTexto: 'Hasta USD 250.000 (equivalente en pesos al desembolso)',
        relacionCuotaIngreso: 25,
        destacado: 'Tasa 4.25% primer año y hasta 80% LTV',
        antiguedadDependencia: '1 año en empleo registrado (6 meses si acredita sueldo en Banco Hipotecario)',
        antiguedadIndependiente: '2 años de actividad formal comprobable',
        codeudores: 'Permite sumar ingresos con cónyuge, concubino acreditado o padres',
        edadLimite: 'Hasta 75 años al momento de cancelación final',
        destinos: 'Adquisición de primera y segunda vivienda, construcción, terminación o refacción',
        segurosYGastos: 'Seguro de incendio bonificado con paquete de cuentas',
        sitioWeb: 'https://www.hipotecario.com.ar'
      },
      {
        id: 'ciudad',
        entidad: 'Banco Ciudad',
        linea: 'Hipotecario UVA Casa Propia & Desarrollo Zona Sur',
        tipo: 'Público CABA',
        tnaClientes: 3.5,
        tnaClientesTexto: 'UVA + 3.50% (Zona Sur) / 5.50% (General)',
        tnaNoClientes: 7.5,
        tnaNoClientesTexto: 'UVA + 7.50%',
        plazoMaxAnos: 20,
        plazoMaxMeses: 240,
        ltvMax: 75,
        montoMaximoTexto: 'Hasta $250.000.000 (Aprox. USD 200.000)',
        relacionCuotaIngreso: 25,
        destacado: 'Tasa más baja del mercado: UVA + 3.50% (Zona Sur CABA)',
        antiguedadDependencia: '1 año en relación de dependencia continua',
        antiguedadIndependiente: '1 año profesionales independientes / 2 años comerciantes y oficios',
        codeudores: 'Permite sumar ingresos familiares directos para ampliar la capacidad de pago',
        edadLimite: 'Hasta 75 años a la finalización del crédito',
        destinos: 'Adquisición de vivienda única familiar en CABA y Gran Buenos Aires',
        segurosYGastos: 'Sin comisiones de otorgamiento para primera vivienda',
        sitioWeb: 'https://www.bancociudad.com.ar'
      },
      {
        id: 'santander',
        entidad: 'Banco Santander Argentina',
        linea: 'Super Préstamo Hipotecario UVA Santander',
        tipo: 'Privado',
        tnaClientes: 5.5,
        tnaClientesTexto: 'UVA + 5.50%',
        tnaNoClientes: 7.5,
        tnaNoClientesTexto: 'UVA + 7.50%',
        plazoMaxAnos: 30,
        plazoMaxMeses: 360,
        ltvMax: 75,
        montoMaximoTexto: 'Sin tope de monto máximo (sujeto a score crediticio)',
        relacionCuotaIngreso: 25,
        destacado: 'Sin tope de monto y hasta 30 años de plazo',
        antiguedadDependencia: '6 meses cobrando haberes en Santander o 1 año continuo general',
        antiguedadIndependiente: '2 años de antigüedad en AFIP (Monotributo / RI)',
        codeudores: 'Permite sumar hasta 4 ingresos familiares (titular, cónyuge/conviviente y padres)',
        edadLimite: 'Hasta 75 años cumplidos al vencimiento de la última cuota',
        destinos: 'Compra de vivienda permanente o segunda residencia, terminación y refacción',
        segurosYGastos: 'Seguro de vida e incendio incluídos en la cuota mensual',
        sitioWeb: 'https://www.santander.com.ar'
      },
      {
        id: 'galicia',
        entidad: 'Banco Galicia',
        linea: 'Préstamos Hipotecarios UVA Galicia Casa Propia',
        tipo: 'Privado',
        tnaClientes: 5.5,
        tnaClientesTexto: 'UVA + 5.50%',
        tnaNoClientes: 7.5,
        tnaNoClientesTexto: 'UVA + 7.50%',
        plazoMaxAnos: 30,
        plazoMaxMeses: 360,
        ltvMax: 80,
        montoMaximoTexto: 'Sin tope de monto (determinado por ingresos demostrables)',
        relacionCuotaIngreso: 25,
        destacado: 'Hasta 80% financiación y preaprobación 100% digital',
        antiguedadDependencia: '1 año de antigüedad laboral en relación de dependencia',
        antiguedadIndependiente: '2 años en régimen simplificado o general',
        codeudores: 'Posibilidad de sumar ingresos con hasta 4 familiares directos',
        edadLimite: 'Hasta 75 años al momento de liquidar la última obligación',
        destinos: 'Compra de vivienda permanente o no permanente en todo el país',
        segurosYGastos: 'Bonificación total de gastos de tasación para clientes Eminent',
        sitioWeb: 'https://www.galicia.ar'
      },
      {
        id: 'bbva',
        entidad: 'Banco BBVA Argentina',
        linea: 'Préstamo Hipotecario BBVA UVA Hogar',
        tipo: 'Privado',
        tnaClientes: 6.5,
        tnaClientesTexto: 'UVA + 6.50%',
        tnaNoClientes: 9.5,
        tnaNoClientesTexto: 'UVA + 9.50%',
        plazoMaxAnos: 20,
        plazoMaxMeses: 240,
        ltvMax: 80,
        montoMaximoTexto: 'Sin tope máximo preestablecido',
        relacionCuotaIngreso: 25,
        destacado: 'Financiación hasta el 80% de tasación',
        antiguedadDependencia: '1 año laboral registrado en la empresa actual',
        antiguedadIndependiente: '2 años como trabajador independiente o profesional',
        codeudores: 'Permite sumar ingresos entre cónyuges o convivientes registrados',
        edadLimite: 'Hasta 75 años al cancelar el préstamo',
        destinos: 'Adquisición de vivienda permanente y segunda vivienda',
        segurosYGastos: 'Seguro colectivo de saldos deudores sin recargo por edad hasta 65 años',
        sitioWeb: 'https://www.bbva.com.ar'
      },
      {
        id: 'macro',
        entidad: 'Banco Macro',
        linea: 'Tu Casa Macro - Hipotecario UVA',
        tipo: 'Privado',
        tnaClientes: 5.5,
        tnaClientesTexto: 'UVA + 5.50%',
        tnaNoClientes: 8.5,
        tnaNoClientesTexto: 'UVA + 8.50%',
        plazoMaxAnos: 20,
        plazoMaxMeses: 240,
        ltvMax: 75,
        montoMaximoTexto: 'Sin tope preestablecido',
        relacionCuotaIngreso: 25,
        destacado: 'Cuota/ingreso hasta 30% en segmento Selecta',
        antiguedadDependencia: '12 meses continuos de empleo en blanco',
        antiguedadIndependiente: '2 años de actividad económica ininterrumpida',
        codeudores: 'Permite sumar ingresos con cónyuge o concubino formalmente acreditado',
        edadLimite: 'Hasta 75 años al término del crédito',
        destinos: 'Adquisición de vivienda familiar, ampliación o refacción integral',
        segurosYGastos: 'Coberturas de seguro patrimonial a través de Macro Broker',
        sitioWeb: 'https://www.macro.com.ar'
      },
      {
        id: 'bancor',
        entidad: 'Banco de la Provincia de Córdoba (Bancor)',
        linea: 'Hipotecario Casa Bancor UVA 100%',
        tipo: 'Público Provincial',
        tnaClientes: 4.9,
        tnaClientesTexto: 'UVA + 4.90%',
        tnaNoClientes: 7.9,
        tnaNoClientesTexto: 'UVA + 7.90%',
        plazoMaxAnos: 20,
        plazoMaxMeses: 240,
        ltvMax: 100,
        montoMaximoTexto: 'Hasta $120.000.000 (Aprox. USD 100.000)',
        relacionCuotaIngreso: 25,
        destacado: 'Único banco con financiación hasta el 100% (con seguro de caución)',
        antiguedadDependencia: '1 año de antigüedad comprobada',
        antiguedadIndependiente: '1 año para profesionales, 2 años comerciantes',
        codeudores: 'Acepta suma de ingresos con grupo familiar conviviente',
        edadLimite: 'Hasta 75 años a la fecha de finalización',
        destinos: 'Adquisición, construcción o ampliación de vivienda en Córdoba',
        segurosYGastos: 'Convenio con seguros de caución para financiar el 20% no tradicional',
        sitioWeb: 'https://www.bancor.com.ar'
      },
      {
        id: 'credicoop',
        entidad: 'Banco Credicoop Cooperativo Limitado',
        linea: 'Hipotecario Cooperativo UVA Soluciones Habitacionales',
        tipo: 'Cooperativo',
        tnaClientes: 5.5,
        tnaClientesTexto: 'UVA + 5.50%',
        tnaNoClientes: 7.5,
        tnaNoClientesTexto: 'UVA + 7.50%',
        plazoMaxAnos: 20,
        plazoMaxMeses: 240,
        ltvMax: 70,
        montoMaximoTexto: 'Hasta $200.000.000',
        relacionCuotaIngreso: 30,
        destacado: 'Relación cuota/ingreso más flexible (30%)',
        antiguedadDependencia: '1 año de antigüedad registrada continua',
        antiguedadIndependiente: '2 años en el ejercicio de la profesión u oficio',
        codeudores: 'Permite co-titulares familiares (cónyuge, padres o hijos)',
        edadLimite: 'Hasta 75 años al finalizar el plazo convenido',
        destinos: 'Vivienda única, permanente y de ocupación propia',
        segurosYGastos: 'Tarifas cooperativas en comisiones de tasación y estudio de títulos',
        sitioWeb: 'https://www.bancocredicoop.coop'
      },
      {
        id: 'comafi',
        entidad: 'Banco Comafi',
        linea: 'Préstamos Hipotecarios UVA Comafi Mi Casa',
        tipo: 'Privado',
        tnaClientes: 6.0,
        tnaClientesTexto: 'UVA + 6.00%',
        tnaNoClientes: 9.0,
        tnaNoClientesTexto: 'UVA + 9.00%',
        plazoMaxAnos: 20,
        plazoMaxMeses: 240,
        ltvMax: 75,
        montoMaximoTexto: 'Sin tope de monto predeterminado',
        relacionCuotaIngreso: 25,
        destacado: 'Sin tope y aprobación ágil para clientes con sueldo',
        antiguedadDependencia: '1 año de antigüedad laboral en relación de dependencia',
        antiguedadIndependiente: '2 años para trabajadores independientes y profesionales',
        codeudores: 'Se pueden sumar ingresos con cónyuge o conviviente',
        edadLimite: 'Hasta 75 años al cancelar la deuda',
        destinos: 'Adquisición de vivienda permanente o segunda vivienda',
        segurosYGastos: 'Seguro sobre saldo deudor y seguro de incendio',
        sitioWeb: 'https://www.comafi.com.ar'
      }
    ];
  }
};
