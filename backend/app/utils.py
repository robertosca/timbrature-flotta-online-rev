import math
from datetime import date
from sqlalchemy.orm import Session
from .models import Assegnazione, PresenzaGiornaliera, LogSicurezza

SOGLIA_ACCURATEZZA_GPS = 100

def distanza_metri(lat1, lon1, lat2, lon2):
    R = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

def verifica_assegnazione(db: Session, operaio_id: int, cantiere_id: int) -> bool:
    oggi = date.today()
    return db.query(Assegnazione).filter(
        Assegnazione.operaio_id == operaio_id,
        Assegnazione.cantiere_id == cantiere_id,
        Assegnazione.data_inizio <= oggi,
        ((Assegnazione.data_fine == None) | (Assegnazione.data_fine >= oggi))
    ).first() is not None

def ha_ingresso_aperto(db: Session, operaio_id: int) -> bool:
    oggi = date.today()
    return db.query(PresenzaGiornaliera).filter(
        PresenzaGiornaliera.operaio_id == operaio_id,
        PresenzaGiornaliera.data == oggi,
        PresenzaGiornaliera.ingresso != None,
        PresenzaGiornaliera.uscita == None
    ).first() is not None

def giornata_chiusa(db: Session, operaio_id: int) -> bool:
    oggi = date.today()
    return db.query(PresenzaGiornaliera).filter(
        PresenzaGiornaliera.operaio_id == operaio_id,
        PresenzaGiornaliera.data == oggi,
        PresenzaGiornaliera.ingresso != None,
        PresenzaGiornaliera.uscita != None
    ).first() is not None

def calcola_ore(ingresso, uscita, pausa_auto=True):
    ore = (uscita - ingresso).total_seconds() / 3600
    if pausa_auto and ore > 6:
        ore -= 1
    return round(max(ore, 0), 2)

def registra_log_sicurezza(db: Session, operaio_id, cantiere_id, evento, latitudine=None, longitudine=None, distanza=None, accuratezza_gps=None, note=None):
    log = LogSicurezza(
        operaio_id=operaio_id,
        cantiere_id=cantiere_id,
        evento=evento,
        latitudine=latitudine,
        longitudine=longitudine,
        distanza=distanza,
        accuratezza_gps=accuratezza_gps,
        note=note
    )
    db.add(log)
    db.commit()
