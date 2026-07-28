"""Khởi động dashboard web với biến môi trường từ .env ở thư mục gốc."""

import os
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")
os.environ.setdefault("MONGO_API_URL", "http://localhost:8000")

if __name__ == "__main__":
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
    print("Mở dashboard tại http://localhost:3000")
    npm = "npm.cmd" if os.name == "nt" else "npm"
    subprocess.run([npm, "run", "dev"], cwd=ROOT / "web", env=os.environ.copy(), check=False)
