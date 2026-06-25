import json
import os
import random
import smtplib
from copy import deepcopy
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.requests import Request


BASE_DIR = Path(__file__).parent
DATA_DIR = Path("/data")
DATA_FILE = DATA_DIR / "journee_data.json"
OPTIONS_FILE = DATA_DIR / "options.json"
BACKUP_DIR = DATA_DIR / "backups"

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


def to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value or default)
    except Exception:
        return default


def clean_location(location: Dict[str, Any]) -> Dict[str, Any]:
    location_id = str(location.get("_id") or "").strip()

    if not location_id:
        location_id = str(uuid4())

    return {
        "_id": location_id,
        "name": str(location.get("name", "")).strip(),
        "duration": to_int(location.get("duration")),
        "duration_variation": to_int(location.get("duration_variation")),
        "travel": to_int(location.get("travel")),
        "travel_variation": to_int(location.get("travel_variation")),
        "fixed_arrival": str(location.get("fixed_arrival", "")).strip(),
        "fixed_departure": str(location.get("fixed_departure", "")).strip(),
        "notes": str(location.get("notes", "")).strip(),
    }


def load_data() -> Dict[str, Any]:
    changed = False

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
        return data

    base = default_data()

    for key, value in base.items():
        if key not in data:
            data[key] = value
            changed = True

    if "settings" not in data or not isinstance(data["settings"], dict):
        data["settings"] = base["settings"]
        changed = True

    if "days" not in data or not isinstance(data["days"], dict):
        data["days"] = base["days"]
        changed = True

    for day_key, day_label in DAYS:
        if day_key not in data["days"] or not isinstance(data["days"][day_key], dict):
            data["days"][day_key] = base["days"][day_key]
            changed = True

        day = data["days"][day_key]

        if day.get("label") != day_label:
            day["label"] = day_label
            changed = True

        if "start_time" not in day:
            day["start_time"] = "07:30"
            changed = True

        if "start_variation" not in day:
            day["start_variation"] = 0
            changed = True

        if "locations" not in day or not isinstance(day["locations"], list):
            day["locations"] = []
            changed = True

        cleaned_locations = [clean_location(item) for item in day.get("locations", []) if isinstance(item, dict)]

        if cleaned_locations != day.get("locations", []):
            day["locations"] = cleaned_locations
            changed = True

    if changed:
        save_data(data)

    return data


