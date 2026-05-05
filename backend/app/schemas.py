from pydantic import BaseModel, EmailStr
from datetime import date, datetime
from typing import Optional

class LoginInput(BaseModel):
    email: str
    password: str

class UserCreate(BaseModel):
    nome: str
    cognome: str
    email: str
    password: str
    codice_fiscale: Optional[str] = None
    ruolo: str = "operaio"

class CantiereCreate(BaseModel):
    nome: str
    indirizzo: Optional[str] = None
    latitudine: float
    longitudine: float
    raggio_metri: int = 200
    attivo: bool = True
    ora_inizio_attivita: str = "07:00"
    ora_fine_attivita: str = "18:00"

class AssegnazioneCreate(BaseModel):
    operaio_id: int
    cantiere_id: int
    data_inizio: date
    data_fine: Optional[date] = None

class TimbraturaInput(BaseModel):
    cantiere_id: int
    tipo: str
    latitudine: float
    longitudine: float
    accuratezza_gps: Optional[float] = None


class VehicleCreate(BaseModel):
    targa: str
    modello: Optional[str] = None
    descrizione: Optional[str] = None

class VehicleCheckInput(BaseModel):
    vehicle_id: int
    cantiere_id: Optional[int] = None
    latitudine: float
    longitudine: float
    accuratezza_gps: Optional[float] = None

class VehiclePointInput(BaseModel):
    trip_id: int
    latitudine: float
    longitudine: float
    accuratezza_gps: Optional[float] = None

class VehicleCheckoutInput(BaseModel):
    trip_id: Optional[int] = None
    latitudine: float
    longitudine: float
    accuratezza_gps: Optional[float] = None

class FuelInput(BaseModel):
    vehicle_id: int
    trip_id: Optional[int] = None
    amount_euro: float = 50
    note: Optional[str] = None

class FleetSettingsInput(BaseModel):
    default_fuel_amount_euro: float = 50
    fuel_price_euro_per_liter: float = 1.85
    expected_km_per_liter: float = 14
    anomaly_tolerance_percent: float = 25
    working_start_hour: int = 7
    working_end_hour: int = 18
