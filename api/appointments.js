import {
  ensureSchema,
  getKV,
  setKV,
  readJsonBody,
} from '../lib/db.js';

// Endpoint publico — o formulario de agendamento esta no modal de login,
// antes da autenticacao. O GET expoe apenas (date, time) para que o
// cliente saiba quais slots estao ocupados, sem vazar dados pessoais.
const APPOINTMENTS_KEY = 'dihmec_appointments';
const CUSTOMERS_HTML_KEY = 'dihmec_customers_html';
const VEHICLES_HTML_KEY = 'dihmec_vehicles_html';

async function readAppointments() {
  try { return JSON.parse((await getKV(APPOINTMENTS_KEY)) || '[]'); }
  catch (e) { return []; }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function extractPlates(html) {
  // tbody html: cada <tr> tem como 1a coluna a placa
  const plates = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/i;
  let m;
  while ((m = rowRe.exec(html || '')) !== null) {
    const c = cellRe.exec(m[1]);
    if (c) plates.push(c[1].replace(/<[^>]+>/g, '').trim().toUpperCase());
  }
  return plates;
}

// Espelha registerVehicleFromSchedule() do front-end: cria as linhas
// HTML de cliente e veiculo. Mantemos o mesmo formato para o front
// renderizar com os botoes Editar/Excluir intactos.
function buildClientVehicleRows({ name, phone, plate, vehicle }) {
  const parts = String(vehicle || '').trim().split(/\s+/);
  const brand = parts.shift() || '-';
  const model = parts.join(' ') || '-';
  const customerId = Date.now();
  const safe = {
    name: escapeHtml(name),
    phone: escapeHtml(phone || '-'),
    plate: escapeHtml(plate),
    brand: escapeHtml(brand),
    model: escapeHtml(model),
  };
  const customerRow =
    `<tr>` +
      `<td>${safe.name}</td>` +
      `<td>-</td>` +
      `<td>${safe.phone}</td>` +
      `<td>${safe.plate}</td>` +
      `<td>${safe.model}</td>` +
      `<td>${safe.brand}</td>` +
      `<td>-</td>` +
      `<td>-</td>` +
      `<td><div class="action-buttons">` +
        `<button class="btn-action btn-edit" onclick="editCustomer(${customerId})">Editar</button>` +
        `<button class="btn-action btn-delete" onclick="deleteCustomer(${customerId})">Excluir</button>` +
      `</div></td>` +
    `</tr>`;
  const vehicleRow =
    `<tr>` +
      `<td>${safe.plate}</td>` +
      `<td>${safe.model}</td>` +
      `<td>${safe.brand}</td>` +
      `<td>-</td>` +
      `<td>-</td>` +
      `<td>${safe.name}</td>` +
      `<td>-</td>` +
      `<td>${safe.phone}</td>` +
      `<td><div class="action-buttons">` +
        `<button class="btn-action btn-edit" onclick="editVehicle('${safe.plate}')">Editar</button>` +
        `<button class="btn-action btn-delete" onclick="deleteVehicle('${safe.plate}')">Excluir</button>` +
      `</div></td>` +
    `</tr>`;
  return { customerRow, vehicleRow };
}

export default async function handler(req, res) {
  try {
    await ensureSchema();
    if (req.method === 'GET') {
      const slots = (await readAppointments()).map((a) => ({ date: a.date, time: a.time }));
      return res.status(200).json({ slots });
    }
    if (req.method === 'POST') {
      const a = await readJsonBody(req);
      if (!a || !a.date || !a.time || !a.name || !a.phone || !a.plate || !a.vehicle || !a.description) {
        return res.status(400).json({ error: 'Preencha todos os campos.' });
      }
      const list = await readAppointments();
      if (list.some((x) => x.date === a.date && x.time === a.time)) {
        return res.status(409).json({ error: 'Horario ja ocupado.' });
      }
      const appointment = {
        name: String(a.name).trim(),
        phone: String(a.phone).trim(),
        plate: String(a.plate).trim().toUpperCase(),
        vehicle: String(a.vehicle).trim(),
        description: String(a.description).trim(),
        date: String(a.date),
        time: String(a.time),
        ts: Date.now(),
      };
      list.push(appointment);
      await setKV(APPOINTMENTS_KEY, JSON.stringify(list));

      // Auto-cadastra cliente/veiculo se a placa for nova.
      const vehiclesHtml = (await getKV(VEHICLES_HTML_KEY)) || '';
      const plates = extractPlates(vehiclesHtml);
      let registered = false;
      if (!plates.includes(appointment.plate)) {
        const { customerRow, vehicleRow } = buildClientVehicleRows(appointment);
        const customersHtml = (await getKV(CUSTOMERS_HTML_KEY)) || '';
        await setKV(CUSTOMERS_HTML_KEY, customersHtml + customerRow);
        await setKV(VEHICLES_HTML_KEY, vehiclesHtml + vehicleRow);
        registered = true;
      }
      return res.status(200).json({ ok: true, appointment, registered });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[api/appointments]', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}
