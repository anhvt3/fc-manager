#!/bin/bash
set -e

cd ~/zalo-bot

# Fix bot.py for Linux (replace Windows-specific ctypes lock check with POSIX)
python3 << 'PYEOF'
import re

with open("bot.py", "r", encoding="utf-8") as f:
    content = f.read()

# Replace Windows ctypes lock check with Linux os.kill(pid, 0)
old_lock = '''def acquire_lock():
    pid = os.getpid()
    if os.path.exists(LOCK_FILE):
        try:
            with open(LOCK_FILE, "r") as f:
                old_pid = int(f.read().strip())
            import ctypes
            kernel32 = ctypes.windll.kernel32
            handle = kernel32.OpenProcess(0x1000, False, old_pid)
            if handle:
                kernel32.CloseHandle(handle)
                logging.error(f"Bot đang chạy (PID {old_pid}). Thoát.")
                sys.exit(1)
        except (ValueError, OSError):
            pass
    with open(LOCK_FILE, "w") as f:
        f.write(str(pid))'''

new_lock = '''def acquire_lock():
    pid = os.getpid()
    if os.path.exists(LOCK_FILE):
        try:
            with open(LOCK_FILE, "r") as f:
                old_pid = int(f.read().strip())
            os.kill(old_pid, 0)
            logging.error(f"Bot đang chạy (PID {old_pid}). Thoát.")
            sys.exit(1)
        except (ValueError, OSError, ProcessLookupError):
            pass
    with open(LOCK_FILE, "w") as f:
        f.write(str(pid))'''

content = content.replace(old_lock, new_lock)

with open("bot.py", "w", encoding="utf-8") as f:
    f.write(content)

print("bot.py patched for Linux OK")
PYEOF

# Test import
python3 -c "
import sys, os
os.chdir(os.path.expanduser('~/zalo-bot'))
sys.path.insert(0, '.')
from dotenv import load_dotenv
load_dotenv(override=True)
print('IMEI:', os.getenv('ZALO_IMEI', 'NOT SET')[:10] + '...')
print('GROUP_ID:', os.getenv('ZALO_GROUP_ID', 'NOT SET'))
print('GEMINI_KEY:', os.getenv('GEMINI_API_KEY', 'NOT SET')[:10] + '...')
print('CAPTAIN_ID:', os.getenv('ZALO_CAPTAIN_ID', 'NOT SET'))
print('All env vars OK')
"

# Create systemd service
sudo tee /etc/systemd/system/zalo-bot.service > /dev/null << 'EOF'
[Unit]
Description=FC Manager Zalo Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=Admin
WorkingDirectory=/home/Admin/zalo-bot
ExecStart=/usr/bin/python3 /home/Admin/zalo-bot/bot.py
Restart=always
RestartSec=15
Environment=PYTHONUNBUFFERED=1
StandardOutput=append:/home/Admin/zalo-bot/bot.log
StandardError=append:/home/Admin/zalo-bot/bot.log

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable zalo-bot.service
sudo systemctl start zalo-bot.service

sleep 3
sudo systemctl status zalo-bot.service --no-pager

echo "=== DEPLOY DONE ==="
