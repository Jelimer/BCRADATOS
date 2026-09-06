/**
 * tabCripto.js
 * Submódulo de integración de CriptoYa y Rendimientos Fintech:
 * - Tarjeta de Dólar Cripto en Mercado de Cambios (pestaña Dólares).
 * - Tabla comparativa de Cuentas y Billeteras Remuneradas (pestaña Comparador).
 */

import { fetchCriptoYaDolar, fetchFinanzasRendimientos } from './api.js';
import { clientCache, appState } from './state.js';
import { formatValue } from './utils.js';
import { showToast } from './ui.js';

export const tabCripto = {
  /**
   * Actualiza los datos de la tarjeta de Dólar Cripto en la pestaña de Mercado de Cambios.
   * @param {Object} [dolarData] Si no se provee, consulta la API directamente.
   */
  async updateDolarCriptoCard(dolarData = null) {
    const card = document.getElementById('cardDolarCripto');
    const valueEl = document.getElementById('dolarCriptoValue');
    const brechaEl = document.getElementById('brechaCriptoValue');

    if (!card || !valueEl) return;

    try {
      let data = dolarData;
      if (!data) {
        const cached = clientCache.get('criptoya_dolar_card');
        if (cached) {
          data = cached;
        } else {
          const res = await fetchCriptoYaDolar();
          data = res.results || res;
          clientCache.set('criptoya_dolar_card', data, 30 * 1000); // 30 segundos TTL
        }
      }

      if (data && data.cripto) {
        const venta = data.cripto.venta || data.cripto.precio || 0;
        valueEl.textContent = `$${formatValue(venta)}`;
        appState.dolares.live.cripto = venta;

        if (brechaEl) {
          const brechaVal = (data.brechas && data.brechas.criptoVsOficial !== undefined)
            ? data.brechas.criptoVsOficial
            : (appState.dolares.live.oficial > 0 
                ? (((venta - appState.dolares.live.oficial) / appState.dolares.live.oficial) * 100).toFixed(2)
                : 0);
          brechaEl.textContent = `Brecha: ${brechaVal}%`;
        }
      }
    } catch (error) {
      console.warn('Error al actualizar tarjeta de Dólar Cripto:', error.message);
      if (valueEl.textContent === '-') {
        // Fallback derivado si no responde CriptoYa
        const refMep = appState.dolares.live.mep || 1200;
        const fallbackCripto = Number((refMep * 1.02).toFixed(2));
        valueEl.textContent = `$${formatValue(fallbackCripto)}`;
        if (brechaEl && appState.dolares.live.oficial > 0) {
          const b = (((fallbackCripto - appState.dolares.live.oficial) / appState.dolares.live.oficial) * 100).toFixed(2);
          brechaEl.textContent = `Brecha: ${b}%`;
        }
      }
    }
  },

  /**
   * Carga y renderiza la tabla de Billeteras Virtuales y Cuentas Remuneradas en el Comparador.
   */
  async loadRendimientos(filterQuery = '') {
    const tbody = document.getElementById('cuentasRemuneradasTableBody');
    if (!tbody) return;

    try {
      let rendimientos = appState.comparador.cuentasRemuneradas;

      if (!rendimientos || rendimientos.length === 0) {
        const cached = clientCache.get('finanzas_rendimientos_ars');
        if (cached && cached.length > 0) {
          rendimientos = cached;
        } else {
          const res = await fetchFinanzasRendimientos('ARS');
          rendimientos = Array.isArray(res) ? res : (res.results || []);
          clientCache.set('finanzas_rendimientos_ars', rendimientos, 10 * 60 * 1000); // 10 min TTL
        }
        appState.comparador.cuentasRemuneradas = rendimientos;
      }

      // Filtrar por término de búsqueda si existe
      const term = filterQuery.toLowerCase().trim();
      const filtered = term
        ? rendimientos.filter(item => 
            (item.nombre && item.nombre.toLowerCase().includes(term)) ||
            (item.entidad && item.entidad.toLowerCase().includes(term))
          )
        : rendimientos;

      tbody.innerHTML = '';

      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="padding: 20px; color: var(--text-secondary);">No se encontraron entidades o billeteras disponibles en este momento.</td></tr>';
        return;
      }

      filtered.forEach(item => {
        const tr = document.createElement('tr');
        const apy = Number(item.apy || 0);
        const mensual = Number(item.rendimientoMensual || (apy / 12).toFixed(2));
        const tope = item.topeBonificado 
          ? `Hasta $${formatValue(item.topeBonificado)}` 
          : 'Sin tope informado';

        tr.innerHTML = `
          <td>
            <div style="display: flex; align-items: center; gap: 10px;">
              <i class="fa-solid fa-wallet" style="color: var(--theme-cripto, #00f0ff); font-size: 16px;"></i>
              <strong>${item.nombre || item.entidad}</strong>
            </div>
          </td>
          <td class="text-right font-medium" style="color: var(--success); font-weight: 700;">
            ${apy.toFixed(2)}%
          </td>
          <td class="text-right" style="font-weight: 600;">
            ${mensual.toFixed(2)}%
          </td>
          <td class="text-right" style="color: var(--text-secondary); font-size: 12.5px;">
            ${tope}
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (error) {
      console.error('Error al cargar rendimientos fintech:', error);
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-danger" style="padding: 20px;">Error al sincronizar rendimientos de billeteras virtuales.</td></tr>';
      showToast('Error al obtener rendimientos de billeteras fintech.', 'warning');
    }
  }
};
