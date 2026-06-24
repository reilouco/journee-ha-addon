import json
import os
import random
import smtplib
from copy import deepcopy
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.requests import Request


BASE_DIR = Path(__file__).parent
DATA_DIR = Path("/data")
DATA_FILE = DATA_DIR / "journee_data.json"
OPTIONS_FILE = DATA_DIR / "options.json"

if not DATA_DIR.exists():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Journée HA")

app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")


DAYS = [
    ("segunda", "SEGUNDA-FEIRA"),
    ("terca", "TERÇA-FEIRA"),
    ("quarta", "QUARTA-FEIRA"),
    ("quinta", "QUINTA-FEIRA"),
    ("sexta", "SEXTA-FEIRA"),
    ("sabado", "SÁBADO"),
]


def default_data() -> Dict[str, Any]:
    return {
        "settings": {
            "randomize": True,
            "report_period": datetime.now().strftime("%d/%m/%Y"),
        },
        "days": {
            day_key: {
                "label": day_label,
                "start_time": "07:30",
                "start_variation": 0,
                "locations": [],
            }
            for day_key, day_label in DAYS
        },
    }


def load_data() -> Dict[str, Any]:
    if not DATA_FILE.exists():
        data = default_data()
        save_data(data)
        return data

    try:
        with open(DATA_FILE, "r", encoding="utf-8") as file:
            data = json.load(file)
    except Exception:
        data = default_data()
        save_data(data)

    base = default_data()

    for key, value in base.items():
        if key not in data:
            data[key] = value

    for day_key, day_label in DAYS:
        if day_key not in data["days"]:
            data["days"][day_key] = base["days"][day_key]

        data["days"][day_key]["label"] = day_label

        if "locations" not in data["days"][day_key]:
            data["days"][day_key]["locations"] = []

    return data


