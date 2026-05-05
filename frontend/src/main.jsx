import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MapContainer, TileLayer, Marker, Circle, Popup, useMapEvents, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import L from 'leaflet';
delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const API = import.meta.env.VITE_API_URL || 'https://timbrature-flotta-online-rev.onrender.com';

const menu = [
  ['dash', '🏠', 'Dashboard'],
  ['cantieri', '📍', 'Cantieri'],
  ['operai', '👷', 'Operai'],
  ['flotta', '🚗', 'Autovetture'],
  ['report', '📊', 'Report paghe'],
];

function authHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api(path, opts = {}) {
  const response = await fetch(API + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(opts.headers || {}),
    },
  });

  if (!response.ok) {
    let msg = '';
    try {
      msg = (await response.json()).detail;
    } catch {
      msg = await response.text();
    }
    throw new Error(msg || 'Errore richiesta');
  }

  return response.json();
}

function fmtDateTime(value) {
  return value
    ? new Date(value).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
    : '—';
}

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('it-IT');
}

function Badge({ children, tone = 'neutral' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function EmptyState({ icon = 'ℹ️', title, text }) {
  return (
    <div className="empty">
      <div>{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function Toast({ message, type = 'info', onClose }) {
  if (!message) return null;
  return (
    <div className={`toast ${type}`} onClick={onClose}>
      {message}
    </div>
  );
}

function MappaTragitto({ points }) {
  const positions = (points || [])
    .filter((p) => p.latitudine && p.longitudine)
    .map((p) => [Number(p.latitudine), Number(p.longitudine)]);

  if (positions.length < 1) return null;

  return (
    <div className="route-map-box">
      <MapContainer
        center={positions[0]}
        zoom={15}
        style={{ height: 320, width: '100%', borderRadius: 18 }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {positions.length > 1 && <Polyline positions={positions} />}

        <Marker position={positions[0]}>
          <Popup>Partenza</Popup>
        </Marker>

        {positions.length > 1 && (
          <Marker position={positions[positions.length - 1]}>
            <Popup>Arrivo / ultimo punto</Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}

function Login({ setSession }) {
  const [email, setEmail] = useState('admin@cantiere.local');
  const [password, setPassword] = useState('admin123');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setLoading(true);

    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      localStorage.setItem('token', data.access_token);
      setSession(data.user);
    } catch {
      setErr('Credenziali non valide o backend non raggiungibile.');
    }

    setLoading(false);
  }

  return (
    <div className="login-screen">
      <section className="login-hero">
        <div className="logo-mark">TC</div>
        <h1>Timbrature Cantiere Pro</h1>
        <p>Gestione presenze geolocalizzate, autovetture aziendali, QR code, tragitti e anomalie.</p>
        <div className="hero-points">
          <span>📍 GPS</span>
          <span>🚗 Flotta</span>
          <span>🧾 Report</span>
        </div>
      </section>

      <form onSubmit={submit} className="login-card">
        <h2>Accesso</h2>

        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />

        <label>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
        />

        <button className="primary big" disabled={loading}>
          {loading ? 'Accesso...' : 'Accedi'}
        </button>

        {err && <div className="alert danger-soft">{err}</div>}

        <p className="hint">
          Demo admin: <strong>admin@cantiere.local</strong> / <strong>admin123</strong>
        </p>
      </form>
    </div>
  );
}

function getGps() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) reject(new Error('GPS non supportato'));

    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p.coords),
      reject,
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
}

function parseVehicleId(text) {
  if (!text) return null;
  const raw = String(text).trim();
  const match = raw.match(/\/vehicle\/(\d+)/) || raw.match(/vehicle[:=](\d+)/) || raw.match(/^(\d+)$/);
  return match ? Number(match[1]) : null;
}

function QrScannerModal({ onClose, onVehicle }) {
  const [manual, setManual] = useState('');
  const [err, setErr] = useState('');
  const scannerRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    import('html5-qrcode')
      .then(({ Html5Qrcode }) => {
        if (!mounted) return;

        const scanner = new Html5Qrcode('qr-reader');
        scannerRef.current = scanner;

        scanner
          .start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: 260, height: 260 } },
            (decoded) => {
              const id = parseVehicleId(decoded);
              if (id) {
                scanner.stop().catch(() => {});
                onVehicle(id);
              } else {
                setErr('QR non riconosciuto.');
              }
            }
          )
          .catch(() => setErr('Fotocamera non disponibile. Puoi incollare il codice/URL QR manualmente.'));
      })
      .catch(() => setErr('Lettore QR non installato. Usa inserimento manuale.'));

    return () => {
      mounted = false;
      if (scannerRef.current) scannerRef.current.stop().catch(() => {});
    };
  }, [onVehicle]);

  function submitManual() {
    const id = parseVehicleId(manual);
    if (id) onVehicle(id);
    else setErr('Inserisci ID auto o URL /vehicle/ID');
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="modal-head">
          <h2>Scansiona QR autovettura</h2>
          <button className="ghost" onClick={onClose}>Chiudi</button>
        </div>

        <div id="qr-reader" className="qr-reader"></div>

        {err && <div className="alert danger">{err}</div>}

        <div className="manual-qr">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Incolla URL QR o ID auto"
          />
          <button className="primary" onClick={submitManual}>Usa codice</button>
        </div>
      </div>
    </div>
  );
}

