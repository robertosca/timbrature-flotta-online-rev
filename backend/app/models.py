from sqlalchemy import Column, Integer, Float, String, DateTime, Boolean, Date, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String, nullable=False)
    cognome = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False, index=True)
    codice_fiscale = Column(String, nullable=True, unique=True)
    password_hash = Column(String, nullable=False)
    ruolo = Column(String, default="operaio")  # admin / operaio
    attivo = Column(Boolean, default=True)

class Cantiere(Base):
    __tablename__ = "cantieri"
    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String, nullable=False)
    indirizzo = Column(String, nullable=True)
    latitudine = Column(Float, nullable=False)
    longitudine = Column(Float, nullable=False)
    raggio_metri = Column(Integer, default=200)
    attivo = Column(Boolean, default=True)

class Assegnazione(Base):
    __tablename__ = "assegnazioni"
    id = Column(Integer, primary_key=True, index=True)
    operaio_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    cantiere_id = Column(Integer, ForeignKey("cantieri.id"), nullable=False)
    data_inizio = Column(Date, nullable=False)
    data_fine = Column(Date, nullable=True)

class Timbratura(Base):
    __tablename__ = "timbrature"
    id = Column(Integer, primary_key=True, index=True)
    operaio_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    cantiere_id = Column(Integer, ForeignKey("cantieri.id"), nullable=False)
    tipo = Column(String, nullable=False)  # ingresso / uscita
    data_ora = Column(DateTime, default=datetime.now, nullable=False)
    latitudine = Column(Float, nullable=False)
    longitudine = Column(Float, nullable=False)
    distanza = Column(Float, nullable=True)
    accuratezza_gps = Column(Float, nullable=True)
    valida = Column(Boolean, default=False)
    sospetta = Column(Boolean, default=False)
    motivo = Column(String, nullable=True)
    motivo_sospetto = Column(String, nullable=True)

class PresenzaGiornaliera(Base):
    __tablename__ = "presenze_giornaliere"
    id = Column(Integer, primary_key=True, index=True)
    operaio_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    cantiere_id = Column(Integer, ForeignKey("cantieri.id"), nullable=False)
    data = Column(Date, nullable=False)
    ingresso = Column(DateTime, nullable=True)
    uscita = Column(DateTime, nullable=True)
    ore_lavorate = Column(Float, default=0)
    valida = Column(Boolean, default=True)
    note = Column(String, nullable=True)

class LogSicurezza(Base):
    __tablename__ = "log_sicurezza"
    id = Column(Integer, primary_key=True, index=True)
    operaio_id = Column(Integer, nullable=True)
    cantiere_id = Column(Integer, nullable=True)
    data_ora = Column(DateTime, default=datetime.now, nullable=False)
    evento = Column(String, nullable=False)
    latitudine = Column(Float, nullable=True)
    longitudine = Column(Float, nullable=True)
    distanza = Column(Float, nullable=True)
    accuratezza_gps = Column(Float, nullable=True)
    note = Column(String, nullable=True)


class Vehicle(Base):
    __tablename__ = "vehicles"
    id = Column(Integer, primary_key=True, index=True)
    targa = Column(String, nullable=False, unique=True, index=True)
    modello = Column(String, nullable=True)
    descrizione = Column(String, nullable=True)
    qr_token = Column(String, nullable=False, unique=True, index=True)
    qr_code = Column(String, nullable=True)
    status = Column(String, default="disponibile")  # disponibile / in_uso
    attivo = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.now, nullable=False)

class VehicleTrip(Base):
    __tablename__ = "vehicle_trips"
    id = Column(Integer, primary_key=True, index=True)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id"), nullable=False)
    operaio_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    cantiere_id = Column(Integer, ForeignKey("cantieri.id"), nullable=True)
    start_time = Column(DateTime, default=datetime.now, nullable=False)
    end_time = Column(DateTime, nullable=True)
    start_latitudine = Column(Float, nullable=True)
    start_longitudine = Column(Float, nullable=True)
    end_latitudine = Column(Float, nullable=True)
    end_longitudine = Column(Float, nullable=True)
    accuratezza_gps = Column(Float, nullable=True)
    status = Column(String, default="IN_CORSO")
    km_stimati = Column(Float, default=0)
    fuori_orario = Column(Boolean, default=False)
    anomalia_carburante = Column(Boolean, default=False)
    note = Column(String, nullable=True)

class VehicleTripPoint(Base):
    __tablename__ = "vehicle_trip_points"
    id = Column(Integer, primary_key=True, index=True)
    trip_id = Column(Integer, ForeignKey("vehicle_trips.id"), nullable=False)
    latitudine = Column(Float, nullable=False)
    longitudine = Column(Float, nullable=False)
    accuratezza_gps = Column(Float, nullable=True)
    data_ora = Column(DateTime, default=datetime.now, nullable=False)

class FuelRecord(Base):
    __tablename__ = "fuel_records"
    id = Column(Integer, primary_key=True, index=True)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id"), nullable=False)
    trip_id = Column(Integer, ForeignKey("vehicle_trips.id"), nullable=True)
    operaio_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    amount_euro = Column(Float, default=50)
    expected_km = Column(Float, default=0)
    note = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.now, nullable=False)

class FleetSettings(Base):
    __tablename__ = "fleet_settings"
    id = Column(Integer, primary_key=True, index=True)
    default_fuel_amount_euro = Column(Float, default=50)
    fuel_price_euro_per_liter = Column(Float, default=1.85)
    expected_km_per_liter = Column(Float, default=14)
    anomaly_tolerance_percent = Column(Float, default=25)
    working_start_hour = Column(Integer, default=7)
    working_end_hour = Column(Integer, default=18)
