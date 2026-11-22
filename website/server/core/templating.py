from datetime import date
from pathlib import Path

from fastapi.templating import Jinja2Templates

from website.server.core.site_updates import site_version

BASE_DIR = Path(__file__).resolve().parents[3]

templates = Jinja2Templates(directory=BASE_DIR / "website" / "templates")
templates.env.globals["site_version"] = site_version
templates.env.globals["current_year"] = lambda: date.today().year
templates.env.globals["terms_version"] = "2026-11-14"