def save_data(data: Dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

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
        "automation_token": "",
        "automation_subject": "Relatório semanal - Journée",
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


def value_with_margin(base: int, variation: int, enabled: bool) -> Dict[str, int]:
    base = int(base or 0)
    variation = int(variation or 0)

    minimum = max(0, base - variation)
    maximum = max(minimum, base + variation)

    if enabled and variation > 0:
        value = random.randint(minimum, maximum)
    else:
        value = base

    value = max(minimum, min(maximum, value))

    return {
        "value": value,
        "min": minimum,
        "max": maximum,
    }


def distribute_delta(elements: List[Dict[str, int]], delta: int) -> int:
    """
    Tenta distribuir uma diferença de tempo entre vários campos ajustáveis.

    delta > 0:
        precisa esticar durações/deslocamentos.

    delta < 0:
        precisa encolher durações/deslocamentos.

    Retorna o que não conseguiu distribuir.
    """
    remaining = int(delta or 0)

    if remaining == 0:
        return 0

    direction = 1 if remaining > 0 else -1

    while remaining != 0:
        adjustable = []

        for element in elements:
            if direction > 0:
                capacity = element["max"] - element["value"]
            else:
                capacity = element["value"] - element["min"]

            if capacity > 0:
                adjustable.append((element, capacity))

        if not adjustable:
            break

        total_capacity = sum(capacity for _, capacity in adjustable)
        amount_to_apply = min(abs(remaining), total_capacity)

        shares = []
        applied = 0

        for element, capacity in adjustable:
            raw_share = amount_to_apply * capacity / total_capacity
            share = int(raw_share)
            fraction = raw_share - share

            shares.append(
                {
                    "element": element,
                    "capacity": capacity,
                    "share": share,
                    "fraction": fraction,
                }
            )

            applied += share

        remainder = amount_to_apply - applied

        shares.sort(key=lambda item: item["fraction"], reverse=True)

        index = 0
        while remainder > 0 and shares:
            shares[index % len(shares)]["share"] += 1
            remainder -= 1
            index += 1

        actually_applied = 0

        for item in shares:
            element = item["element"]
            capacity = item["capacity"]
            share = min(item["share"], capacity)

            if share <= 0:
                continue

            element["value"] += direction * share
            actually_applied += share

        if actually_applied <= 0:
            break

        remaining -= direction * actually_applied

    return remaining


def next_fixed_arrival_index(locations: List[Dict[str, Any]], start_index: int) -> Optional[int]:
    for index in range(start_index, len(locations)):
        if parse_time(locations[index].get("fixed_arrival")) is not None:
            return index

    return None


def calculate_day(day: Dict[str, Any], randomize_enabled: bool = True) -> Dict[str, Any]:
    start = parse_time(day.get("start_time")) or 0
    start_variation = int(day.get("start_variation") or 0)

    current = randomize_minutes(start, start_variation, randomize_enabled)

    calculated = []
    warnings = []

    total_work = 0
    total_travel = 0

    raw_locations = day.get("locations", [])
    locations = [clean_location(item) for item in raw_locations if isinstance(item, dict)]
    locations = [item for item in locations if item["name"]]

    def append_calculated(location: Dict[str, Any], arrival: int, duration: int, travel: int) -> None:
        nonlocal total_work, total_travel

        departure = arrival + duration

        calculated.append(
            {
                "_id": location.get("_id", ""),
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

    index = 0

    while index < len(locations):
        location = locations[index]

        fixed_arrival = parse_time(location.get("fixed_arrival"))

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

            current = fixed_arrival

        target_index = next_fixed_arrival_index(locations, index + 1)

        if target_index is not None:
            target_location = locations[target_index]
            target_arrival = parse_time(target_location.get("fixed_arrival"))

            segment_items = []
            adjustable_elements = []

            predicted = current

            for segment_index in range(index, target_index):
                segment_location = locations[segment_index]

                fixed_departure = parse_time(segment_location.get("fixed_departure"))

                if fixed_departure is not None and parse_time(segment_location.get("fixed_arrival")) is not None:
                    duration_value = max(0, fixed_departure - predicted)
                    duration_info = {
                        "value": duration_value,
                        "min": duration_value,
                        "max": duration_value,
                    }
                else:
                    duration_info = value_with_margin(
                        segment_location["duration"],
                        segment_location["duration_variation"],
                        randomize_enabled,
                    )

                travel_info = value_with_margin(
                    segment_location["travel"],
                    segment_location["travel_variation"],
                    randomize_enabled,
                )

                segment_items.append(
                    {
                        "location": segment_location,
                        "duration": duration_info,
                        "travel": travel_info,
                    }
                )

                if duration_info["max"] > duration_info["min"]:
                    adjustable_elements.append(duration_info)

                if travel_info["max"] > travel_info["min"]:
                    adjustable_elements.append(travel_info)

                predicted += duration_info["value"] + travel_info["value"]

            delta = target_arrival - predicted
            not_distributed = distribute_delta(adjustable_elements, delta)

            if not_distributed > 0:
                warnings.append(
                    {
                        "type": "empty_time",
                        "location": target_location["name"],
                        "message": f"Mesmo usando as margens, ainda sobra {format_duration(not_distributed)} antes de {target_location['name']}.",
                    }
                )

            elif not_distributed < 0:
                warnings.append(
                    {
                        "type": "overlap_time",
                        "location": target_location["name"],
                        "message": f"Mesmo reduzindo as margens, faltam {format_duration(abs(not_distributed))} para chegar em {target_location['name']} no horário fixo.",
                    }
                )

            for item in segment_items:
                arrival = current
                duration = item["duration"]["value"]
                travel = item["travel"]["value"]

                if duration <= 0:
                    warnings.append(
                        {
                            "type": "empty_duration",
                            "location": item["location"]["name"],
                            "message": f"{item['location']['name']} está sem duração válida.",
                        }
                    )

                append_calculated(item["location"], arrival, duration, travel)

                current = arrival + duration + travel

            current = target_arrival
            index = target_index
            continue

        while index < len(locations):
            location = locations[index]

            fixed_arrival = parse_time(location.get("fixed_arrival"))
            fixed_departure = parse_time(location.get("fixed_departure"))

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

                current = fixed_arrival

            arrival = current

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

            if index < len(locations) - 1:
                travel = randomize_minutes(
                    location["travel"],
                    location["travel_variation"],
                    randomize_enabled,
                )
            else:
                travel = 0

            append_calculated(location, arrival, duration, travel)

            current = departure + travel
            index += 1

        break

    first_arrival = parse_time(calculated[0]["arrival"]) if calculated else current

    return {
        "label": day.get("label", ""),
        "start_time": format_time(start),
        "real_start_time": format_time(start),
        "calculated_start_time": format_time(first_arrival),
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


def ensure_backup_dir() -> None:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def sanitize_backup_name(name: str) -> str:
    raw_name = str(name or "").strip()

    if raw_name.endswith(".json"):
        raw_name = raw_name[:-5]

    safe_name = "".join(
        char for char in raw_name
        if char.isalnum() or char in ("-", "_")
    ).strip()

    if not safe_name:
        safe_name = datetime.now().strftime("backup_%Y%m%d_%H%M%S")

    return f"{safe_name}.json"


def get_backup_file(filename: str) -> Path:
    ensure_backup_dir()

    filename = str(filename or "").strip()

    if not filename:
        raise HTTPException(status_code=400, detail="Nome do backup não informado.")

    if filename != Path(filename).name:
        raise HTTPException(status_code=400, detail="Nome de backup inválido.")

    if not filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="O backup precisa ser um arquivo .json.")

    backup_file = BACKUP_DIR / filename

    try:
        resolved_backup_dir = BACKUP_DIR.resolve()
        resolved_backup_file = backup_file.resolve()

        if not resolved_backup_file.is_relative_to(resolved_backup_dir):
            raise HTTPException(status_code=400, detail="Caminho de backup inválido.")
    except AttributeError:
        resolved_backup_dir = str(BACKUP_DIR.resolve())
        resolved_backup_file = str(backup_file.resolve())

        if not resolved_backup_file.startswith(resolved_backup_dir):
            raise HTTPException(status_code=400, detail="Caminho de backup inválido.")

    return backup_file


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
            "start_variation": to_int(day.get("start_variation")),
            "locations": [clean_location(item) for item in day.get("locations", []) if isinstance(item, dict)],
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
    filename = sanitize_backup_name(name)

    ensure_backup_dir()

    backup_file = BACKUP_DIR / filename

    if backup_file.exists():
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        stem = backup_file.stem
        backup_file = BACKUP_DIR / f"{stem}_{timestamp}.json"

    with open(backup_file, "w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)

    return {
        "ok": True,
        "file": backup_file.name,
    }


@app.get("/api/backup/list")
async def api_backup_list():
    ensure_backup_dir()

    files = sorted(
        [item.name for item in BACKUP_DIR.glob("*.json") if item.is_file()],
        reverse=True,
    )

    return {
        "backups": files,
    }


@app.post("/api/backup/restore")
async def api_backup_restore(payload: Dict[str, Any]):
    filename = payload.get("filename")

    backup_file = get_backup_file(filename)

    if not backup_file.exists():
        raise HTTPException(status_code=404, detail="Backup não encontrado.")

    try:
        with open(backup_file, "r", encoding="utf-8") as file:
            data = json.load(file)
    except Exception:
        raise HTTPException(status_code=400, detail="Backup inválido ou corrompido.")

    save_data(data)

    return {
        "ok": True,
        "data": data,
    }


@app.post("/api/backup/rename")
async def api_backup_rename(payload: Dict[str, Any]):
    filename = payload.get("filename")
    new_name = payload.get("new_name")

    old_file = get_backup_file(filename)

    if not old_file.exists():
        raise HTTPException(status_code=404, detail="Backup não encontrado.")

    new_filename = sanitize_backup_name(new_name)
    new_file = BACKUP_DIR / new_filename

    if new_file.exists():
        raise HTTPException(status_code=409, detail="Já existe um backup com esse nome.")

    old_file.rename(new_file)

    return {
        "ok": True,
        "old_file": old_file.name,
        "new_file": new_file.name,
    }


@app.delete("/api/backup/delete")
async def api_backup_delete(payload: Dict[str, Any]):
    filename = payload.get("filename")

    backup_file = get_backup_file(filename)

    if not backup_file.exists():
        raise HTTPException(status_code=404, detail="Backup não encontrado.")

    backup_file.unlink()

    return {
        "ok": True,
        "deleted": backup_file.name,
    }


@app.post("/api/automation/send_week_report")
async def api_automation_send_week_report(payload: Dict[str, Any]):
    options = load_options()

    configured_token = str(options.get("automation_token") or "").strip()
    received_token = str(payload.get("token") or "").strip()

    if configured_token and received_token != configured_token:
        raise HTTPException(status_code=401, detail="Token de automação inválido.")

    data = load_data()

    force_random = payload.get("force_random")

    report = generate_week_report(data, force_random)

    subject = (
        payload.get("subject")
        or options.get("automation_subject")
        or f"Relatório semanal - Journée - {datetime.now().strftime('%d/%m/%Y')}"
    )

    recipients = payload.get("recipients") or options.get("default_recipients", [])

    result = send_email(subject, report, recipients)

    return {
        "ok": True,
        "message": "Relatório semanal enviado por automação.",
        "email": result,
    }
