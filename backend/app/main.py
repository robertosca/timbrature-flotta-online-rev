from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from datetime import datetime, date
from calendar import monthrange
from io import BytesIO
from openpyxl import Workbook
from .database import Base, engine, get_db
from .models import User, Cantiere, Assegnazione, Timbratura, PresenzaGiornaliera, LogSicurezza
from .schemas import LoginInput, UserCreate, CantiereCreate, AssegnazioneCreate, TimbraturaInput
from .security import hash_password, verify_password, create_access_token, get_current_user, require_admin
from .utils import distanza_metri, verifica_assegnazione, ha_ingresso_aperto, giornata_chiusa, calcola_ore, registra_log_sicurezza, SOGLIA_ACCURATEZZA_GPS

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Timbrature Cantiere Pro", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://timbrature-flotta-frontend-rev.onrender.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def seed_admin():
    db = next(get_db())
    if not db.query(User).filter(User.email == "admin@cantiere.local").first():
        db.add(User(nome="Admin", cognome="Cantiere", email="admin@cantiere.local", password_hash=hash_password("admin123"), ruolo="admin", attivo=True))
        db.commit()

@app.get("/")
def home():
    return {"status": "Sistema Timbrature Cantiere Pro attivo"}

@app.post("/auth/login")
def login(data: LoginInput, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email, User.attivo == True).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Credenziali non valide")
    token = create_access_token({"sub": str(user.id), "role": user.ruolo})
    return {"access_token": token, "token_type": "bearer", "user": {"id": user.id, "nome": user.nome, "cognome": user.cognome, "ruolo": user.ruolo, "email": user.email}}

@app.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "nome": user.nome, "cognome": user.cognome, "ruolo": user.ruolo, "email": user.email}

