import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatMilesSinDecimales } from '../public/js/modules/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

describe('Préstamos Hipotecarios Theme & Deudores BCRA Captura / Indicadores', () => {
  it('1. formatMilesSinDecimales formatea con punto de miles y sin decimales en pesos', () => {
    assert.equal(formatMilesSinDecimales(16500000), '$16.500.000');
    assert.equal(formatMilesSinDecimales(4200000), '$4.200.000');
    assert.equal(formatMilesSinDecimales(8950000.75), '$8.950.001');
    assert.equal(formatMilesSinDecimales(0), '$0');
    assert.equal(formatMilesSinDecimales(null), '$0');
  });

  it('2. index.html contiene el botón de captura de pantalla y los badges MÁX, MÍN, PROMEDIO', () => {
    const html = fs.readFileSync(path.join(ROOT_DIR, 'public/index.html'), 'utf8');
    
    assert.ok(html.includes('id="btnCapturarPantallaDeudor"'), 'Debe existir el botón #btnCapturarPantallaDeudor');
    assert.ok(html.includes('id="pillMaxDeuda"'), 'Debe existir el badge #pillMaxDeuda');
    assert.ok(html.includes('id="pillMinDeuda"'), 'Debe existir el badge #pillMinDeuda');
    assert.ok(html.includes('id="pillAvgDeuda"'), 'Debe existir el badge #pillAvgDeuda');
    assert.ok(html.includes('html2canvas'), 'Debe cargar la biblioteca html2canvas para la captura');
  });

  it('3. tabComparador.js utiliza clases CSS responsivas al tema y no colores fijos blancos sobre fondo claro', () => {
    const code = fs.readFileSync(path.join(ROOT_DIR, 'public/js/modules/tabComparador.js'), 'utf8');
    
    assert.ok(code.includes('class="hipo-bank-name"'), 'Los nombres de bancos deben usar .hipo-bank-name');
    assert.ok(code.includes('class="text-right hipo-cuota-sim"'), 'La cuota simulada debe usar .hipo-cuota-sim');
    assert.ok(!code.includes('style="font-weight: 600; color: #fff;"'), 'No debe tener color blanco inline en el nombre del banco');
  });

  it('4. style.css define colores adaptables entre Modo Claro y Modo Oscuro para Préstamos Hipotecarios', () => {
    const css = fs.readFileSync(path.join(ROOT_DIR, 'public/style.css'), 'utf8');
    
    assert.ok(css.includes('.hipo-bank-name'), 'Debe definir .hipo-bank-name');
    assert.ok(css.includes('body.dark-theme .hipo-bank-name'), 'Debe definir regla para dark-theme');
    assert.ok(css.includes('.hipo-cuota-sim'), 'Debe definir .hipo-cuota-sim');
    assert.ok(css.includes('body.dark-theme .hipo-cuota-sim'), 'Debe definir regla oscura para cuota sim');
    assert.ok(css.includes('.stat-pill-avg'), 'Debe definir .stat-pill-avg para la línea punteada de promedio');
  });

  it('5. tabConsultas.js incluye la lógica de captura y el cálculo de promedio con línea punteada', () => {
    const code = fs.readFileSync(path.join(ROOT_DIR, 'public/js/modules/tabConsultas.js'), 'utf8');
    
    assert.ok(code.includes('capturarPantallaDeudor'), 'Debe implementar el método capturarPantallaDeudor()');
    assert.ok(code.includes('borderDash: [6, 4]'), 'El dataset del promedio debe tener borderDash (línea punteada)');
    assert.ok(code.includes('maxMinLabelsPlugin'), 'Debe incluir el plugin para las etiquetas de MÁX y MÍN');
  });
});