def save_data(data: Dict[str, Any]) -> None:
    with open(DATA_FILE, "w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)


def load_options() -> Dict[str, Any]:
    defaults = {
        "smtp_enabled": False,
        "smtp_host": "smtp.gmail.com",
        "smtp_port": 587,
        "smtp_user": "",
        "smtp_password": "",
        "smtp_from": "",
        "smtp_from_name": "Journée HA",
        "smtp_use_tls": True,
        "default_recipients": [],
    }

    if not OPTIONS_FILE.exists():
        return defaults

    try:
        with open(OPTIONS_FILE, "r", encoding="utf-8") as file:
            options = json.load(file)
    except Exception:
        return defaults

    for key, value in defaults.items():
        options.setdefault(key, value)

    return options


def parse_time(value: Optional[str]) -> Optional[int]:
    if not value:
        return None

    try:
        hour, minute = value.strip().split(":")
        return int(hour) * 60 + int(minute)
    except Exception:
        return None


def format_time(minutes: int) -> str:
    minutes = minutes % (24 * 60)
    hour = minutes // 60
    minute = minutes % 60
    return f"{hour:02d}:{minute:02d}"


def format_duration(minutes: int) -> str:
    if minutes < 0:
        return f"-{format_duration(abs(minutes))}"

    hours = minutes // 60
    mins = minutes % 60

    if hours and mins:
        return f"{hours}h{mins:02d}"

    if hours:
        return f"{hours}h"

    return f"{mins}min"


def randomize_minutes(base: int, variation: int, enabled: bool) -> int:
    base = int(base or 0)
    variation = int(variation or 0)

    if not enabled or variation <= 0:
        return base

    return max(0, base + random.randint(-variation, variation))


def clean_location(location: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "name": str(location.get("name", "")).strip(),
        "duration": int(location.get("duration") or 0),
        "duration_variation": int(location.get("duration_variation") or 0),
        "travel": int(location.get("travel") or 0),
        "travel_variation": int(location.get("travel_variation") or 0),
        "fixed_arrival": str(location.get("fixed_arrival", "")).strip(),
        "fixed_departure": str(location.get("fixed_departure", "")).strip(),
        "notes": str(location.get("notes", "")).strip(),
    }


def calculate_day(day: Dict[str, Any], randomize_enabled: bool = True) -> Dict[str, Any]:
    start = parse_time(day.get("start_time")) or 0
    start_variation = int(day.get("start_variation") or 0)

    current = randomize_minutes(start, start_variation, randomize_enabled)

    calculated = []
    warnings = []

    total_work = 0
    total_travel = 0

    raw_locations = day.get("locations", [])
    locations = [clean_location(item) for item in raw_locations]
    locations = [item for item in locations if item["name"]]

    for index, location in enumerate(locations):
        fixed_arrival = parse_time(location.get("fixed_arrival"))
        fixed_departure = parse_time(location.get("fixed_departure"))

        arrival = current

        if fixed_arrival is not None:
            if fixed_arrival > current:
                warnings.append(
                    {
                        "type": "empty_time",
                        "location": location["name"],
                        "message": f"Tempo vazio de {format_duration(fixed_arrival - current)} antes de {location['name']}.",
                    }
                )
            elif fixed_arrival < current:
                warnings.append(
                    {
                        "type": "overlap_time",
                        "location": location["name"],
                        "message": f"{location['name']} começa {format_duration(current - fixed_arrival)} antes do horário possível.",
                    }
                )

            arrival = fixed_arrival

        if fixed_departure is not None:
            departure = fixed_departure

            if departure < arrival:
                warnings.append(
                    {
                        "type": "invalid_fixed_time",
                        "location": location["name"],
                        "message": f"{location['name']} tem saída fixa antes da chegada.",
                    }
                )
                departure = arrival

            duration = departure - arrival
        else:
            duration = randomize_minutes(
                location["duration"],
                location["duration_variation"],
                randomize_enabled,
            )
            departure = arrival + duration

        if duration <= 0:
            warnings.append(
                {
                    "type": "empty_duration",
                    "location": location["name"],
                    "message": f"{location['name']} está sem duração válida.",
                }
            )

        travel = 0

        if index < len(locations) - 1:
            travel = randomize_minutes(
                location["travel"],
                location["travel_variation"],
                randomize_enabled,
            )

        calculated.append(
            {
                "name": location["name"],
                "arrival": format_time(arrival),
                "departure": format_time(departure),
                "duration": duration,
                "duration_formatted": format_duration(duration),
                "travel": travel,
                "travel_formatted": format_duration(travel),
                "notes": location.get("notes", ""),
            }
        )

        total_work += max(0, duration)
        total_travel += max(0, travel)

        current = departure + travel

    return {
        "label": day.get("label", ""),
        "start_time": format_time(start),
        "real_start_time": format_time(parse_time(day.get("start_time")) or 0),
        "calculated_start_time": format_time(
            parse_time(calculated[0]["arrival"]) if calculated else current
        ),
        "locations": calculated,
        "total_work": total_work,
        "total_work_formatted": format_duration(total_work),
        "total_travel": total_travel,
        "total_travel_formatted": format_duration(total_travel),
        "end_time": format_time(current if calculated else start),
        "warnings": warnings,
    }


def calculate_week(data: Dict[str, Any], force_random: Optional[bool] = None) -> Dict[str, Any]:
    randomize_enabled = bool(data.get("settings", {}).get("randomize", True))

    if force_random is not None:
        randomize_enabled = force_random

    result = {
        "days": {},
        "warnings": [],
        "total_work": 0,
        "total_travel": 0,
    }

    for day_key, day_label in DAYS:
        calculated = calculate_day(data["days"][day_key], randomize_enabled)
        result["days"][day_key] = calculated
        result["warnings"].extend(calculated["warnings"])
        result["total_work"] += calculated["total_work"]
        result["total_travel"] += calculated["total_travel"]

    result["total_work_formatted"] = format_duration(result["total_work"])
    result["total_travel_formatted"] = format_duration(result["total_travel"])

    return result


def generate_week_report(data: Dict[str, Any], force_random: Optional[bool] = None) -> str:
    period = data.get("settings", {}).get("report_period") or datetime.now().strftime("%d/%m/%Y")
    week = calculate_week(data, force_random)

    lines = []
    lines.append("RELATÓRIO SEMANAL - JOURNÉE")
    lines.append(f"Período: {period}")
    lines.append("")

    for day_key, day_label in DAYS:
        day = week["days"][day_key]

        lines.append("========================")
        lines.append(day_label)
        lines.append("========================")
        lines.append("")

        if not day["locations"]:
            lines.append("Nenhum horário cadastrado.")
            lines.append("")
            continue

        for item in day["locations"]:
            lines.append(
                f"{item['name']} | {item['arrival']} - {item['departure']} | {item['duration_formatted']}"
            )

        lines.append("")
        lines.append(f"Total trabalho: {day['total_work_formatted']}")
        lines.append(f"Total deslocamento: {day['total_travel_formatted']}")
        lines.append(f"Término: {day['end_time']}")

        if day["warnings"]:
            lines.append("")
            lines.append("Avisos:")
            for warning in day["warnings"]:
                lines.append(f"- {warning['message']}")

        lines.append("")

    lines.append("========================")
    lines.append("RESUMO DA SEMANA")
    lines.append("========================")
    lines.append("")
    lines.append(f"Total trabalho semanal: {week['total_work_formatted']}")
    lines.append(f"Total deslocamento semanal: {week['total_travel_formatted']}")

    return "\n".join(lines).strip()


def send_email(subject: str, body: str, recipients: List[str]) -> Dict[str, Any]:
    options = load_options()

    if not options.get("smtp_enabled"):
        raise HTTPException(status_code=400, detail="SMTP não está ativado nas opções do add-on.")

    smtp_host = options.get("smtp_host")
    smtp_port = int(options.get("smtp_port") or 587)
    smtp_user = options.get("smtp_user")
    smtp_password = options.get("smtp_password")
    smtp_from = options.get("smtp_from") or smtp_user
    smtp_from_name = options.get("smtp_from_name") or "Journée HA"
    smtp_use_tls = bool(options.get("smtp_use_tls", True))

    if not smtp_host or not smtp_user or not smtp_password or not smtp_from:
        raise HTTPException(status_code=400, detail="Configuração SMTP incompleta.")

    if not recipients:
        recipients = options.get("default_recipients", [])

    recipients = [item.strip() for item in recipients if item.strip()]

    if not recipients:
        raise HTTPException(status_code=400, detail="Nenhum destinatário informado.")

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = f"{smtp_from_name} <{smtp_from}>"
    message["To"] = ", ".join(recipients)
    message.set_content(body)

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as server:
            if smtp_use_tls:
                server.starttls()

            server.login(smtp_user, smtp_password)
            server.send_message(message)

    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Erro ao enviar email: {error}")

    return {
        "ok": True,
        "sent_to": recipients,
    }


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
        },
    )


