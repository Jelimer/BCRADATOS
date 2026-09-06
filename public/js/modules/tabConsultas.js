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
import { formatValue, formatValueCompact, isValidCuit } from './utils.js';
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
    const periodoSelect = document.getElementById('deudorPeriodoSelect');
    const btnToggleHistTable = document.getElementById('btnToggleHistoricoTable');

    if (btnDeudores) btnDeudores.addEventListener('click', () => this.switchSubTab('deudores'));
    if (btnCheques) btnCheques.addEventListener('click', () => this.switchSubTab('cheques'));

    if (btnConsultarD) btnConsultarD.addEventListener('click', () => this.consultarDeudor());
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

    if (!input) return;

    const cuit = input.value.trim().replace(/\D/g, '');
    if (errorText) errorText.classList.add('hidden');
    if (resultsContainer) resultsContainer.classList.add('hidden');
    if (errorContainer) errorContainer.classList.add('hidden');
    if (historicoContainer) historicoContainer.classList.add('hidden');

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
        const isMaintenance = /mantenimiento|503/i.test(error.message);

        if (isMaintenance) {
          if (titleEl) titleEl.textContent = 'Servicio Oficial del BCRA en Mantenimiento Temporal';
          if (descEl) {
            descEl.innerHTML = `El servidor oficial del Banco Central (BCRA) informa actualmente: <strong>"El servicio se encuentra en mantenimiento."</strong><br>
            La API pública de la Central de Deudores suele interrumpirse por mantenimiento técnico programado durante fines de semana y horarios no bancarios.<br>
            Las consultas oficiales en vivo se restablecerán de forma automática una vez concluida la ventana de mantenimiento del BCRA.`;
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
  // RENDERIZADO DE RESULTADOS PRINCIPALES
  // ==========================================

  renderDeudorResults(data, cuit) {
    const resultsContainer = document.getElementById('deudoresResultContainer');
    const errorContainer = document.getElementById('deudoresErrorContainer');
    if (errorContainer) errorContainer.classList.add('hidden');

    const results = data.results || data;
    const periodos = results.periodos || [];
    const tieneDeuda = results.tieneDeuda !== false && periodos.length > 0;

    let nombre = results.denominacion || 'CONSULTA SATISFACTORIA (SIN DEUDAS)';
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
    const deudorNombreEl = document.getElementById('deudorNombre');
    if (deudorNombreEl) deudorNombreEl.textContent = nombre.toUpperCase();

    const deudorCuitEl = document.getElementById('deudorCuit');
    if (deudorCuitEl) deudorCuitEl.textContent = `CUIT/CUIL: ${cleanCuit.slice(0, 2)}-${cleanCuit.slice(2, 10)}-${cleanCuit.slice(10)}`;

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
        No se registran deudas activas ni morosidad informadas para este período.
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

    // 2. Llenar la tabla histórica de los 24 meses
    if (tableBody) {
      tableBody.innerHTML = '';
      processedPeriods.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="font-medium">${p.periodoFormatted}${p.isLatest ? ' <span style="font-size:11px; background:rgba(48,209,88,0.15); color:#30d158; padding:2px 6px; border-radius:4px;">Actual</span>' : ''}</td>
          <td class="text-right font-medium">$${formatValue(p.totalDeuda)}</td>
          <td class="text-center">
            <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${this.getColorForSituacion(p.peorSit)}; margin-right:6px;"></span>
            Sit. ${p.peorSit}
          </td>
          <td class="text-center">${p.cantEntidades} ${p.cantEntidades === 1 ? 'banco' : 'bancos'}</td>
          <td class="text-center">
            <button type="button" class="btn btn-outline btn-sm" data-select-periodo="${p.rawPeriodo}" style="font-size:11px; padding:3px 8px; cursor:pointer;">
              Ver detalle
            </button>
          </td>
        `;
        const btn = tr.querySelector('button');
        if (btn) {
          btn.addEventListener('click', () => {
            if (selectEl) selectEl.value = p.rawPeriodo;
            this.selectPeriodo(p.rawPeriodo);
            // Scroll suave hacia la tabla de deudas
            const tableEl = document.getElementById('deudasTable');
            if (tableEl) tableEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
        }
        tableBody.appendChild(tr);
      });
    }

    // 3. Renderizar Gráfico de Evolución Histórica con Chart.js
    this.renderHistoryChart(processedPeriods);

    histContainer.classList.remove('hidden');
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

    const isDark = document.body.classList.contains('dark-theme');
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';
    const textColor = isDark ? '#94a3b8' : '#64748b';

    const ctx = canvas.getContext('2d');
    this.historyChart = new Chart(ctx, {
      type: 'bar',
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
                if (item.datasetIndex === 1) return null; // no repetir línea
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
              this.selectPeriodo(targetPeriod.rawPeriodo);
            }
          }
        }
      }
    });

    registerChart(this.historyChart);
  },

  selectPeriodo(periodoStr) {
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
    showToast(`Mostrando detalle de deudas para el período ${formatted}.`, 'info');
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
