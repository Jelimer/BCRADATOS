/**
 * tabConsultas.js
 * Controlador de la pestaña de Consultas Financieras:
 * - Central de Deudores del BCRA: validación matemática de CUIT (módulo 11),
 *   semáforo visual de situación crediticia (1 a 6), consolidación de deuda y entidades.
 * - Evolución crediticia histórica de los últimos 24 meses (oficial BCRA).
 * - Historial de búsquedas recientes persistido en localStorage.
 * - Validador de Cheques Denunciados: comprobación de denuncias por robo, hurto o adulteración.
 */

import { fetchDeudas, fetchDeudasHistoricas, fetchChequeDenunciado } from './api.js';
import { clientCache, appState } from './state.js';
import { formatValue, formatValueCompact, formatMilesSinDecimales, isValidCuit, downloadBlob } from './utils.js';
import { showToast } from './ui.js';
import { registerChart, unregisterChart } from './charts.js';

export const tabConsultas = {
  initialized: false,
  activeTab: 'deudores', // 'deudores', 'cheques'
  periodosHistoricos: [],
  cuitActual: '',
  historyChart: null,

  init() {
    if (this.initialized) return;

    const btnDeudores = document.getElementById('btnShowDeudores');
    const btnCheques = document.getElementById('btnShowValidadorCheques');
    const btnConsultarD = document.getElementById('btnConsultarDeudor');
    const cuitInput = document.getElementById('cuitInput');
    const btnConsultarC = document.getElementById('btnConsultarCheque');
    const chequeInput = document.getElementById('chequeNumeroInput');
    const btnReintentarD = document.getElementById('btnReintentarDeudor');
    const btnReintentarC = document.getElementById('btnReintentarCheque');
    const btnCargarDemo = document.getElementById('btnCargarDemoDeudor');
    const btnEjemploDemo = document.getElementById('btnEjemploDemoCuit');
    const periodoSelect = document.getElementById('deudorPeriodoSelect');
    const btnToggleHistTable = document.getElementById('btnToggleHistoricoTable');
    const btnCapturar = document.getElementById('btnCapturarPantallaDeudor');

    if (btnDeudores) btnDeudores.addEventListener('click', () => this.switchSubTab('deudores'));
    if (btnCheques) btnCheques.addEventListener('click', () => this.switchSubTab('cheques'));

    if (btnConsultarD) btnConsultarD.addEventListener('click', () => this.consultarDeudor());
    if (btnCargarDemo) btnCargarDemo.addEventListener('click', () => this.cargarDemoDeudor());
    if (btnEjemploDemo) btnEjemploDemo.addEventListener('click', () => this.cargarDemoDeudor());
    if (btnCapturar) btnCapturar.addEventListener('click', () => this.capturarPantallaDeudor());
    if (cuitInput) {
      cuitInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.consultarDeudor();
      });
    }

    if (btnConsultarC) btnConsultarC.addEventListener('click', () => this.consultarCheque());
    if (chequeInput) {
      chequeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.consultarCheque();
      });
    }

    if (btnReintentarD) btnReintentarD.addEventListener('click', () => this.consultarDeudor());
    if (btnReintentarC) btnReintentarC.addEventListener('click', () => this.consultarCheque());

    if (periodoSelect) {
      periodoSelect.addEventListener('change', (e) => {
        this.selectPeriodo(e.target.value);
      });
    }

    if (btnToggleHistTable) {
      btnToggleHistTable.addEventListener('click', () => {
        const wrapper = document.getElementById('deudorHistoricoTableWrapper');
        if (wrapper) {
          const isHidden = wrapper.classList.toggle('hidden');
          btnToggleHistTable.innerHTML = isHidden
            ? '<i class="fa-solid fa-table-list"></i> Ver Tabla Mensual'
            : '<i class="fa-solid fa-eye-slash"></i> Ocultar Tabla';
        }
      });
    }

    this.renderRecentSearches();
    this.initialized = true;
  },

  switchSubTab(tab) {
    this.activeTab = tab;
    appState.consultas.activeTab = tab;

    const btnDeudores = document.getElementById('btnShowDeudores');
    const btnCheques = document.getElementById('btnShowValidadorCheques');
    const viewDeudores = document.getElementById('subviewDeudores');
    const viewCheques = document.getElementById('subviewValidadorCheques');

    if (tab === 'deudores') {
      if (btnDeudores) btnDeudores.classList.add('active');
      if (btnCheques) btnCheques.classList.remove('active');
      if (viewDeudores) viewDeudores.classList.remove('hidden');
      if (viewCheques) viewCheques.classList.add('hidden');
    } else {
      if (btnDeudores) btnDeudores.classList.remove('active');
      if (btnCheques) btnCheques.classList.add('active');
      if (viewDeudores) viewDeudores.classList.add('hidden');
      if (viewCheques) viewCheques.classList.remove('hidden');
    }
  },

  // ==========================================
  // BÚSQUEDAS RECIENTES (PERSISTENCIA LOCAL)
  // ==========================================

  getRecentSearches() {
    try {
      const raw = localStorage.getItem('bcra_recent_cuits');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  saveRecentSearch(cuit, denominacion) {
    if (!cuit) return;
    try {
      let recents = this.getRecentSearches().filter(item => item.cuit !== cuit);
      recents.unshift({
        cuit,
        denominacion: denominacion || 'Contribuyente',
        fecha: new Date().toISOString()
      });
      recents = recents.slice(0, 6);
      localStorage.setItem('bcra_recent_cuits', JSON.stringify(recents));
      this.renderRecentSearches();
    } catch (e) {
      console.warn('[Consultas] No se pudo guardar búsqueda reciente:', e);
    }
  },

  renderRecentSearches() {
    const container = document.getElementById('deudoresRecentSearches');
    const chipsBox = document.getElementById('deudoresRecentChips');
    if (!container || !chipsBox) return;

    const recents = this.getRecentSearches();
    if (recents.length === 0) {
      container.classList.add('hidden');
      return;
    }

    chipsBox.innerHTML = '';
    recents.forEach(item => {
      const clean = String(item.cuit).replace(/\D/g, '');
      const formatted = clean.length === 11 ? `${clean.slice(0, 2)}-${clean.slice(2, 10)}-${clean.slice(10)}` : clean;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'recent-cuit-chip';
      chip.style.cssText = 'font-size: 12px; padding: 4px 10px; border-radius: 20px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: var(--text-main); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all 0.2s ease;';
      chip.innerHTML = `<i class="fa-solid fa-user-check" style="font-size: 11px; color: #bf5af2;"></i> ${formatted}`;
      chip.title = item.denominacion ? `${item.denominacion} (${formatted})` : formatted;
      chip.addEventListener('click', () => {
        const input = document.getElementById('cuitInput');
        if (input) {
          input.value = clean;
          this.consultarDeudor();
        }
      });
      chipsBox.appendChild(chip);
    });

    container.classList.remove('hidden');
  },

  // ==========================================
  // CONSULTA PRINCIPAL DE DEUDOR & HISTORIAL
  // ==========================================

  async consultarDeudor() {
    const input = document.getElementById('cuitInput');
    const errorText = document.getElementById('cuitErrorText');
    const loader = document.getElementById('loadingDeudores');
    const resultsContainer = document.getElementById('deudoresResultContainer');
    const errorContainer = document.getElementById('deudoresErrorContainer');
    const historicoContainer = document.getElementById('deudoresHistoricoContainer');
    const demoBanner = document.getElementById('deudorDemoBanner');

    if (!input) return;

    const cuit = input.value.trim().replace(/\D/g, '');
    if (errorText) errorText.classList.add('hidden');
    if (resultsContainer) resultsContainer.classList.add('hidden');
    if (errorContainer) errorContainer.classList.add('hidden');
    if (historicoContainer) historicoContainer.classList.add('hidden');
    if (demoBanner) demoBanner.classList.add('hidden');

    if (!isValidCuit(cuit)) {
      if (errorText) errorText.classList.remove('hidden');
      return;
    }

    this.cuitActual = cuit;

    if (loader) loader.classList.remove('hidden');

    try {
      // Consultar estado actual y serie histórica de 24 meses en paralelo
      const [resDeudas, resHistoricas] = await Promise.allSettled([
        fetchDeudas(cuit),
        fetchDeudasHistoricas(cuit)
      ]);

      if (resDeudas.status === 'rejected') {
        throw resDeudas.reason;
      }

      const currentData = resDeudas.value;
      const historicasData = resHistoricas.status === 'fulfilled' ? resHistoricas.value : null;

      // Guardar en búsquedas recientes
      const denominacion = currentData?.results?.denominacion || '';
      if (denominacion && !denominacion.includes('CONTRIBUYENTE CONSULTADO')) {
        this.saveRecentSearch(cuit, denominacion);
      }

      // Renderizar ficha actual
      this.renderDeudorResults(currentData, cuit);

      // Renderizar evolución de 24 meses
      this.renderDeudorHistory(historicasData, currentData, cuit);

    } catch (error) {
      console.warn('[Consultas] Error al consultar Central de Deudores del BCRA:', error.message);
      if (resultsContainer) resultsContainer.classList.add('hidden');

      if (errorContainer) {
        const titleEl = document.getElementById('deudorErrorTitle');
        const descEl = document.getElementById('deudorErrorDesc');
        const isMaintenance = /mantenimiento|503|502|unavailable/i.test(error.message);

        if (isMaintenance) {
          if (titleEl) titleEl.textContent = 'Servicio Oficial del BCRA en Mantenimiento Temporal';
          if (descEl) {
            descEl.innerHTML = `El servidor oficial del Banco Central (BCRA) informa actualmente: <strong>"El servicio se encuentra en mantenimiento."</strong><br>
            La API pública de la Central de Deudores suele interrumpirse por mantenimiento técnico programado durante fines de semana y horarios no bancarios.<br>
            Puede probar las funciones interactivas del sistema con el botón <strong>"Probar con Datos de Demostración"</strong> o reintentar la consulta en vivo.`;
          }
          showToast('El servicio del BCRA se encuentra en mantenimiento temporal.', 'warning');
        } else {
          if (titleEl) titleEl.textContent = 'No fue posible consultar la Central de Deudores';
          if (descEl) descEl.textContent = error.message || 'Error de conexión con el servicio del Banco Central. Por favor, verifique su conexión e intente nuevamente.';
          showToast('No se pudo conectar con el Banco Central.', 'danger');
        }

        errorContainer.classList.remove('hidden');
      }
    } finally {
      if (loader) loader.classList.add('hidden');
    }
  },

  // ==========================================
  // PERFIL DE DEMOSTRACIÓN INTERACTIVO
  // ==========================================

  cargarDemoDeudor() {
    const input = document.getElementById('cuitInput');
    if (input) input.value = '20301234567';
    const errorText = document.getElementById('cuitErrorText');
    const resultsContainer = document.getElementById('deudoresResultContainer');
    const errorContainer = document.getElementById('deudoresErrorContainer');
    const demoBanner = document.getElementById('deudorDemoBanner');

    if (errorText) errorText.classList.add('hidden');
    if (errorContainer) errorContainer.classList.add('hidden');
    if (demoBanner) demoBanner.classList.remove('hidden');

    const demoData = {
      status: 200,
      results: {
        identificacion: 20301234567,
        denominacion: "GARCÍA RODRÍGUEZ MARCELO ALEJANDRO (PERFIL DE PRUEBA)",
        tieneDeuda: true,
        peorSituacion: 2,
        situacion: 2,
        totalDeuda: 1425800,
        entidades: [
          {
            entidad: "BANCO SANTANDER ARGENTINA S.A.",
            monto: 780.5,
            situacion: 1,
            periodo: "01/2026"
          },
          {
            entidad: "BANCO GALICIA Y BUENOS AIRES S.A.U.",
            monto: 450.3,
            situacion: 2,
            periodo: "01/2026"
          },
          {
            entidad: "TARJETA NARANJA DIGITAL COMPAÑIA FINANCIERA",
            monto: 195.0,
            situacion: 1,
            periodo: "01/2026"
          }
        ],
        chequesRechazados: [],
        periodos: [
          {
            periodo: "202601",
            entidades: [
              { entidad: "BANCO SANTANDER ARGENTINA S.A.", monto: 780.5, situacion: 1 },
              { entidad: "BANCO GALICIA Y BUENOS AIRES S.A.U.", monto: 450.3, situacion: 2 },
              { entidad: "TARJETA NARANJA DIGITAL COMPAÑIA FINANCIERA", monto: 195.0, situacion: 1 }
            ]
          },
          {
            periodo: "202512",
            entidades: [
              { entidad: "BANCO SANTANDER ARGENTINA S.A.", monto: 720.0, situacion: 1 },
              { entidad: "BANCO GALICIA Y BUENOS AIRES S.A.U.", monto: 430.0, situacion: 2 },
              { entidad: "TARJETA NARANJA DIGITAL COMPAÑIA FINANCIERA", monto: 180.0, situacion: 1 }
            ]
          },
          {
            periodo: "202511",
            entidades: [
              { entidad: "BANCO SANTANDER ARGENTINA S.A.", monto: 690.0, situacion: 1 },
              { entidad: "BANCO GALICIA Y BUENOS AIRES S.A.U.", monto: 410.0, situacion: 1 },
              { entidad: "TARJETA NARANJA DIGITAL COMPAÑIA FINANCIERA", monto: 165.0, situacion: 1 }
            ]
          },
          {
            periodo: "202510",
            entidades: [
              { entidad: "BANCO SANTANDER ARGENTINA S.A.", monto: 650.0, situacion: 1 },
              { entidad: "BANCO GALICIA Y BUENOS AIRES S.A.U.", monto: 380.0, situacion: 1 },
              { entidad: "TARJETA NARANJA DIGITAL COMPAÑIA FINANCIERA", monto: 150.0, situacion: 1 }
            ]
          },
          {
            periodo: "202509",
            entidades: [
              { entidad: "BANCO SANTANDER ARGENTINA S.A.", monto: 610.0, situacion: 1 },
              { entidad: "BANCO GALICIA Y BUENOS AIRES S.A.U.", monto: 350.0, situacion: 1 }
            ]
          },
          {
            periodo: "202508",
            entidades: [
              { entidad: "BANCO SANTANDER ARGENTINA S.A.", monto: 580.0, situacion: 1 },
              { entidad: "BANCO GALICIA Y BUENOS AIRES S.A.U.", monto: 320.0, situacion: 1 }
            ]
          }
        ]
      }
    };

    this.renderDeudorResults(demoData, '20301234567');
    this.renderDeudorHistory(demoData, demoData, '20301234567');
    showToast('Cargado perfil de demostración interactivo.', 'info');
  },

  // ==========================================
  // RENDERIZADO DE RESULTADOS PRINCIPALES
  // ==========================================

  renderDeudorResults(data, cuit) {
    const resultsContainer = document.getElementById('deudoresResultContainer');
    const errorContainer = document.getElementById('deudoresErrorContainer');
    if (errorContainer) errorContainer.classList.add('hidden');

    const results = data.results || data;
    const periodos = results.periodos || [];
    const tieneDeuda = results.tieneDeuda !== false && periodos.length > 0;

    let nombre = results.denominacion || (tieneDeuda ? 'CONTRIBUYENTE CONSULTADO' : 'SIN DEUDAS REGISTRADAS (SITUACIÓN 1)');
    let peorSit = results.peorSituacion || results.situacion || 1;
    let totalDeuda = 0;
    let cantBancos = 0;
    let chequesRech = Array.isArray(results.chequesRechazados) ? results.chequesRechazados.length : (results.tieneChequesRechazados ? 1 : 0);
    let deudas = [];

    if (!tieneDeuda) {
      peorSit = 1;
      totalDeuda = 0;
      cantBancos = 0;
      deudas = [];
      if (!results.denominacion) {
        nombre = 'SITUACIÓN 1 - SIN DEUDAS REGISTRADAS';
      }
    } else {
      const periodoMasReciente = periodos[0];
      const entidades = periodoMasReciente.entidades || [];

      // Filtrar entidades que tienen deuda activa (>0) o situación informada
      const entidadesActivas = entidades.filter(ent => (ent.monto || 0) > 0 || (ent.situacion && ent.situacion > 0));
      cantBancos = entidadesActivas.length;

      deudas = entidadesActivas.map(ent => {
        const sit = parseInt(ent.situacion || 1, 10);
        if (sit > peorSit) {
          peorSit = sit;
        }
        const montoEnPesos = parseFloat(ent.monto || 0) * 1000;
        totalDeuda += montoEnPesos;

        let perFormateado = periodoMasReciente.periodo || '';
        if (perFormateado.length === 6) {
          perFormateado = `${perFormateado.slice(4)}/${perFormateado.slice(0, 4)}`;
        }

        return {
          entidad: ent.entidad || 'Entidad Financiera',
          monto: montoEnPesos,
          situacion: sit,
          periodo: perFormateado
        };
      });
    }

    const cleanCuit = String(cuit).replace(/\D/g, '');
    const formattedCuit = cleanCuit.length === 11 ? `${cleanCuit.slice(0, 2)}-${cleanCuit.slice(2, 10)}-${cleanCuit.slice(10)}` : cleanCuit;
    const deudorNombreEl = document.getElementById('deudorNombre');
    if (deudorNombreEl) deudorNombreEl.textContent = nombre.toUpperCase();

    const deudorCuitEl = document.getElementById('deudorCuit');
    if (deudorCuitEl) {
      deudorCuitEl.textContent = `CUIT/CUIL: ${formattedCuit}${!tieneDeuda ? ' • Sin deudas informadas en el sistema financiero' : ''}`;
    }

    const badge = document.getElementById('deudorBadgeStatus');
    const badgeText = document.getElementById('deudorBadgeText');
    if (badge) {
      badge.className = 'deudor-badge';
      badge.classList.add(`situacion-${peorSit}`);
    }

    const descripciones = {
      1: 'SITUACION 1 - NORMAL',
      2: 'SITUACION 2 - RIESGO BAJO (SEGUIMIENTO)',
      3: 'SITUACION 3 - RIESGO MEDIO (PROBLEMAS)',
      4: 'SITUACION 4 - RIESGO ALTO (INSOLVENCIA)',
      5: 'SITUACION 5 - IRRECUPERABLE',
      6: 'SITUACION 6 - IRRECUPERABLE DISP. TECNICA'
    };
    if (badgeText) badgeText.textContent = descripciones[peorSit] || `SITUACION ${peorSit}`;

    const peorEl = document.getElementById('deudorPeorSituacion');
    if (peorEl) {
      peorEl.textContent = peorSit;
      peorEl.style.color = this.getColorForSituacion(peorSit);
    }

    const totalEl = document.getElementById('deudorTotalDeuda');
    if (totalEl) totalEl.textContent = `$${formatValueCompact(totalDeuda)}`;

    const cantEl = document.getElementById('deudorCantEntidades');
    if (cantEl) cantEl.textContent = cantBancos;

    const chequesEl = document.getElementById('deudorChequesRechazados');
    if (chequesEl) {
      chequesEl.textContent = chequesRech > 0 ? chequesRech : '0 (Sin rechazos)';
      chequesEl.style.color = (chequesRech > 0) ? '#ff453a' : '#30d158';
    }

    this.renderDeudasTable(deudas);

    if (resultsContainer) resultsContainer.classList.remove('hidden');
    showToast('Informe crediticio oficial obtenido.', 'success');
  },

  renderDeudasTable(deudas) {
    const tbody = document.getElementById('deudasTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (!deudas || deudas.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center" style="padding: 24px 15px; color: #30d158; font-weight: 500;">
        <i class="fa-solid fa-circle-check" style="font-size: 16px; margin-right: 6px;"></i>
        El CUIT consultado no registra deudas activas ni morosidad informadas en el sistema financiero del BCRA.
      </td></tr>`;
      return;
    }

    deudas.forEach(d => {
      const sit = parseInt(d.situacion || 1, 10);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="font-medium">${d.entidad || 'Entidad Bancaria'}</td>
        <td class="text-right font-medium">$${formatValue(d.monto)}</td>
        <td class="text-center"><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${this.getColorForSituacion(sit)}; margin-right:6px;"></span>${sit}</td>
        <td class="text-right" style="color: var(--text-secondary);">${d.periodo}</td>
      `;
      tbody.appendChild(tr);
    });
  },

  // ==========================================
  // RENDERIZADO DEL HISTORIAL DE 24 MESES
  // ==========================================

  renderDeudorHistory(historicasData, currentData, cuit) {
    const histContainer = document.getElementById('deudoresHistoricoContainer');
    const selectWrapper = document.getElementById('deudorPeriodoSelectWrapper');
    const selectEl = document.getElementById('deudorPeriodoSelect');
    const tableBody = document.getElementById('deudorHistoricoTableBody');

    if (!histContainer) return;

    // Obtener los períodos disponibles
    const periodos = historicasData?.results?.periodos || currentData?.results?.periodos || [];

    if (!periodos || periodos.length === 0) {
      histContainer.classList.add('hidden');
      if (selectWrapper) selectWrapper.classList.add('hidden');
      return;
    }

    this.periodosHistoricos = periodos;

    // Procesar cada período con sus métricas consolidadas
    const processedPeriods = periodos.map((p, idx) => {
      const perStr = String(p.periodo || '');
      const formatted = perStr.length === 6 ? `${perStr.slice(4)}/${perStr.slice(0, 4)}` : perStr;
      const ents = p.entidades || [];
      const activeEnts = ents.filter(e => (e.monto || 0) > 0);
      const totalDeuda = activeEnts.reduce((acc, e) => acc + (parseFloat(e.monto || 0) * 1000), 0);
      const peorSit = activeEnts.reduce((max, e) => Math.max(max, parseInt(e.situacion || 1, 10)), 1);

      return {
        rawPeriodo: perStr,
        periodoFormatted: formatted,
        totalDeuda,
        peorSit,
        cantEntidades: activeEnts.length,
        entidades: activeEnts,
        isLatest: idx === 0
      };
    });

    // 1. Llenar el selector de período desplegable
    if (selectEl && selectWrapper) {
      selectEl.innerHTML = '';
      processedPeriods.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.rawPeriodo;
        opt.textContent = `${p.periodoFormatted}${p.isLatest ? ' (Más reciente)' : ''}`;
        selectEl.appendChild(opt);
      });
      selectWrapper.classList.remove('hidden');
    }

    // 2. Llenar la tabla histórica de los 24 meses con filas acordeón expandibles (+)
    if (tableBody) {
      tableBody.innerHTML = '';
      processedPeriods.forEach(p => {
        // Fila principal del período
        const trMain = document.createElement('tr');
        trMain.className = 'historico-row-main';
        trMain.setAttribute('data-periodo', p.rawPeriodo);
        trMain.innerHTML = `
          <td class="font-medium" style="white-space: nowrap;">
            <button type="button" class="btn-expand-periodo" data-expand-periodo="${p.rawPeriodo}" title="Desplegar entidades de ${p.periodoFormatted}">
              <i class="fa-solid fa-plus"></i>
            </button>
            <span>${p.periodoFormatted}</span>
            ${p.isLatest ? ' <span style="font-size:11px; background:rgba(48,209,88,0.15); color:#30d158; padding:2px 6px; border-radius:4px; margin-left:4px;">Actual</span>' : ''}
          </td>
          <td class="text-right font-medium">$${formatValue(p.totalDeuda)}</td>
          <td class="text-center">
            <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${this.getColorForSituacion(p.peorSit)}; margin-right:6px;"></span>
            Sit. ${p.peorSit}
          </td>
          <td class="text-center">${p.cantEntidades} ${p.cantEntidades === 1 ? 'banco' : 'bancos'}</td>
          <td class="text-center">
            <button type="button" class="btn btn-outline btn-sm btn-detalle-trigger" data-periodo-btn="${p.rawPeriodo}" style="font-size:11px; padding:4px 10px; cursor:pointer; display:inline-flex; align-items:center; gap:5px;">
              <i class="fa-solid fa-chevron-down"></i> <span>Ver bancos</span>
            </button>
          </td>
        `;

        // Fila acordeón expandible (subrow)
        const trSub = document.createElement('tr');
        trSub.className = 'historico-subrow hidden';
        trSub.id = `subrow-${p.rawPeriodo}`;

        const entsActivas = p.entidades || [];
        const rawItem = this.periodosHistoricos.find(x => String(x.periodo) === String(p.rawPeriodo));
        const totalEntsConsultadas = rawItem?.entidades?.length || 0;
        const otrasEntsCount = Math.max(0, totalEntsConsultadas - entsActivas.length);

        trSub.innerHTML = `
          <td colspan="5">
            <div class="historico-subcard">
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: rgba(255,255,255,0.03); border-radius: 6px; margin-bottom: 12px; border-left: 3px solid ${this.getColorForSituacion(p.peorSit)}; flex-wrap: wrap; gap: 8px;">
                <span style="font-size: 13px; color: var(--text-main);">
                  <i class="fa-solid fa-building-columns" style="color: #bf5af2; margin-right: 6px;"></i>
                  Entidades informantes para <strong>${p.periodoFormatted}</strong> (Deuda Consolidada: <strong>$${formatValue(p.totalDeuda)}</strong>)
                </span>
                <span style="font-size: 12px; color: var(--text-secondary);">
                  Peor calificación: <strong style="color:${this.getColorForSituacion(p.peorSit)};">Situación ${p.peorSit} (${this.getNombreSituacion(p.peorSit)})</strong>
                </span>
              </div>
              ${entsActivas.length > 0 ? `
                <div class="table-wrapper" style="margin: 0;">
                  <table class="mini-data-table">
                    <thead>
                      <tr>
                        <th style="text-align: left;">Banco / Entidad Otorgante</th>
                        <th class="text-right">Monto Deuda ($)</th>
                        <th class="text-center">Situación Crediticia</th>
                        <th class="text-center">Estado Oficial</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${entsActivas.map(e => {
                        const sit = parseInt(e.situacion || 1, 10);
                        const montoPesos = parseFloat(e.monto || 0) * 1000;
                        return `
                          <tr>
                            <td class="font-medium">${e.entidad || 'Entidad Financiera'}</td>
                            <td class="text-right font-medium">$${formatValue(montoPesos)}</td>
                            <td class="text-center">
                              <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${this.getColorForSituacion(sit)}; margin-right:6px;"></span>
                              Sit. ${sit} (${this.getNombreSituacion(sit)})
                            </td>
                            <td class="text-center" style="font-size: 11.5px; color: ${e.procesoJud ? '#ff453a' : (e.enRevision ? '#ff9500' : '#30d158')};">
                              ${e.procesoJud ? '<i class="fa-solid fa-gavel"></i> Proceso Judicial' : (e.enRevision ? '<i class="fa-solid fa-rotate"></i> En Revisión' : '<i class="fa-solid fa-check"></i> Normal')}
                            </td>
                          </tr>
                        `;
                      }).join('')}
                    </tbody>
                  </table>
                </div>
                ${otrasEntsCount > 0 ? `
                  <div style="font-size: 11px; color: var(--text-muted); margin-top: 8px; text-align: right;">
                    <i class="fa-solid fa-circle-info"></i> ${otrasEntsCount} entidad(es) adicional(es) consultada(s) sin saldo deudor en este período.
                  </div>
                ` : ''}
              ` : `
                <div style="padding: 12px; text-align: center; color: #30d158; font-size: 13px;">
                  <i class="fa-solid fa-circle-check" style="margin-right: 6px;"></i>
                  No se registraron deudas activas ni morosidad informadas en este período.
                </div>
              `}
            </div>
          </td>
        `;

        // Event listener para desplegar/contraer
        const toggleHandler = () => {
          this.toggleSubrow(p.rawPeriodo);
          if (selectEl) selectEl.value = p.rawPeriodo;
          this.selectPeriodo(p.rawPeriodo, false);
        };

        trMain.querySelector('.btn-expand-periodo')?.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleHandler();
        });

        trMain.querySelector('.btn-detalle-trigger')?.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleHandler();
        });

        trMain.addEventListener('click', toggleHandler);

        tableBody.appendChild(trMain);
        tableBody.appendChild(trSub);
      });
    }

    // 3. Renderizar Gráfico de Evolución Histórica con Chart.js
    this.renderHistoryChart(processedPeriods);

    histContainer.classList.remove('hidden');
  },

  toggleSubrow(periodoStr, forceOpen = false) {
    const subrow = document.getElementById(`subrow-${periodoStr}`);
    const btnExpand = document.querySelector(`[data-expand-periodo="${periodoStr}"]`);
    const btnDetalle = document.querySelector(`[data-periodo-btn="${periodoStr}"]`);
    if (!subrow) return;

    const isCurrentlyHidden = subrow.classList.contains('hidden');
    const shouldOpen = forceOpen ? true : isCurrentlyHidden;

    if (shouldOpen) {
      subrow.classList.remove('hidden');
      if (btnExpand) {
        btnExpand.classList.add('expanded');
        btnExpand.innerHTML = '<i class="fa-solid fa-minus"></i>';
      }
      if (btnDetalle) {
        btnDetalle.innerHTML = '<i class="fa-solid fa-chevron-up"></i> <span>Ocultar</span>';
      }
    } else {
      subrow.classList.add('hidden');
      if (btnExpand) {
        btnExpand.classList.remove('expanded');
        btnExpand.innerHTML = '<i class="fa-solid fa-plus"></i>';
      }
      if (btnDetalle) {
        btnDetalle.innerHTML = '<i class="fa-solid fa-chevron-down"></i> <span>Ver bancos</span>';
      }
    }
  },

  renderHistoryChart(processedPeriods) {
    const canvas = document.getElementById('deudorHistoryChart');
    if (!canvas || typeof Chart === 'undefined') return;

    if (this.historyChart) {
      unregisterChart(this.historyChart);
      this.historyChart = null;
    }

    // Orden cronológico (del más antiguo al más reciente) para la línea de tiempo
    const chronological = [...processedPeriods].reverse();
    const labels = chronological.map(p => {
      const perStr = p.rawPeriodo;
      return perStr.length === 6 ? `${perStr.slice(4)}/${perStr.slice(2, 4)}` : perStr;
    });

    const dataDeuda = chronological.map(p => p.totalDeuda);
    const backgroundColors = chronological.map(p => this.getColorForSituacion(p.peorSit));

    // Cálculos de MÁX, MÍN y PROMEDIO (sin decimales, separando miles con punto)
    const maxDeuda = dataDeuda.length > 0 ? Math.max(...dataDeuda) : 0;
    const deudasPositivas = dataDeuda.filter(d => d > 0);
    const minDeuda = deudasPositivas.length > 0 ? Math.min(...deudasPositivas) : (dataDeuda.length > 0 ? Math.min(...dataDeuda) : 0);
    const totalSuma = dataDeuda.reduce((acc, v) => acc + (Number(v) || 0), 0);
    const avgDeuda = dataDeuda.length > 0 ? (totalSuma / dataDeuda.length) : 0;

    // Actualizar etiquetas en la cabecera
    const pillMax = document.getElementById('pillMaxDeuda');
    const pillMin = document.getElementById('pillMinDeuda');
    const pillAvg = document.getElementById('pillAvgDeuda');
    if (pillMax) pillMax.innerHTML = `<i class="fa-solid fa-arrow-up"></i> MÁX: ${formatMilesSinDecimales(maxDeuda)}`;
    if (pillMin) pillMin.innerHTML = `<i class="fa-solid fa-arrow-down"></i> MÍN: ${formatMilesSinDecimales(minDeuda)}`;
    if (pillAvg) pillAvg.innerHTML = `<i class="fa-solid fa-ellipsis"></i> PROMEDIO: ${formatMilesSinDecimales(avgDeuda)}`;

    const isDark = document.body.classList.contains('dark-theme');
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';
    const textColor = isDark ? '#94a3b8' : '#64748b';

    // Plugin para renderizar etiquetas MÁX y MÍN directamente sobre los puntos del gráfico
    const maxMinLabelsPlugin = {
      id: 'maxMinLabelsPlugin',
      afterDatasetsDraw: (chart) => {
        if (!dataDeuda || dataDeuda.length === 0) return;
        const ctx = chart.ctx;
        const metaBar = chart.getDatasetMeta(0);
        if (!metaBar || !metaBar.data || metaBar.data.length === 0) return;

        const maxIdx = dataDeuda.indexOf(maxDeuda);
        const minIdx = dataDeuda.indexOf(minDeuda);
        const isDarkMode = document.body.classList.contains('dark-theme');

        const drawBadge = (idx, labelText, valueText, bgCol, textCol) => {
          if (idx < 0 || idx >= metaBar.data.length) return;
          const elem = metaBar.data[idx];
          if (!elem) return;

          const fullText = `${labelText} ${valueText}`;
          ctx.save();
          ctx.font = 'bold 11px Inter, system-ui, sans-serif';
          const textWidth = ctx.measureText(fullText).width;
          const padX = 8;
          const padY = 3;
          const w = textWidth + (padX * 2);
          const h = 20;

          let boxX = elem.x - (w / 2);
          if (boxX < chart.chartArea.left + 4) boxX = chart.chartArea.left + 4;
          if (boxX + w > chart.chartArea.right - 4) boxX = chart.chartArea.right - w - 4;

          let boxY = elem.y - h - 6;
          if (boxY < chart.chartArea.top + 4) {
            boxY = elem.y + 8;
          }

          ctx.fillStyle = bgCol;
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(boxX, boxY, w, h, 4);
          } else {
            ctx.rect(boxX, boxY, w, h);
          }
          ctx.fill();

          ctx.strokeStyle = isDarkMode ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.15)';
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.fillStyle = textCol;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(fullText, boxX + (w / 2), boxY + (h / 2));
          ctx.restore();
        };

        if (maxIdx >= 0 && maxDeuda > 0) {
          drawBadge(maxIdx, 'MÁX:', formatMilesSinDecimales(maxDeuda), isDarkMode ? '#10b981' : '#059669', '#ffffff');
        }
        if (minIdx >= 0 && minIdx !== maxIdx && minDeuda > 0) {
          drawBadge(minIdx, 'MÍN:', formatMilesSinDecimales(minDeuda), isDarkMode ? '#6366f1' : '#4f46e5', '#ffffff');
        }

        // Etiqueta en el extremo de la línea punteada de promedio
        const yAvg = chart.scales.y.getPixelForValue(avgDeuda);
        if (yAvg >= chart.chartArea.top && yAvg <= chart.chartArea.bottom) {
          ctx.save();
          ctx.font = 'bold 10px Inter, system-ui, sans-serif';
          const avgText = `PROMEDIO: ${formatMilesSinDecimales(avgDeuda)}`;
          const avgW = ctx.measureText(avgText).width + 12;
          const avgH = 18;
          const avgX = chart.chartArea.right - avgW - 6;
          const avgY = yAvg - (avgH / 2);

          ctx.fillStyle = isDarkMode ? '#1e293b' : '#ffffff';
          ctx.strokeStyle = '#ff9f0a';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(avgX, avgY, avgW, avgH, 4);
          else ctx.rect(avgX, avgY, avgW, avgH);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = isDarkMode ? '#ff9f0a' : '#b45309';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(avgText, avgX + (avgW / 2), avgY + (avgH / 2));
          ctx.restore();
        }
      }
    };

    const ctx = canvas.getContext('2d');
    this.historyChart = new Chart(ctx, {
      type: 'bar',
      plugins: [maxMinLabelsPlugin],
      data: {
        labels,
        datasets: [
          {
            label: 'Deuda Consolidada ($)',
            data: dataDeuda,
            backgroundColor: backgroundColors,
            borderColor: backgroundColors,
            borderWidth: 1,
            borderRadius: 4,
            barPercentage: 0.7,
            order: 2
          },
          {
            label: 'Tendencia ($)',
            data: dataDeuda,
            type: 'line',
            borderColor: '#bf5af2',
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#bf5af2',
            tension: 0.25,
            order: 1
          },
          {
            label: `Promedio: ${formatMilesSinDecimales(avgDeuda)}`,
            data: labels.map(() => Math.round(avgDeuda)),
            type: 'line',
            borderColor: '#ff9f0a',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [6, 4], // Líneas punteadas
            pointRadius: 0,
            pointHoverRadius: 0,
            fill: false,
            order: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: isDark ? '#0f172a' : '#ffffff',
            titleColor: isDark ? '#f8fafc' : '#0f172a',
            bodyColor: isDark ? '#94a3b8' : '#64748b',
            borderColor: gridColor,
            borderWidth: 1,
            callbacks: {
              title: (items) => {
                const idx = items[0]?.dataIndex;
                const p = chronological[idx];
                return p ? `Período: ${p.periodoFormatted}` : '';
              },
              label: (item) => {
                if (item.datasetIndex === 1 || item.datasetIndex === 2) return null; // no repetir línea ni promedio
                const p = chronological[item.dataIndex];
                if (!p) return '';
                return [
                  `Deuda: $${formatValue(p.totalDeuda)}`,
                  `Peor Situación: ${p.peorSit} (${this.getNombreSituacion(p.peorSit)})`,
                  `Bancos informantes: ${p.cantEntidades}`
                ];
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { size: 10 } }
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { size: 10 },
              callback: (val) => `$${formatValueCompact(val)}`
            }
          }
        },
        onClick: (evt, elements) => {
          if (elements && elements.length > 0) {
            const idx = elements[0].index;
            const targetPeriod = chronological[idx];
            if (targetPeriod) {
              const selectEl = document.getElementById('deudorPeriodoSelect');
              if (selectEl) selectEl.value = targetPeriod.rawPeriodo;
              this.selectPeriodo(targetPeriod.rawPeriodo, true);

              // Asegurar que la tabla histórica esté visible y desplegar el subrow
              const wrapper = document.getElementById('deudorHistoricoTableWrapper');
              const btnToggleHistTable = document.getElementById('btnToggleHistoricoTable');
              if (wrapper && wrapper.classList.contains('hidden')) {
                wrapper.classList.remove('hidden');
                if (btnToggleHistTable) btnToggleHistTable.innerHTML = '<i class="fa-solid fa-eye-slash"></i> Ocultar Tabla';
              }
              this.toggleSubrow(targetPeriod.rawPeriodo, true);
              const subrowEl = document.getElementById(`subrow-${targetPeriod.rawPeriodo}`);
              if (subrowEl) subrowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
        }
      }
    });

    registerChart(this.historyChart);
  },

  async capturarPantallaDeudor() {
    const container = document.getElementById('deudoresResultContainer');
    const btn = document.getElementById('btnCapturarPantallaDeudor');
    if (!container || !btn) return;

    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Capturando...';

    try {
      const cuitLimpio = String(this.cuitActual || 'reporte').replace(/\D/g, '');
      const isDark = document.body.classList.contains('dark-theme');
      const filename = `situacion_crediticia_${cuitLimpio}_${Date.now()}.png`;

      if (typeof window.html2canvas === 'function') {
        const canvas = await window.html2canvas(container, {
          backgroundColor: isDark ? '#060913' : '#ffffff',
          scale: 2,
          useCORS: true,
          logging: false,
          ignoreElements: (el) => el.id === 'btnCapturarPantallaDeudor'
        });

        canvas.toBlob((blob) => {
          if (blob) {
            downloadBlob(blob, filename, 'image/png');
            showToast('Captura de pantalla descargada correctamente', 'success');
          } else {
            this.capturarConCanvasNativo(filename);
          }
        }, 'image/png');
      } else {
        this.capturarConCanvasNativo(filename);
      }
    } catch (err) {
      console.warn('html2canvas falló o no disponible, usando fallback nativo:', err);
      try {
        const cuitLimpio = String(this.cuitActual || 'reporte').replace(/\D/g, '');
        this.capturarConCanvasNativo(`situacion_crediticia_${cuitLimpio}_${Date.now()}.png`);
      } catch (fallbackErr) {
        showToast('No se pudo generar la captura de pantalla: ' + err.message, 'error');
      }
    } finally {
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }, 600);
    }
  },

  capturarConCanvasNativo(filename) {
    const isDark = document.body.classList.contains('dark-theme');
    const width = 1200;
    const height = 750;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Fondo
    ctx.fillStyle = isDark ? '#060913' : '#f8fafc';
    ctx.fillRect(0, 0, width, height);

    // Contenedor tipo tarjeta
    ctx.fillStyle = isDark ? '#0f172a' : '#ffffff';
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    ctx.lineWidth = 1;
    if (ctx.roundRect) ctx.roundRect(30, 30, width - 60, height - 60, 12);
    else ctx.rect(30, 30, width - 60, height - 60);
    ctx.fill();
    ctx.stroke();

    // Cabecera: Nombre y CUIT
    const nombre = document.getElementById('deudorNombre')?.textContent || 'CONTRIBUYENTE CONSULTADO';
    const cuit = document.getElementById('deudorCuit')?.textContent || `CUIT: ${this.cuitActual}`;
    const badgeText = document.getElementById('deudorBadgeText')?.textContent || 'SITUACIÓN 1';

    ctx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
    ctx.font = 'bold 22px Inter, system-ui, sans-serif';
    ctx.fillText(nombre, 60, 80);

    ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
    ctx.font = '14px Inter, system-ui, sans-serif';
    ctx.fillText(cuit, 60, 108);

    // Badge Situación
    ctx.fillStyle = isDark ? 'rgba(48, 209, 88, 0.2)' : 'rgba(22, 163, 74, 0.15)';
    ctx.strokeStyle = '#30d158';
    ctx.lineWidth = 1;
    const badgeW = 220;
    if (ctx.roundRect) ctx.roundRect(width - 60 - badgeW, 65, badgeW, 36, 6);
    else ctx.rect(width - 60 - badgeW, 65, badgeW, 36);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isDark ? '#30d158' : '#15803d';
    ctx.font = 'bold 12.5px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(badgeText, width - 60 - (badgeW / 2), 88);
    ctx.textAlign = 'left';

    // 4 Métricas principales
    const peorSit = document.getElementById('deudorPeorSituacion')?.textContent || '-';
    const deudaCons = document.getElementById('deudorTotalDeuda')?.textContent || '$0';
    const cantEnt = document.getElementById('deudorCantEntidades')?.textContent || '0';
    const cheques = document.getElementById('deudorChequesRechazados')?.textContent || '0';

    const metrics = [
      { label: 'PEOR ESTADO', val: peorSit, col: '#ff9f0a' },
      { label: 'DEUDA CONSOLIDADA', val: deudaCons, col: '#30d158' },
      { label: 'BANCOS CONSULTADOS', val: cantEnt, col: isDark ? '#f8fafc' : '#0f172a' },
      { label: 'CHEQUES RECHAZADOS', val: cheques, col: '#30d158' }
    ];

    const cardW = 250;
    const startX = 60;
    const cardY = 140;
    metrics.forEach((m, idx) => {
      const cx = startX + (idx * 270);
      ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.03)' : '#f1f5f9';
      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';
      if (ctx.roundRect) ctx.roundRect(cx, cardY, cardW, 80, 8);
      else ctx.rect(cx, cardY, cardW, 80);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
      ctx.font = 'bold 11px Inter, system-ui, sans-serif';
      ctx.fillText(m.label, cx + 16, cardY + 28);

      ctx.fillStyle = m.col;
      ctx.font = 'bold 20px Inter, system-ui, sans-serif';
      ctx.fillText(m.val, cx + 16, cardY + 58);
    });

    // Gráfico de historia si existe
    if (this.historyChart && this.historyChart.canvas) {
      try {
        ctx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
        ctx.font = 'bold 16px Inter, system-ui, sans-serif';
        ctx.fillText('Evolución Crediticia Histórica (Últimos 24 Meses)', 60, 260);

        ctx.drawImage(this.historyChart.canvas, 60, 280, width - 120, 380);
      } catch (drawErr) {
        console.warn('No se pudo estampar el canvas del chart:', drawErr);
      }
    }

    canvas.toBlob((blob) => {
      if (blob) {
        downloadBlob(blob, filename, 'image/png');
        showToast('Captura descargada correctamente', 'success');
      }
    }, 'image/png');
  },

  selectPeriodo(periodoStr, showToastMsg = true) {
    if (!periodoStr || !this.periodosHistoricos) return;

    const target = this.periodosHistoricos.find(p => String(p.periodo) === String(periodoStr));
    if (!target) return;

    const perStr = String(target.periodo || '');
    const formatted = perStr.length === 6 ? `${perStr.slice(4)}/${perStr.slice(0, 4)}` : perStr;
    const entidades = target.entidades || [];

    const deudas = entidades
      .filter(ent => (ent.monto || 0) > 0 || (ent.situacion && ent.situacion > 0))
      .map(ent => ({
        entidad: ent.entidad || 'Entidad Financiera',
        monto: parseFloat(ent.monto || 0) * 1000,
        situacion: parseInt(ent.situacion || 1, 10),
        periodo: formatted
      }));

    this.renderDeudasTable(deudas);
    if (showToastMsg) {
      showToast(`Mostrando detalle de deudas para el período ${formatted}.`, 'info');
    }
  },

  getNombreSituacion(sit) {
    const nombres = {
      1: 'Normal',
      2: 'Seguimiento especial',
      3: 'Con problemas',
      4: 'Alto riesgo de insolvencia',
      5: 'Irrecuperable',
      6: 'Irrecuperable por disp. técnica'
    };
    return nombres[sit] || 'Normal';
  },

  getColorForSituacion(sit) {
    const colores = {
      1: '#30d158',
      2: '#ffd60a',
      3: '#ff9500',
      4: '#ff453a',
      5: '#8e8e93',
      6: '#bf5af2'
    };
    return colores[sit] || '#30d158';
  },

  // ==========================================
  // VALIDADOR DE CHEQUES DENUNCIADOS
  // ==========================================

  async consultarCheque() {
    const select = document.getElementById('chequeBancoSelect');
    const input = document.getElementById('chequeNumeroInput');
    const errorText = document.getElementById('chequeErrorText');
    const loader = document.getElementById('loadingCheques');
    const resultsContainer = document.getElementById('chequesResultContainer');
    const errorContainer = document.getElementById('chequesErrorContainer');

    if (!select || !input) return;

    const banco = select.value.trim();
    const numero = input.value.trim().replace(/\D/g, '');

    if (errorText) errorText.classList.add('hidden');
    if (resultsContainer) resultsContainer.classList.add('hidden');
    if (errorContainer) errorContainer.classList.add('hidden');

    if (!banco || !numero) {
      if (errorText) errorText.classList.remove('hidden');
      return;
    }

    const cached = clientCache.get(`cheque_${banco}_${numero}`);
    if (cached) {
      this.renderChequeResults(cached, banco, numero);
      return;
    }

    if (loader) loader.classList.remove('hidden');

    try {
      const data = await fetchChequeDenunciado(banco, numero);
      const resultItem = data.results || data;
      const resultObj = {
        denunciado: resultItem.denunciado === true,
        causal: resultItem.causal || resultItem.motivo || null,
        bancoName: select.options[select.selectedIndex]?.text || `Entidad N° ${banco}`
      };
      clientCache.set(`cheque_${banco}_${numero}`, resultObj, 5 * 60 * 1000);
      this.renderChequeResults(resultObj, banco, numero);
    } catch (e) {
      console.warn('[Cheques] Error al consultar estado de cheque en BCRA:', e.message);
      if (resultsContainer) resultsContainer.classList.add('hidden');
      if (errorContainer) {
        const titleEl = document.getElementById('chequeErrorTitle');
        const descEl = document.getElementById('chequeErrorDesc');
        if (titleEl) titleEl.textContent = 'No se pudo verificar el cheque en el BCRA';
        if (descEl) descEl.textContent = e.message || 'Error de conexión con la central de cheques denunciados del BCRA.';
        errorContainer.classList.remove('hidden');
      }
      showToast('No se pudo verificar el cheque con el BCRA.', 'danger');
    } finally {
      if (loader) loader.classList.add('hidden');
    }
  },

  renderChequeResults(data, banco, numero) {
    const ticketContainer = document.getElementById('chequesResultContainer');
    const ticketBg = document.getElementById('chequeTicketBg');
    const title = document.getElementById('chequeResultTitle');
    const subtitle = document.getElementById('chequeResultSubtitle');
    const iconWrapper = document.getElementById('chequeResultIconWrapper');
    const desc = document.getElementById('chequeResultDesc');

    if (!ticketContainer || !ticketBg) return;

    const bancoText = data.bancoName || `Entidad N° ${banco}`;
    if (subtitle) subtitle.textContent = `${bancoText} — Cheque N° ${numero}`;

    ticketBg.className = 'cheques-ticket';

    if (data.denunciado) {
      ticketBg.classList.add('denunciado');
      ticketBg.style.background = 'rgba(255, 69, 58, 0.08)';
      ticketBg.style.borderColor = '#ff453a';
      if (title) {
        title.textContent = 'CHEQUE CON DENUNCIA REGISTRADA';
        title.style.color = '#ff453a';
      }
      if (iconWrapper) iconWrapper.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color: #ff453a;"></i>';
      if (desc) desc.textContent = `ATENCIÓN: El cheque N° ${numero} se encuentra registrado como DENUNCIADO en la base oficial del BCRA${data.causal ? ` bajo la causal: "${data.causal}"` : ''}. No negociar ni cobrar.`;
      showToast('¡Alerta! Cheque registrado con denuncias en el BCRA.', 'danger');
    } else {
      ticketBg.style.background = 'rgba(48, 209, 88, 0.08)';
      ticketBg.style.borderColor = '#30d158';
      if (title) {
        title.textContent = 'CHEQUE SIN DENUNCIAS REGISTRADAS';
        title.style.color = '#30d158';
      }
      if (iconWrapper) iconWrapper.innerHTML = '<i class="fa-solid fa-circle-check" style="color: #30d158;"></i>';
      if (desc) desc.textContent = `El cheque N° ${numero} no registra denuncias activas por robo, extravío o adulteración en la central oficial del Banco Central a la fecha de hoy. Se encuentra apto para transacciones normales.`;
      showToast('Cheque verificado sin denuncias en el BCRA.', 'success');
    }

    ticketContainer.classList.remove('hidden');
  }
};