@app.get("/api/data")
async def api_get_data():
    return load_data()


@app.post("/api/data")
async def api_save_data(payload: Dict[str, Any]):
    data = default_data()

    incoming = deepcopy(payload)

    data["settings"].update(incoming.get("settings", {}))

    incoming_days = incoming.get("days", {})

    for day_key, day_label in DAYS:
        day = incoming_days.get(day_key, {})
        data["days"][day_key] = {
            "label": day_label,
            "start_time": day.get("start_time") or "07:30",
            "start_variation": int(day.get("start_variation") or 0),
            "locations": [clean_location(item) for item in day.get("locations", [])],
        }

    save_data(data)

    return {
        "ok": True,
        "data": data,
    }


@app.post("/api/calculate/week")
async def api_calculate_week(payload: Dict[str, Any]):
    data = load_data()
    force_random = payload.get("force_random")

    return calculate_week(data, force_random)


@app.post("/api/report/week")
async def api_report_week(payload: Dict[str, Any]):
    data = load_data()
    force_random = payload.get("force_random")

    return {
        "report": generate_week_report(data, force_random),
    }


@app.post("/api/email/send")
async def api_email_send(payload: Dict[str, Any]):
    subject = payload.get("subject") or f"Relatório semanal - Journée - {datetime.now().strftime('%d/%m/%Y')}"
    body = payload.get("body") or ""
    recipients = payload.get("recipients") or []

    if not body.strip():
        raise HTTPException(status_code=400, detail="O relatório está vazio.")

    return send_email(subject, body, recipients)


@app.post("/api/backup/create")
async def api_backup_create(payload: Dict[str, Any]):
    data = load_data()

    name = payload.get("name") or datetime.now().strftime("backup_%Y%m%d_%H%M%S")
    safe_name = "".join(char for char in name if char.isalnum() or char in ("-", "_")).strip()

    if not safe_name:
        safe_name = datetime.now().strftime("backup_%Y%m%d_%H%M%S")

    backup_dir = DATA_DIR / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)

    backup_file = backup_dir / f"{safe_name}.json"

    with open(backup_file, "w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)

    return {
        "ok": True,
        "file": backup_file.name,
    }


@app.get("/api/backup/list")
async def api_backup_list():
    backup_dir = DATA_DIR / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)

    files = sorted(
        [item.name for item in backup_dir.glob("*.json")],
        reverse=True,
    )

    return {
        "backups": files,
    }


@app.post("/api/backup/restore")
async def api_backup_restore(payload: Dict[str, Any]):
    filename = payload.get("filename")

    if not filename:
        raise HTTPException(status_code=400, detail="Nome do backup não informado.")

    backup_file = DATA_DIR / "backups" / filename

    if not backup_file.exists():
        raise HTTPException(status_code=404, detail="Backup não encontrado.")

    with open(backup_file, "r", encoding="utf-8") as file:
        data = json.load(file)

    save_data(data)

    return {
        "ok": True,
        "data": data,
    }