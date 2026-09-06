/**
 * tabComparador.js
 * Controlador de la pestaña de Comparador Bancario y Financiero:
 * Régimen de Transparencia del BCRA: Plazos fijos digitales a 30 días,
 * comisiones de mantenimiento de cajas de ahorro y tarjetas de crédito,
 * préstamos personales, y Billeteras Virtuales & Cuentas Remuneradas Fintech (vía tabCripto).
 */

import { fetchPlazosFijos, fetchComisiones, fetchPrestamos } from './api.js';
import { clientCache, appState } from './state.js';
import { formatValue, debounce } from './utils.js';
import { tabCripto } from './tabCripto.js';

export const tabComparador = {
  initialized: false,
  activeTab: 'plazosFijos', // 'plazosFijos', 'comisiones', 'prestamos', 'cuentasRemuneradas'

  async init() {
    if (this.initialized) {
      this.render();
      return;
    }

    const btnPf = document.getElementById('btnShowPlazosFijos');
    const btnCom = document.getElementById('btnShowComisiones');
    const btnPrest = document.getElementById('btnShowPrestamos');
    const btnRem = document.getElementById('btnShowCuentasRemuneradas');

    if (btnPf) btnPf.addEventListener('click', () => this.switchSubTab('plazosFijos'));
    if (btnCom) btnCom.addEventListener('click', () => this.switchSubTab('comisiones'));
    if (btnPrest) btnPrest.addEventListener('click', () => this.switchSubTab('prestamos'));
    if (btnRem) btnRem.addEventListener('click', () => this.switchSubTab('cuentasRemuneradas'));

    const searchInput = document.getElementById('bankSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', debounce(() => this.render(), 150));
    }

    await this.fetchData();
    this.initialized = true;
  },

  switchSubTab(tab) {
    this.activeTab = tab;
    appState.comparador.activeTab = tab;

    const tabs = ['plazosFijos', 'comisiones', 'prestamos', 'cuentasRemuneradas'];
    const tabBtns = {
      plazosFijos: document.getElementById('btnShowPlazosFijos'),
      comisiones: document.getElementById('btnShowComisiones'),
      prestamos: document.getElementById('btnShowPrestamos'),
      cuentasRemuneradas: document.getElementById('btnShowCuentasRemuneradas')
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

    clientCache.set('transparencia_comparador', {
      plazosFijos: appState.comparador.plazosFijos,
      comisiones: appState.comparador.comisiones,
      prestamos: appState.comparador.prestamos
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
  }
};