function Operaio({ user }) {
  const [cantieri, setCantieri] = useState([]);
  const [cantiereId, setCantiereId] = useState('');
  const [msg, setMsg] = useState('');
  const [tone, setTone] = useState('info');
  const [dist, setDist] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [vehicleTrip, setVehicleTrip] = useState(null);
  const [vehicleMsg, setVehicleMsg] = useState('');
  const watchRef = useRef(null);

  const selected = cantieri.find((c) => String(c.id) === String(cantiereId));

  useEffect(() => {
    api('/operaio/cantieri')
      .then((data) => {
        setCantieri(data);
        if (data.length === 1) setCantiereId(String(data[0].id));
      })
      .catch(() => {
        setTone('danger');
        setMsg('Nessun cantiere assegnato o sessione scaduta.');
      });

    api('/operaio/active-vehicle-trip').then(setVehicleTrip).catch(() => {});
  }, []);

  async function timbra(tipo) {
    setLoading(true);
    setTone('info');
    setMsg('Sto rilevando la posizione GPS...');

    try {
      const c = await getGps();
      const data = await api('/timbrature/timbra', {
        method: 'POST',
        body: JSON.stringify({
          cantiere_id: Number(cantiereId),
          tipo,
          latitudine: c.latitude,
          longitudine: c.longitude,
          accuratezza_gps: c.accuracy,
        }),
      });

      setDist(data.distanza);
      setTone(data.valida ? 'success' : 'danger');
      setMsg(data.messaggio);
    } catch {
      setTone('danger');
      setMsg('GPS non disponibile. Attiva la posizione ad alta precisione e riprova.');
    }

    setLoading(false);
  }

  async function startVehicleTracking(tripId) {
    if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current);

    watchRef.current = navigator.geolocation.watchPosition(
      (p) => {
        api('/operaio/vehicle-point', {
          method: 'POST',
          body: JSON.stringify({
            trip_id: tripId,
            latitudine: p.coords.latitude,
            longitudine: p.coords.longitude,
            accuratezza_gps: p.coords.accuracy,
          }),
        }).catch(() => {});
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );

    localStorage.setItem('activeVehicleTripId', String(tripId));
  }

  async function doVehicleCheckin(vehicleId) {
    setScannerOpen(false);
    setVehicleMsg('Sto rilevando GPS e avvio utilizzo autovettura...');

    try {
      const c = await getGps();

      const trip = await api('/operaio/vehicle-checkin', {
        method: 'POST',
        body: JSON.stringify({
          vehicle_id: Number(vehicleId),
          cantiere_id: cantiereId ? Number(cantiereId) : null,
          latitudine: c.latitude,
          longitudine: c.longitude,
          accuratezza_gps: c.accuracy,
        }),
      });

      setVehicleTrip(trip);
      setVehicleMsg(`Check-in autovettura registrato: ${trip.targa}`);
      startVehicleTracking(trip.id);
    } catch (e) {
      setVehicleMsg(e.message || 'Errore check-in autovettura');
    }
  }

  async function doVehicleCheckout() {
    setVehicleMsg('Sto chiudendo utilizzo autovettura...');

    try {
      const c = await getGps();
      const tripId = vehicleTrip?.id || Number(localStorage.getItem('activeVehicleTripId'));

      const trip = await api('/operaio/vehicle-checkout', {
        method: 'POST',
        body: JSON.stringify({
          trip_id: tripId,
          latitudine: c.latitude,
          longitudine: c.longitude,
          accuratezza_gps: c.accuracy,
        }),
      });

      if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current);
      localStorage.removeItem('activeVehicleTripId');
      setVehicleTrip(null);
      setVehicleMsg(`Check-out autovettura registrato. Km stimati: ${trip.km_stimati}`);
    } catch (e) {
      setVehicleMsg(e.message || 'Errore check-out autovettura');
    }
  }

  async function quickFuel() {
    if (!vehicleTrip) {
      setVehicleMsg('Nessun viaggio auto attivo.');
      return;
    }

    try {
      await api('/operaio/fuel', {
        method: 'POST',
        body: JSON.stringify({
          vehicle_id: vehicleTrip.vehicle_id,
          trip_id: vehicleTrip.id,
          amount_euro: 50,
          note: 'Rifornimento rapido operaio',
        }),
      });

      setVehicleMsg('Rifornimento 50 € registrato.');
    } catch (e) {
      setVehicleMsg(e.message || 'Errore rifornimento');
    }
  }

  return (
    <main className="worker-shell">
      <section className="worker-card">
        <div className="worker-top">
          <div>
            <p className="eyebrow">App operaio</p>
            <h1>Ciao {user.nome}</h1>
            <p className="muted">
              Timbra il cantiere e, se prendi un mezzo, scansiona il QR dentro l’autovettura.
            </p>
          </div>

          <button className="ghost" onClick={() => { localStorage.clear(); location.reload(); }}>
            Esci
          </button>
        </div>

        <div className="site-selector">
          <label>Cantiere</label>
          <select value={cantiereId} onChange={(e) => setCantiereId(e.target.value)}>
            <option value="">Seleziona cantiere</option>
            {cantieri.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>

          {selected && (
            <p className="site-info">
              📍 {selected.indirizzo || 'Indirizzo non indicato'} · raggio {selected.raggio_metri} m
            </p>
          )}
        </div>

        <div className="clock-actions">
          <button className="clock-in" disabled={!cantiereId || loading} onClick={() => timbra('ingresso')}>
            ENTRA<br /><small>Timbra ingresso</small>
          </button>

          <button className="clock-out" disabled={!cantiereId || loading} onClick={() => timbra('uscita')}>
            ESCI<br /><small>Timbra uscita</small>
          </button>
        </div>

        {dist !== null && (
          <div className="distance-card">
            <span>Distanza dal cantiere</span>
            <strong>{Math.round(dist)} m</strong>
          </div>
        )}

        {msg && <div className={`alert ${tone}`}>{msg}</div>}

        <div className="vehicle-worker-box">
          <h2>Autovettura aziendale</h2>
          <p className="muted">Scansiona il QR dell’autovettura per registrare l’utilizzo del mezzo aziendale.</p>

          {vehicleTrip ? (
            <div className="active-car">
              <strong>{vehicleTrip.targa}</strong>
              <span>In uso · avvio {fmtDateTime(vehicleTrip.start_time)}</span>
            </div>
          ) : (
            <p className="muted">Nessuna autovettura attiva.</p>
          )}

          <div className="vehicle-worker-actions">
            <button className="vehicle-checkin" disabled={!!vehicleTrip} onClick={() => setScannerOpen(true)}>
              CHECK-IN AUTOVETTURA
            </button>

            <button
              className="vehicle-checkout"
              disabled={!vehicleTrip && !localStorage.getItem('activeVehicleTripId')}
              onClick={doVehicleCheckout}
            >
              CHECK-OUT AUTOVETTURA
            </button>

            <button className="fuel-quick" disabled={!vehicleTrip} onClick={quickFuel}>
              Rifornimento 50 €
            </button>
          </div>

          {vehicleMsg && <div className="alert info">{vehicleMsg}</div>}
        </div>

        <p className="privacy">
          🔒 Il GPS cantiere viene acquisito alla timbratura; il GPS auto resta attivo solo durante l’utilizzo del mezzo.
        </p>

        {scannerOpen && <QrScannerModal onClose={() => setScannerOpen(false)} onVehicle={doVehicleCheckin} />}
      </section>
    </main>
  );
}