@app.post("/admin/operai")
def crea_operaio(data: UserCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email già registrata")
    user = User(nome=data.nome, cognome=data.cognome, email=data.email, codice_fiscale=data.codice_fiscale, password_hash=hash_password(data.password), ruolo=data.ruolo, attivo=True)
    db.add(user); db.commit(); db.refresh(user)
    return user

@app.get("/admin/operai")
def lista_operai(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    return db.query(User).filter(User.attivo == True).order_by(User.cognome).all()

@app.post("/admin/cantieri")
def crea_cantiere(data: CantiereCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    c = Cantiere(**data.model_dump())
    db.add(c); db.commit(); db.refresh(c)
    return c

@app.get("/admin/cantieri")
def lista_cantieri(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    return db.query(Cantiere).order_by(Cantiere.nome).all()

@app.put("/admin/cantieri/{cantiere_id}")
def modifica_cantiere(cantiere_id: int, data: CantiereCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    c = db.query(Cantiere).filter(Cantiere.id == cantiere_id).first()
    if not c: raise HTTPException(status_code=404, detail="Cantiere non trovato")
    for k, v in data.model_dump().items(): setattr(c, k, v)
    db.commit(); db.refresh(c)
    return c

@app.post("/admin/assegnazioni")
def assegna(data: AssegnazioneCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):

    # 🔴 controllo duplicato (stesso operaio + stesso cantiere attivo)
    esiste = db.query(Assegnazione).filter(
        Assegnazione.operaio_id == data.operaio_id,
        Assegnazione.cantiere_id == data.cantiere_id,
        Assegnazione.data_fine == None
    ).first()

    if esiste:
        raise HTTPException(
            status_code=400,
            detail="Operaio già assegnato a questo cantiere"
        )

    # ✅ crea assegnazione
    a = Assegnazione(**data.model_dump())
    db.add(a)
    db.commit()
    db.refresh(a)

    return a

@app.get("/operaio/cantieri")
def cantieri_assegnati(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    oggi = date.today()
    rows = db.query(Cantiere).join(Assegnazione, Assegnazione.cantiere_id == Cantiere.id).filter(
        Assegnazione.operaio_id == user.id,
        Cantiere.attivo == True,
        Assegnazione.data_inizio <= oggi,
        ((Assegnazione.data_fine == None) | (Assegnazione.data_fine >= oggi))
    ).all()
    return rows

@app.post("/timbrature/timbra")
def timbra(data: TimbraturaInput, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if data.tipo not in ["ingresso", "uscita"]:
        raise HTTPException(status_code=400, detail="Tipo timbratura non valido")
    now = datetime.now()
    cantiere = db.query(Cantiere).filter(Cantiere.id == data.cantiere_id, Cantiere.attivo == True).first()
    if not cantiere:
        registra_log_sicurezza(db, user.id, data.cantiere_id, "CANTIERE_NON_VALIDO", data.latitudine, data.longitudine, accuratezza_gps=data.accuratezza_gps)
        return {"valida": False, "messaggio": "Cantiere non valido o non attivo."}
    if not verifica_assegnazione(db, user.id, data.cantiere_id):
        registra_log_sicurezza(db, user.id, data.cantiere_id, "OPERAIO_NON_ASSEGNATO", data.latitudine, data.longitudine, accuratezza_gps=data.accuratezza_gps)
        return {"valida": False, "messaggio": "Non sei assegnato a questo cantiere."}
    if data.accuratezza_gps is None or data.accuratezza_gps > SOGLIA_ACCURATEZZA_GPS:
        registra_log_sicurezza(db, user.id, data.cantiere_id, "GPS_IMPRECISO", data.latitudine, data.longitudine, accuratezza_gps=data.accuratezza_gps)
        return {"valida": False, "messaggio": "GPS troppo impreciso. Spostati all’aperto e riprova."}
    if data.tipo == "ingresso" and ha_ingresso_aperto(db, user.id):
        registra_log_sicurezza(db, user.id, data.cantiere_id, "DOPPIO_INGRESSO", data.latitudine, data.longitudine, accuratezza_gps=data.accuratezza_gps)
        return {"valida": False, "messaggio": "Ingresso già registrato. Devi prima timbrare uscita."}
    if data.tipo == "uscita" and giornata_chiusa(db, user.id):
        registra_log_sicurezza(db, user.id, data.cantiere_id, "DOPPIA_USCITA", data.latitudine, data.longitudine, accuratezza_gps=data.accuratezza_gps)
        return {"valida": False, "messaggio": "Uscita già registrata per oggi."}
    distanza = distanza_metri(data.latitudine, data.longitudine, cantiere.latitudine, cantiere.longitudine)
    valida = distanza <= cantiere.raggio_metri
    if not valida:
        registra_log_sicurezza(db, user.id, data.cantiere_id, "FUORI_AREA", data.latitudine, data.longitudine, distanza, data.accuratezza_gps)
    t = Timbratura(operaio_id=user.id, cantiere_id=data.cantiere_id, tipo=data.tipo, data_ora=now, latitudine=data.latitudine, longitudine=data.longitudine, distanza=distanza, accuratezza_gps=data.accuratezza_gps, valida=valida, sospetta=not valida, motivo="OK" if valida else "Fuori area GPS", motivo_sospetto=None if valida else "Distanza superiore al raggio autorizzato")
    db.add(t); db.commit(); db.refresh(t)
    if not valida:
        return {"valida": False, "distanza": round(distanza, 2), "messaggio": "Timbratura rifiutata: sei fuori dall’area autorizzata."}
    oggi = date.today()
    p = db.query(PresenzaGiornaliera).filter(PresenzaGiornaliera.operaio_id == user.id, PresenzaGiornaliera.data == oggi).first()
    if data.tipo == "ingresso":
        p = PresenzaGiornaliera(operaio_id=user.id, cantiere_id=data.cantiere_id, data=oggi, ingresso=now, valida=True, note="Ingresso registrato")
        db.add(p)
    else:
        if p and p.ingresso:
            p.uscita = now; p.ore_lavorate = calcola_ore(p.ingresso, now); p.note = "Giornata completa"
        else:
            db.add(PresenzaGiornaliera(operaio_id=user.id, cantiere_id=data.cantiere_id, data=oggi, uscita=now, valida=False, note="Uscita senza ingresso"))
    db.commit()
    return {"valida": True, "distanza": round(distanza, 2), "messaggio": "Timbratura registrata correttamente."}

@app.get("/admin/dashboard")
def dashboard(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    oggi = date.today()
    return {
        "cantieri_attivi": db.query(Cantiere).filter(Cantiere.attivo == True).count(),
        "operai_attivi": db.query(User).filter(User.ruolo == "operaio", User.attivo == True).count(),
        "presenti_oggi": db.query(PresenzaGiornaliera).filter(PresenzaGiornaliera.data == oggi, PresenzaGiornaliera.ingresso != None, PresenzaGiornaliera.uscita == None).count(),
        "anomalie_oggi": db.query(LogSicurezza).filter(LogSicurezza.data_ora >= datetime.combine(oggi, datetime.min.time())).count()
    }

@app.get("/admin/presenze")
def presenze(data: str | None = None, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    q = db.query(PresenzaGiornaliera).order_by(PresenzaGiornaliera.data.desc())
    if data: q = q.filter(PresenzaGiornaliera.data == date.fromisoformat(data))
    return q.limit(300).all()

@app.get("/admin/log-sicurezza")
def log_sicurezza(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    return db.query(LogSicurezza).order_by(LogSicurezza.data_ora.desc()).limit(300).all()

@app.get("/admin/report-mensile")
def report_mensile(operaio_id: int, mese: int, anno: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    start = date(anno, mese, 1); end = date(anno, mese, monthrange(anno, mese)[1])
    presenze = db.query(PresenzaGiornaliera).filter(PresenzaGiornaliera.operaio_id == operaio_id, PresenzaGiornaliera.data >= start, PresenzaGiornaliera.data <= end).order_by(PresenzaGiornaliera.data).all()
    return {"totale_ore": round(sum(p.ore_lavorate or 0 for p in presenze), 2), "giorni": presenze}

@app.get("/admin/export-presenze")
def export_presenze(operaio_id: int, mese: int, anno: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    start = date(anno, mese, 1); end = date(anno, mese, monthrange(anno, mese)[1])
    operaio = db.query(User).filter(User.id == operaio_id).first()
    presenze = db.query(PresenzaGiornaliera).filter(PresenzaGiornaliera.operaio_id == operaio_id, PresenzaGiornaliera.data >= start, PresenzaGiornaliera.data <= end).order_by(PresenzaGiornaliera.data).all()
    wb = Workbook(); ws = wb.active; ws.title = "Presenze"
    ws.append(["Report presenze mensile"]); ws.append([f"Operaio: {operaio.nome} {operaio.cognome}" if operaio else ""]); ws.append([f"Mese: {mese}/{anno}"]); ws.append([])
    ws.append(["Data", "Cantiere ID", "Ingresso", "Uscita", "Ore", "Validità", "Note"])
    totale = 0
    for p in presenze:
        ore = p.ore_lavorate or 0; totale += ore
        ws.append([p.data.strftime("%d/%m/%Y"), p.cantiere_id, p.ingresso.strftime("%H:%M") if p.ingresso else "", p.uscita.strftime("%H:%M") if p.uscita else "", ore, "OK" if p.valida else "ANOMALIA", p.note or ""])
    ws.append([]); ws.append(["Totale ore", round(totale, 2)])
    stream = BytesIO(); wb.save(stream); stream.seek(0)
    filename = f"presenze_{operaio.cognome if operaio else operaio_id}_{mese}_{anno}.xlsx"
    return StreamingResponse(stream, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f"attachment; filename={filename}"})

# =========================
# MODULO FLOTTA AZIENDALE
# =========================
import os, base64, uuid
import qrcode
from io import BytesIO as _BytesIO
from .models import Vehicle, VehicleTrip, VehicleTripPoint, FuelRecord, FleetSettings
from .schemas import VehicleCreate, VehicleCheckInput, VehiclePointInput, VehicleCheckoutInput, FuelInput, FleetSettingsInput

Base.metadata.create_all(bind=engine)

FRONTEND_URL = os.getenv("FRONTEND_URL", "https://flotta-frontend.onrender.com")

def _settings(db: Session) -> FleetSettings:
    s = db.query(FleetSettings).first()
    if not s:
        s = FleetSettings()
        db.add(s); db.commit(); db.refresh(s)
    return s

def _qr_data_url(text: str) -> str:
    img = qrcode.make(text)
    buf = _BytesIO(); img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")

def _vehicle_out(v: Vehicle):
    return {
        "id": v.id,
        "targa": v.targa,
        "modello": v.modello,
        "descrizione": v.descrizione,
        "status": v.status,
        "attivo": v.attivo,
        "qr_url": f"{FRONTEND_URL}/vehicle/{v.id}",
        "qr_code": v.qr_code,
        "created_at": v.created_at,
    }

def _trip_km(db: Session, trip_id: int) -> float:
    pts = db.query(VehicleTripPoint).filter(VehicleTripPoint.trip_id == trip_id).order_by(VehicleTripPoint.data_ora).all()
    coords = [(p.latitudine, p.longitudine) for p in pts]
    if len(coords) < 2:
        t = db.query(VehicleTrip).filter(VehicleTrip.id == trip_id).first()
        if t and t.start_latitudine is not None and t.end_latitudine is not None:
            return round(distanza_metri(t.start_latitudine, t.start_longitudine, t.end_latitudine, t.end_longitudine) / 1000, 2)
        return 0
    total = 0
    for a, b in zip(coords, coords[1:]):
        total += distanza_metri(a[0], a[1], b[0], b[1])
    return round(total / 1000, 2)

def _trip_out(db: Session, t: VehicleTrip):
    v = db.query(Vehicle).filter(Vehicle.id == t.vehicle_id).first()
    u = db.query(User).filter(User.id == t.operaio_id).first()
    points = db.query(VehicleTripPoint).filter(VehicleTripPoint.trip_id == t.id).order_by(VehicleTripPoint.data_ora).all()
    fuel_total = sum(f.amount_euro or 0 for f in db.query(FuelRecord).filter(FuelRecord.trip_id == t.id).all())
    s = _settings(db)
    expected_km = round((fuel_total / s.fuel_price_euro_per_liter) * s.expected_km_per_liter, 2) if fuel_total else 0
    return {
        "id": t.id,
        "vehicle_id": t.vehicle_id,
        "targa": v.targa if v else "",
        "modello": v.modello if v else "",
        "operaio_id": t.operaio_id,
        "operaio": f"{u.nome} {u.cognome}" if u else "",
        "cantiere_id": t.cantiere_id,
        "start_time": t.start_time,
        "end_time": t.end_time,
        "start_latitudine": t.start_latitudine,
        "start_longitudine": t.start_longitudine,
        "end_latitudine": t.end_latitudine,
        "end_longitudine": t.end_longitudine,
        "status": t.status,
        "km_stimati": t.km_stimati or _trip_km(db, t.id),
        "fuori_orario": t.fuori_orario,
        "anomalia_carburante": t.anomalia_carburante,
        "fuel_total_euro": round(fuel_total, 2),
        "expected_km_from_fuel": expected_km,
        "points_count": len(points),
        "points": [{"latitudine": p.latitudine, "longitudine": p.longitudine, "data_ora": p.data_ora} for p in points],
    }

@app.post("/admin/vehicles")
def crea_vehicle(data: VehicleCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    existing = db.query(Vehicle).filter(Vehicle.targa == data.targa.upper().strip()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Targa già registrata")
    token = str(uuid.uuid4())
    v = Vehicle(targa=data.targa.upper().strip(), modello=data.modello, descrizione=data.descrizione, qr_token=token, status="disponibile")
    db.add(v); db.commit(); db.refresh(v)
    qr_url = f"{FRONTEND_URL}/vehicle/{v.id}"
    v.qr_code = _qr_data_url(qr_url)
    db.commit(); db.refresh(v)
    return _vehicle_out(v)

@app.get("/admin/vehicles")
def lista_vehicles(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    return [_vehicle_out(v) for v in db.query(Vehicle).order_by(Vehicle.targa).all()]

@app.get("/operaio/vehicles/{vehicle_id}")
def detail_vehicle(vehicle_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    v = db.query(Vehicle).filter(Vehicle.id == vehicle_id, Vehicle.attivo == True).first()
    if not v: raise HTTPException(status_code=404, detail="Autovettura non trovata")
    return {"id": v.id, "targa": v.targa, "modello": v.modello, "status": v.status}

@app.post("/operaio/vehicle-checkin")
def vehicle_checkin(data: VehicleCheckInput, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    v = db.query(Vehicle).filter(Vehicle.id == data.vehicle_id, Vehicle.attivo == True).first()
    if not v: raise HTTPException(status_code=404, detail="Autovettura non trovata")
    open_trip = db.query(VehicleTrip).filter(VehicleTrip.vehicle_id == v.id, VehicleTrip.status == "IN_CORSO").first()
    if open_trip: raise HTTPException(status_code=400, detail="Autovettura già in uso")
    user_open = db.query(VehicleTrip).filter(VehicleTrip.operaio_id == user.id, VehicleTrip.status == "IN_CORSO").first()
    if user_open: raise HTTPException(status_code=400, detail="Hai già un’autovettura in uso")
    now = datetime.now(); s = _settings(db)
    fuori = now.hour < s.working_start_hour or now.hour >= s.working_end_hour
    t = VehicleTrip(vehicle_id=v.id, operaio_id=user.id, cantiere_id=data.cantiere_id, start_time=now, start_latitudine=data.latitudine, start_longitudine=data.longitudine, accuratezza_gps=data.accuratezza_gps, status="IN_CORSO", fuori_orario=fuori)
    db.add(t); db.commit(); db.refresh(t)
    db.add(VehicleTripPoint(trip_id=t.id, latitudine=data.latitudine, longitudine=data.longitudine, accuratezza_gps=data.accuratezza_gps))
    v.status = "in_uso"; db.commit(); db.refresh(t)
    return _trip_out(db, t)

@app.post("/operaio/vehicle-point")
def vehicle_point(data: VehiclePointInput, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    t = db.query(VehicleTrip).filter(VehicleTrip.id == data.trip_id, VehicleTrip.operaio_id == user.id, VehicleTrip.status == "IN_CORSO").first()
    if not t: raise HTTPException(status_code=404, detail="Viaggio non trovato o già chiuso")
    p = VehicleTripPoint(trip_id=t.id, latitudine=data.latitudine, longitudine=data.longitudine, accuratezza_gps=data.accuratezza_gps)
    db.add(p); db.commit()
    return {"ok": True}

@app.get("/operaio/active-vehicle-trip")
def active_vehicle_trip(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    t = db.query(VehicleTrip).filter(VehicleTrip.operaio_id == user.id, VehicleTrip.status == "IN_CORSO").first()
    return _trip_out(db, t) if t else None

@app.post("/operaio/vehicle-checkout")
def vehicle_checkout(data: VehicleCheckoutInput, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = db.query(VehicleTrip).filter(VehicleTrip.operaio_id == user.id, VehicleTrip.status == "IN_CORSO")
    if data.trip_id: q = q.filter(VehicleTrip.id == data.trip_id)
    t = q.first()
    if not t: raise HTTPException(status_code=404, detail="Nessun utilizzo autovettura aperto")
    db.add(VehicleTripPoint(trip_id=t.id, latitudine=data.latitudine, longitudine=data.longitudine, accuratezza_gps=data.accuratezza_gps))
    t.end_time = datetime.now(); t.end_latitudine = data.latitudine; t.end_longitudine = data.longitudine; t.status = "CHIUSO"
    db.flush()
    t.km_stimati = _trip_km(db, t.id)
    v = db.query(Vehicle).filter(Vehicle.id == t.vehicle_id).first()
    if v: v.status = "disponibile"
    db.commit(); db.refresh(t)
    return _trip_out(db, t)

@app.post("/operaio/fuel")
def operaio_fuel(data: FuelInput, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = _settings(db)
    expected = round((data.amount_euro / s.fuel_price_euro_per_liter) * s.expected_km_per_liter, 2)
    f = FuelRecord(vehicle_id=data.vehicle_id, trip_id=data.trip_id, operaio_id=user.id, amount_euro=data.amount_euro, expected_km=expected, note=data.note)
    db.add(f); db.commit(); db.refresh(f)
    if data.trip_id:
        t = db.query(VehicleTrip).filter(VehicleTrip.id == data.trip_id).first()
        if t:
            km = t.km_stimati or _trip_km(db, t.id)
            min_expected = expected * (1 - s.anomaly_tolerance_percent / 100)
            if km and km < min_expected:
                t.anomalia_carburante = True
                db.commit()
    return {"id": f.id, "expected_km": f.expected_km, "amount_euro": f.amount_euro}

@app.get("/admin/vehicle-trips")
def admin_vehicle_trips(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    trips = db.query(VehicleTrip).order_by(VehicleTrip.start_time.desc()).limit(300).all()
    return [_trip_out(db, t) for t in trips]

@app.get("/admin/fuel")
def admin_fuel(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    out = []
    for f in db.query(FuelRecord).order_by(FuelRecord.created_at.desc()).limit(300).all():
        v = db.query(Vehicle).filter(Vehicle.id == f.vehicle_id).first()
        u = db.query(User).filter(User.id == f.operaio_id).first() if f.operaio_id else None
        out.append({"id": f.id, "vehicle_id": f.vehicle_id, "targa": v.targa if v else "", "operaio": f"{u.nome} {u.cognome}" if u else "", "trip_id": f.trip_id, "amount_euro": f.amount_euro, "expected_km": f.expected_km, "note": f.note, "created_at": f.created_at})
    return out

@app.get("/admin/fleet-settings")
def admin_fleet_settings(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    s = _settings(db)
    return {"default_fuel_amount_euro": s.default_fuel_amount_euro, "fuel_price_euro_per_liter": s.fuel_price_euro_per_liter, "expected_km_per_liter": s.expected_km_per_liter, "anomaly_tolerance_percent": s.anomaly_tolerance_percent, "working_start_hour": s.working_start_hour, "working_end_hour": s.working_end_hour}

@app.put("/admin/fleet-settings")
def put_fleet_settings(data: FleetSettingsInput, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    s = _settings(db)
    for k, v in data.model_dump().items(): setattr(s, k, v)
    db.commit(); db.refresh(s)
    return admin_fleet_settings(db, admin)

@app.get("/admin/fleet-report")
def fleet_report(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    trips = db.query(VehicleTrip).all()
    return {
        "vehicles": db.query(Vehicle).count(),
        "trips": len(trips),
        "open_trips": sum(1 for t in trips if t.status == "IN_CORSO"),
        "km_total": round(sum((t.km_stimati or 0) for t in trips), 2),
        "fuel_anomalies": sum(1 for t in trips if t.anomalia_carburante),
        "outside_working_hours": sum(1 for t in trips if t.fuori_orario),
    }