function Sidebar({ tab, setTab, user, setSession }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-icon">TC</div>
        <div>
          <strong>Timbrature</strong>
          <span>Cantiere Pro</span>
        </div>
      </div>

      <nav className="side-menu">
        {menu.map(([key, icon, label]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            <span>{icon}</span>
            {label}
          </button>
        ))}
      </nav>

      <div className="side-user">
        <div className="avatar">{user.nome?.[0] || 'A'}</div>
        <div>
          <strong>{user.nome} {user.cognome}</strong>
          <span>Amministratore</span>
        </div>
        <button className="logout" onClick={() => { localStorage.clear(); setSession(null); }}>
          Esci
        </button>
      </div>
    </aside>
  );
}

function Topbar({ title, subtitle }) {
  return (
    <header className="topbar">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="status-pill">● Sistema attivo</div>
    </header>
  );
}

function StatCard({ icon, label, value, tone = 'blue' }) {
  return (
    <div className={`stat ${tone}`}>
      <div className="stat-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value ?? '—'}</strong>
    </div>
  );
}

function Table({ rows, cols, empty = 'Nessun dato disponibile' }) {
  if (!rows || rows.length === 0) {
    return <EmptyState title={empty} text="Appena ci saranno dati, li vedrai qui." />;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {cols.map((c) => <th key={c.key || c}>{c.label || c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || i}>
              {cols.map((c) => {
                const key = c.key || c;
                const v = c.render ? c.render(r) : r[key];

                return (
                  <td key={key}>
                    {typeof v === 'boolean'
                      ? (v ? <Badge tone="success">Sì</Badge> : <Badge tone="danger">No</Badge>)
                      : (v ?? '—')}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Dashboard() {
  const [d, setD] = useState(null);
  const [logs, setLogs] = useState([]);
  const [pres, setPres] = useState([]);
  const [fleet, setFleet] = useState(null);
  const [presentiMappa, setPresentiMappa] = useState([]);

  useEffect(() => {
    api('/admin/dashboard').then(setD).catch(() => {});
    api('/admin/log-sicurezza').then(setLogs).catch(() => {});
    api('/admin/presenze').then(setPres).catch(() => {});
    api('/admin/fleet-report').then(setFleet).catch(() => {});
    api('/admin/presenti-mappa').then(setPresentiMappa).catch(() => {});
  }, []);

  return (
    <>
      <Topbar title="Dashboard" subtitle="Situazione generale di cantieri, operai, timbrature e autovetture." />

      <section className="stats-grid">
        <StatCard icon="📍" label="Cantieri attivi" value={d?.cantieri_attivi} />
        <StatCard icon="👷" label="Operai" value={d?.operai_attivi ?? d?.operai} tone="green" />
        <StatCard icon="🚗" label="Auto" value={fleet?.vehicles} tone="purple" />
        <StatCard icon="⚠️" label="Anomalie oggi" value={d?.anomalie_oggi} tone="red" />
      </section>

      <section className="stats-grid">
        <StatCard icon="🛻" label="Utilizzi auto" value={fleet?.trips} />
        <StatCard icon="⏱️" label="Auto in uso" value={fleet?.open_trips} tone="green" />
        <StatCard icon="🧭" label="Km flotta" value={fleet?.km_total} />
        <StatCard icon="⛽" label="Anom. carburante" value={fleet?.fuel_anomalies} tone="red" />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Mappa operai presenti ora</h2>
          <p>Ultima posizione GPS registrata alla timbratura di ingresso.</p>
        </div>
      
        {presentiMappa.length > 0 ? (
          <MapContainer
            center={[
              presentiMappa[0].latitudine || 41.9028,
              presentiMappa[0].longitudine || 12.4964
            ]}
            zoom={14}
            style={{ height: 420, borderRadius: 18 }}
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
      
            {presentiMappa
              .filter((p) => p.latitudine && p.longitudine)
              .map((p) => (
                <Marker key={p.id} position={[p.latitudine, p.longitudine]}>
                  <Popup>
                    <strong>{p.operaio}</strong><br />
                    Cantiere: {p.cantiere}<br />
                    Ingresso: {fmtDateTime(p.ingresso)}<br />
                    Auto in uso: {p.auto_in_uso ? 'Sì' : 'No'}
                  </Popup>
                </Marker>
              ))}
          </MapContainer>
        ) : (
          <EmptyState
            icon="🗺️"
            title="Nessun operaio presente"
            text="Quando un operaio timbra ingresso, comparirà qui sulla mappa."
          />
        )}
      </section>
      <section className="split">
        <div className="panel">
          <div className="panel-head">
            <h2>Ultime presenze</h2>
            <p>Controllo rapido della giornata.</p>
          </div>

          <Table
            rows={pres.slice(0, 8)}
            cols={[
              { key: 'data', label: 'Data' },
              { key: 'operaio', label: 'Operaio' },
              { key: 'cantiere', label: 'Cantiere' },
              { key: 'ore_lavorate', label: 'Ore' },
              { key: 'note', label: 'Note' },
            ]}
          />
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Anomalie GPS</h2>
            <p>Tentativi fuori area o GPS impreciso.</p>
          </div>

          <Table
            rows={logs.slice(0, 8)}
            cols={[
              { key: 'data_ora', label: 'Ora', render: (r) => fmtDateTime(r.data_ora) },
              { key: 'evento', label: 'Evento' },
              { key: 'distanza', label: 'Distanza' },
              { key: 'accuratezza_gps', label: 'Precisione' },
            ]}
          />
        </div>
      </section>
    </>
  );
}

function MapClick({ setForm }) {
  useMapEvents({
    click(e) {
      setForm((f) => ({ ...f, latitudine: e.latlng.lat, longitudine: e.latlng.lng }));
    },
  });

  return null;
}

function AdminCantieri() {
  const [cantieri, setCantieri] = useState([]);
  const [saved, setSaved] = useState('');
  const [form, setForm] = useState({
    nome: '',
    indirizzo: '',
    latitudine: 41.9028,
    longitudine: 12.4964,
    raggio_metri: 200,
    attivo: true,
    ora_inizio_attivita: "07:00",
    ora_fine_attivita: "18:00",
  });

  const load = () => api('/admin/cantieri').then(setCantieri);

  useEffect(() => {
    load();
  }, []);

  async function save(e) {
    e.preventDefault();

    await api('/admin/cantieri', {
      method: 'POST',
      body: JSON.stringify(form),
    });

    setSaved('Cantiere salvato correttamente.');
    setForm((f) => ({ ...f, nome: '', indirizzo: '' }));
    load();
  }

  return (
    <>
      <Topbar title="Cantieri" subtitle="Crea l’area GPS autorizzata per ogni cantiere." />

      <section className="split wide-right">
        <form onSubmit={save} className="panel form-panel">
          <h2>Nuovo cantiere</h2>
          <p className="muted">Clicca sulla mappa oppure inserisci le coordinate manualmente.</p>

          <label>Nome cantiere</label>
          <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />

          <label>Indirizzo</label>
          <input value={form.indirizzo} onChange={(e) => setForm({ ...form, indirizzo: e.target.value })} />

          <div className="two">
            <div>
              <label>Latitudine</label>
              <input
                type="number"
                step="0.000001"
                value={form.latitudine}
                onChange={(e) => setForm({ ...form, latitudine: parseFloat(e.target.value) })}
              />
            </div>

            <div>
              <label>Longitudine</label>
              <input
                type="number"
                step="0.000001"
                value={form.longitudine}
                onChange={(e) => setForm({ ...form, longitudine: parseFloat(e.target.value) })}
              />
            </div>
          </div>

          <label>Raggio autorizzato</label>
          <input
            type="number"
            value={form.raggio_metri}
            onChange={(e) => setForm({ ...form, raggio_metri: parseInt(e.target.value) })}
          />

          <div className="two">
            <div>
              <label>Ora inizio attività</label>
              <input
                type="time"
                value={form.ora_inizio_attivita || "07:00"}
                onChange={(e) => setForm({ ...form, ora_inizio_attivita: e.target.value })}
              />
            </div>
          
            <div>
              <label>Ora fine attività</label>
              <input
                type="time"
                value={form.ora_fine_attivita || "18:00"}
                onChange={(e) => setForm({ ...form, ora_fine_attivita: e.target.value })}
              />
            </div>
          </div>
          
          <button className="primary">Salva cantiere</button>

          {saved && <div className="alert success">{saved}</div>}
        </form>

        <div className="panel map-panel">
          <MapContainer
            center={[form.latitudine, form.longitudine]}
            zoom={14}
            style={{ height: 470, borderRadius: 18 }}
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <MapClick setForm={setForm} />

            {cantieri.map((c) => (
              <React.Fragment key={c.id}>
                <Marker position={[c.latitudine, c.longitudine]}>
                  <Popup>{c.nome}</Popup>
                </Marker>
                <Circle center={[c.latitudine, c.longitudine]} radius={c.raggio_metri} />
              </React.Fragment>
            ))}

            <Marker position={[form.latitudine, form.longitudine]} />
            <Circle center={[form.latitudine, form.longitudine]} radius={form.raggio_metri} />
          </MapContainer>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Cantieri registrati</h2>
          <p>Elenco aree abilitate alla timbratura.</p>
        </div>

        <Table
          rows={cantieri}
          cols={[
            { key: 'nome', label: 'Cantiere' },
            { key: 'indirizzo', label: 'Indirizzo' },
            { key: 'raggio_metri', label: 'Raggio m' },
            { key: 'attivo', label: 'Attivo' },
            { key: 'ora_inizio_attivita', label: 'Inizio' },
            { key: 'ora_fine_attivita', label: 'Fine' },
            {
              key: 'azioni',
              label: 'Azioni',
              render: (r) => (
                <button
                  className="secondary"
                  onClick={() => {
                    const nuovoInizio = prompt("Nuova ora inizio (HH:MM)", r.ora_inizio_attivita || "07:00");
                    const nuovaFine = prompt("Nuova ora fine (HH:MM)", r.ora_fine_attivita || "18:00");
        
                    if (!nuovoInizio || !nuovaFine) return;
        
                    api(`/admin/cantieri/${r.id}`, {
                      method: 'PUT',
                      body: JSON.stringify({
                        nome: r.nome,
                        indirizzo: r.indirizzo,
                        latitudine: r.latitudine,
                        longitudine: r.longitudine,
                        raggio_metri: r.raggio_metri,
                        attivo: r.attivo,
                        ora_inizio_attivita: nuovoInizio,
                        ora_fine_attivita: nuovaFine,
                      })
                    }).then(() => {
                      alert("Orari aggiornati");
                      load();
                    });
                  }}
                >
                  ✏️ Modifica
                </button>
              )
            }
          ]}
        />
      </section>
    </>
  );
}
        
function AdminOperai() {
  const [assegnazioni, setAssegnazioni] = useState([]);
  const [operai, setOperai] = useState([]);
  const [cantieri, setCantieri] = useState([]);
  const [toast, setToast] = useState('');

  const [form, setForm] = useState({
    nome: '',
    cognome: '',
    email: '',
    password: '123456',
    codice_fiscale: '',
    ruolo: 'operaio',
  });

  const [ass, setAss] = useState({
    operaio_id: '',
    cantiere_id: '',
    data_inizio: new Date().toISOString().slice(0, 10),
    data_fine: null,
  });

  const load = () => {
    api('/admin/operai').then(setOperai);
    api('/admin/cantieri').then(setCantieri);
    api('/admin/assegnazioni').then(setAssegnazioni);
  };

  useEffect(() => {
    load();
  }, []);

  async function crea(e) {
    e.preventDefault();

    await api('/admin/operai', {
      method: 'POST',
      body: JSON.stringify(form),
    });

    setToast('Operaio creato.');
    setForm((f) => ({
      ...f,
      nome: '',
      cognome: '',
      email: '',
      codice_fiscale: '',
    }));
    load();
  }

  async function assegna() {
    try {
      await api('/admin/assegnazioni', {
        method: 'POST',
        body: JSON.stringify({
          ...ass,
          operaio_id: Number(ass.operaio_id),
          cantiere_id: Number(ass.cantiere_id),
          data_fine: ass.data_fine || null,
        }),
      });

      setToast('Assegnazione completata.');
      load();
    } catch (e) {
      setToast(e.message || 'Errore assegnazione');
    }
  }

  async function eliminaAssegnazione(id) {
    if (!confirm("Rimuovere questa assegnazione?")) return;

    await api(`/admin/assegnazioni/${id}`, {
      method: 'DELETE',
    });

    setToast("Assegnazione rimossa");
    load();
  }

  return (
    <>
      <Topbar title="Operai" subtitle="Crea utenti e collega ogni operaio ai cantieri autorizzati." />

      <section className="split">
        <form onSubmit={crea} className="panel form-panel">
          <h2>Nuovo operaio</h2>

          <div className="two">
            <div>
              <label>Nome</label>
              <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>

            <div>
              <label>Cognome</label>
              <input value={form.cognome} onChange={(e) => setForm({ ...form, cognome: e.target.value })} />
            </div>
          </div>

          <label>Email</label>
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />

          <label>Codice fiscale</label>
          <input value={form.codice_fiscale} onChange={(e) => setForm({ ...form, codice_fiscale: e.target.value })} />

          <label>Password iniziale</label>
          <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />

          <button className="primary">Crea operaio</button>
        </form>

        <div className="panel form-panel">
          <h2>Assegna cantiere</h2>

          <label>Operaio</label>
          <select value={ass.operaio_id} onChange={(e) => setAss({ ...ass, operaio_id: e.target.value })}>
            <option value="">Seleziona operaio</option>
            <option value="tutti">Tutti gli operai</option>
            {operai.filter((o) => o.ruolo === 'operaio').map((o) => (
              <option key={o.id} value={o.id}>{o.cognome} {o.nome}</option>
            ))}
          </select>

          <label>Cantiere</label>
          <select value={ass.cantiere_id} onChange={(e) => setAss({ ...ass, cantiere_id: e.target.value })}>
            <option value="">Seleziona cantiere</option>
            {cantieri.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>

          <label>Data inizio</label>
          <input
            type="date"
            value={ass.data_inizio}
            onChange={(e) => setAss({ ...ass, data_inizio: e.target.value })}
          />

          <button className="primary" onClick={assegna}>Assegna</button>

          {toast && <div className="alert success">{toast}</div>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Utenti registrati</h2>
          <p>Amministratori e operai abilitati.</p>
        </div>

       
        <Table
          rows={operai}
          cols={[
            { key: 'nome', label: 'Nome' },
            { key: 'cognome', label: 'Cognome' },
            { key: 'email', label: 'Email' },
            { key: 'ruolo', label: 'Ruolo' },
            { key: 'attivo', label: 'Attivo' },
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Assegnazioni cantieri</h2>
          <p>Elenco dei cantieri assegnati agli operai.</p>
        </div>

        <Table
          rows={assegnazioni}
          cols={[
            { key: 'operaio', label: 'Operaio' },
            { key: 'cantiere', label: 'Cantiere' },
            { key: 'data_inizio', label: 'Inizio' },
            { key: 'data_fine', label: 'Fine' },
            { key: 'attiva', label: 'Attiva' },
            {
              key: 'azioni',
              label: 'Azioni',
              render: (r) => (
                <button
                  className="secondary"
                  onClick={() => eliminaAssegnazione(r.id)}
                >
                  Rimuovi
                </button>
              )
            }
          ]}
        />
      </section>
    </>
  );
}

function AdminFlotta() {
  const [vehicles, setVehicles] = useState([]);
  const [trips, setTrips] = useState([]);
  const [fuel, setFuel] = useState([]);
  const [settings, setSettings] = useState(null);
  const [report, setReport] = useState(null);
  const [reportTrip, setReportTrip] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ targa: '', modello: '', descrizione: '' });
  const [autoSelezionata, setAutoSelezionata] = useState(null);
  const [filtroAuto, setFiltroAuto] = useState('');
  const [filtroCantiere, setFiltroCantiere] = useState('');
  const [filtroOperaio, setFiltroOperaio] = useState('');
  const [filtroData, setFiltroData] = useState('');
  const [tripSelezionato, setTripSelezionato] = useState(null);
  const load = () => {
    api('/admin/vehicles').then(setVehicles).catch((e) => setErr(e.message));
    api('/admin/vehicle-trips').then(setTrips).catch(() => {});
    api('/admin/fuel').then(setFuel).catch(() => {});
    api('/admin/fleet-settings').then(setSettings).catch(() => {});
    api('/admin/fleet-report').then(setReport).catch(() => {});
  };

  useEffect(() => {
    load();
  }, []);

  async function add(e) {
    e.preventDefault();
    setErr('');
    setMsg('');

    try {
      await api('/admin/vehicles', {
        method: 'POST',
        body: JSON.stringify(form),
      });

      setForm({ targa: '', modello: '', descrizione: '' });
      setMsg('Autovettura creata con QR code.');
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function saveSettings() {
    try {
      await api('/admin/fleet-settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      });

      setMsg('Parametri salvati.');
      load();
    } catch (e) {
      setErr(e.message);
    }
  }
  const tripsFiltrati = trips.filter((t) => {
    const matchAuto = !filtroAuto || (t.targa || '').toLowerCase().includes(filtroAuto.toLowerCase());
    const matchCantiere = !filtroCantiere || (t.cantiere || '').toLowerCase().includes(filtroCantiere.toLowerCase());
    const matchOperaio = !filtroOperaio || (t.operaio || '').toLowerCase().includes(filtroOperaio.toLowerCase());
    const matchData = !filtroData || (t.start_time || '').slice(0, 10) === filtroData;
  
    return matchAuto && matchCantiere && matchOperaio && matchData;
  });
  const tripsAuto = trips.filter(t => t.targa === autoSelezionata);
  const pointsAuto = tripsAuto.flatMap(t => t.points || []);
  return (
    <>
      <Topbar
        title="Autovetture"
        subtitle="Cruscotto amministratore: QR, utilizzi, GPS, km, rifornimenti e anomalie."
      />

      {report && (
        <section className="stats-grid">
          <StatCard icon="🚗" label="Autovetture" value={report.vehicles} />
          <StatCard icon="🛻" label="Utilizzi" value={report.trips} />
          <StatCard icon="🧭" label="Km totali" value={report.km_total} />
          <StatCard icon="⚠️" label="Anomalie carburante" value={report.fuel_anomalies} tone="red" />
        </section>
      )}

      {msg && <div className="alert success">{msg}</div>}
      {err && <div className="alert danger">{err}</div>}

      <section className="panel">
        <h2>Nuova autovettura</h2>

        <form className="fleet-form" onSubmit={add}>
          <input
            placeholder="Targa"
            value={form.targa}
            onChange={(e) => setForm({ ...form, targa: e.target.value })}
          />
          <input
            placeholder="Modello"
            value={form.modello}
            onChange={(e) => setForm({ ...form, modello: e.target.value })}
          />
          <input
            placeholder="Descrizione"
            value={form.descrizione}
            onChange={(e) => setForm({ ...form, descrizione: e.target.value })}
          />
          <button className="primary">Genera QR</button>
        </form>
      </section>

      <section className="vehicle-grid-admin">
        {vehicles.map((v) => (
          <article className="vehicle-card-admin" key={v.id}>
            <div className="panel-head">
              <div>
                <h3>{v.targa}</h3>
                <p>{v.modello || '—'} · {v.descrizione || ''}</p>
              </div>

              <Badge tone={v.status === 'in_uso' ? 'danger' : 'success'}>
                {v.status}
              </Badge>
            </div>

            {v.qr_code && <img src={v.qr_code} className="qr-img" />}
            <div className="qr-url">{v.qr_url}</div>
          </article>
        ))}
      </section>

      {settings && (
        <section className="panel">
          <h2>Parametri controllo consumi</h2>

          <div className="settings-grid">
            <label>
              Importo fisso €
              <input
                type="number"
                value={settings.default_fuel_amount_euro}
                onChange={(e) => setSettings({ ...settings, default_fuel_amount_euro: Number(e.target.value) })}
              />
            </label>

            <label>
              Prezzo €/L
              <input
                type="number"
                step="0.01"
                value={settings.fuel_price_euro_per_liter}
                onChange={(e) => setSettings({ ...settings, fuel_price_euro_per_liter: Number(e.target.value) })}
              />
            </label>

            <label>
              Km/L attesi
              <input
                type="number"
                value={settings.expected_km_per_liter}
                onChange={(e) => setSettings({ ...settings, expected_km_per_liter: Number(e.target.value) })}
              />
            </label>

            <label>
              Tolleranza %
              <input
                type="number"
                value={settings.anomaly_tolerance_percent}
                onChange={(e) => setSettings({ ...settings, anomaly_tolerance_percent: Number(e.target.value) })}
              />
            </label>

            <label>
              Ora inizio
              <input
                type="number"
                value={settings.working_start_hour}
                onChange={(e) => setSettings({ ...settings, working_start_hour: Number(e.target.value) })}
              />
            </label>

            <label>
              Ora fine
              <input
                type="number"
                value={settings.working_end_hour}
                onChange={(e) => setSettings({ ...settings, working_end_hour: Number(e.target.value) })}
              />
            </label>
          </div>

          <button className="primary" onClick={saveSettings}>Salva parametri</button>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Storico utilizzi autovetture</h2>
          <p>Visibile solo all’amministratore.</p>
        </div>
         {/* 👇 QUI INCOLLA */}
        <div className="fleet-form" style={{ marginBottom: 14 }}>
          <input
            placeholder="Cerca targa auto"
            value={filtroAuto}
            onChange={(e) => setFiltroAuto(e.target.value)}
          />
      
          <input
            placeholder="Cerca cantiere"
            value={filtroCantiere}
            onChange={(e) => setFiltroCantiere(e.target.value)}
          />
      
          <input
            placeholder="Cerca operaio"
            value={filtroOperaio}
            onChange={(e) => setFiltroOperaio(e.target.value)}
          />
      
          <input
            type="date"
            value={filtroData}
            onChange={(e) => setFiltroData(e.target.value)}
          />
        </div>
      
               
        <Table
          rows={tripsFiltrati}
          cols={[
            { key: 'targa', label: 'Auto' },
            {
              key: 'auto_view',
              label: 'Storico auto',
              render: (r) => (
                <button
                  className="secondary"
                  onClick={() => {
                    setAutoSelezionata(r.targa);
                    setTripSelezionato(null);
                  }}
                >
                  🚗 Storico
                </button>
              )
            },
            { key: 'operaio', label: 'Operaio' },
            { key: 'cantiere', label: 'Cantiere' },
            { key: 'start_time', label: 'Check-in', render: (r) => fmtDateTime(r.start_time) },
            { key: 'end_time', label: 'Check-out', render: (r) => fmtDateTime(r.end_time) },
            { key: 'km_stimati', label: 'Km' },
            { key: 'points_count', label: 'Punti GPS' },
            { key: 'fuori_orario', label: 'Fuori orario' },
            { key: 'anomalia_carburante', label: 'Anom. carburante' },
            {
              key: 'anomalie',
              label: 'Anomalie',
              render: (r) => {
                if (!r.anomalie) return "—";
            
                return (
                  <button
                    className="secondary"
                    onClick={() => alert(r.anomalie)}
                  >
                    ⚠️ Vedi
                  </button>
                );
              }
            },
            {
              key: 'mappa',
              label: 'Mappa',
              render: (r) => (
                <button
                  className="secondary"
                  onClick={() => {
                    setTripSelezionato(r);
                    setAutoSelezionata(null);
                  }}
                >
                  🗺️ Vedi
                </button>
              )
            },
            { key: 'status', label: 'Stato' },
            {
              key: 'report',
              label: 'Report',
              render: (r) => (
                <button
                  className="primary"
                  onClick={() => setReportTrip(r)}
                >
                  📄 Vedi
                </button>
              )
            },
          ]}
        />

        {tripSelezionato && (
          <div className="trip-map-card">
            <div className="trip-map-head">
              <strong>{tripSelezionato.targa}</strong>
              <span>{tripSelezionato.operaio} · {fmtDateTime(tripSelezionato.start_time)}</span>
            </div>
        
            <MappaTragitto points={tripSelezionato.points} />
          </div>
        )}
        {autoSelezionata && (
          <div className="trip-map-card">
            <div className="trip-map-head">
              <strong>{autoSelezionata}</strong>
              <span>Storico completo tragitti auto</span>
            </div>
        
            <MappaTragitto points={pointsAuto} />
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Rifornimenti</h2>

        <Table
          rows={fuel}
          cols={[
            { key: 'targa', label: 'Auto' },
            { key: 'operaio', label: 'Operaio rifornimento' },
            { key: 'amount_euro', label: 'Importo €' },
            { key: 'expected_km', label: 'Km attesi rifornimento' },
            { key: 'km_attesi_auto', label: 'Km attesi auto' },
            { key: 'km_realizzati_auto', label: 'Km realizzati auto' },
            { key: 'differenza_km', label: 'Differenza km' },
            {
              key: 'anomalia',
              label: 'Anomalia',
              render: (r) => {
                if (!r.anomalia) return "—";
            
                return (
                  <span style={{
                    color: '#b42318',
                    fontWeight: 'bold'
                  }}>
                    ⚠️ ANOMALIA
                  </span>
                );
              }
            },
            { key: 'created_at', label: 'Data', render: (r) => fmtDateTime(r.created_at) },
            { key: 'note', label: 'Nota' },
          ]}
        />
      </section>
      {/* 🔥 INCOLLA QUI */}
      {reportTrip && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-head">
              <h2>Report utilizzo autovettura</h2>
              <button className="ghost" onClick={() => setReportTrip(null)}>
                Chiudi
              </button>
            </div>
      
            <p><strong>Auto:</strong> {reportTrip.targa}</p>
            <p><strong>Operaio:</strong> {reportTrip.operaio}</p>
            <p><strong>Cantiere:</strong> {reportTrip.cantiere || '—'}</p>
      
            <p><strong>Check-in:</strong> {fmtDateTime(reportTrip.start_time)}</p>
            <p><strong>Check-out:</strong> {fmtDateTime(reportTrip.end_time)}</p>
      
            <p><strong>Km stimati:</strong> {reportTrip.km_stimati}</p>
            <p><strong>Punti GPS:</strong> {reportTrip.points_count}</p>
      
            <p><strong>Fuori orario:</strong> {reportTrip.fuori_orario ? 'Sì' : 'No'}</p>
            <p><strong>Anomalia carburante:</strong> {reportTrip.anomalia_carburante ? 'Sì' : 'No'}</p>
      
            <p><strong>Altre anomalie:</strong> {reportTrip.anomalie || 'Nessuna'}</p>
          </div>
        </div>
      )}
    </>
  );
}

function AdminReport() {
  const [operai, setOperai] = useState([]);
  const [report, setReport] = useState(null);
  const [operaio, setOperaio] = useState('');
  const [mese, setMese] = useState(new Date().getMonth() + 1);
  const [anno, setAnno] = useState(new Date().getFullYear());

  useEffect(() => {
    api('/admin/operai').then(setOperai);
  }, []);

  async function gen() {
    setReport(await api(`/admin/report-mensile?operaio_id=${operaio}&mese=${mese}&anno=${anno}`));
  }

  function exp() {
    window.open(`${API}/admin/export-presenze?operaio_id=${operaio}&mese=${mese}&anno=${anno}`);
  }

  return (
    <>
      <Topbar title="Report paghe" subtitle="Genera il riepilogo mensile delle ore lavorate ed esporta in Excel." />

      <section className="panel report-filter">
        <select value={operaio} onChange={(e) => setOperaio(e.target.value)}>
          <option value="">Seleziona operaio</option>
          {operai.filter((o) => o.ruolo === 'operaio').map((o) => (
            <option key={o.id} value={o.id}>{o.cognome} {o.nome}</option>
          ))}
        </select>

        <input type="number" min="1" max="12" value={mese} onChange={(e) => setMese(e.target.value)} />
        <input type="number" value={anno} onChange={(e) => setAnno(e.target.value)} />

        <button className="primary" onClick={gen} disabled={!operaio}>Genera</button>
        <button className="secondary" onClick={exp} disabled={!operaio}>Esporta Excel</button>
      </section>

      {report ? (
        <section className="panel">
          <div className="report-total">
            <span>Totale ore mese</span>
            <strong>{report.totale_ore}</strong>
          </div>

          <Table
            rows={report.giorni}
            cols={[
              { key: 'data', label: 'Data', render: (r) => fmtDate(r.data) },
              { key: 'ingresso', label: 'Ingresso', render: (r) => fmtDateTime(r.ingresso) },
              { key: 'uscita', label: 'Uscita', render: (r) => fmtDateTime(r.uscita) },
              { key: 'ore_lavorate', label: 'Ore' },
              { key: 'note', label: 'Note' },
            ]}
            empty="Nessuna presenza nel mese"
          />
        </section>
      ) : (
        <EmptyState
          icon="📊"
          title="Genera un report"
          text="Scegli operaio, mese e anno per vedere le ore utili alla busta paga."
        />
      )}
    </>
  );
}

function Admin({ user, setSession }) {
  const [tab, setTab] = useState('dash');

  return (
    <div className="app-shell">
      <Sidebar tab={tab} setTab={setTab} user={user} setSession={setSession} />
      <main className="content">
        {tab === 'dash' && <Dashboard />}
        {tab === 'cantieri' && <AdminCantieri />}
        {tab === 'operai' && <AdminOperai />}
        {tab === 'flotta' && <AdminFlotta />}
        {tab === 'report' && <AdminReport />}
      </main>
    </div>
  );
}

function App() {
  const [session, setSession] = useState(null);

  useEffect(() => {
    api('/me').then(setSession).catch(() => {});
  }, []);

  if (!session) return <Login setSession={setSession} />;

  return session.ruolo === 'admin'
    ? <Admin user={session} setSession={setSession} />
    : <Operaio user={session} />;
}

createRoot(document.getElementById('root')).render(<App />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
