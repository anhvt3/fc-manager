import os
import sys
import json
import time
import re
import requests
import logging
import threading
import atexit
from datetime import datetime
from dotenv import load_dotenv
import google.generativeai as genai
from zlapi import ZaloAPI
from zlapi.models import Message

load_dotenv(override=True)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOCK_FILE = os.path.join(SCRIPT_DIR, "bot.lock")

def acquire_lock():
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
        f.write(str(pid))

def release_lock():
    try:
        if os.path.exists(LOCK_FILE):
            os.remove(LOCK_FILE)
    except OSError:
        pass

IMEI = os.getenv("ZALO_IMEI")
COOKIE = os.getenv("ZALO_COOKIE")
GROUP_ID = os.getenv("ZALO_GROUP_ID")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
API_FUNDS_URL = "https://fcfriend.vercel.app/api/funds"
API_MATCHES_URL = "https://fcfriend.vercel.app/api/matches"
CAPTAIN_ID = os.getenv("ZALO_CAPTAIN_ID")
MEMBERS = [
    "Phạm Phúc","Long Nhật","Đào Tiên","Vũ Nguyên (Lều Hữu Nhu)","Viết Quân",
    "Minh Phúc","Trần Quyền","Duy Đông","Xuân Hoàn","Văn Khang",
    "Huỳnh Lê","Văn Mạnh","Nguyễn Tùng","Hữu Trí","Trường Nguyễn",
    "Thế Anh","Thanh Sơn","Như Ý","Công Dậu","Đinh Trường Chính", "Huy 2001"
]

WATCHDOG_TIMEOUT = 300
MAX_RECONNECT_DELAY = 60

genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel('gemini-2.5-flash')

os.chdir(SCRIPT_DIR)

logging.basicConfig(
    filename='bot.log',
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    encoding='utf-8'
)

def get_current_period():
    now = datetime.now()
    return f"Quỹ T{now.month}/{now.year}"

def remove_accents(s):
    s = re.sub(r'[àáạảãâầấậẩẫăằắặẳẵ]', 'a', s)
    s = re.sub(r'[èéẹẻẽêềếệểễ]', 'e', s)
    s = re.sub(r'[ìíịỉĩ]', 'i', s)
    s = re.sub(r'[òóọỏõôồốộổỗơờớợởỡ]', 'o', s)
    s = re.sub(r'[ùúụủũưừứựửữ]', 'u', s)
    s = re.sub(r'[ỳýỵỷỹ]', 'y', s)
    s = re.sub(r'[đ]', 'd', s)
    return s

def gemini_call(prompt_or_parts, max_retries=3):
    for attempt in range(max_retries):
        try:
            if isinstance(prompt_or_parts, list):
                response = model.generate_content(prompt_or_parts)
            else:
                response = model.generate_content(prompt_or_parts)
            result = response.text.strip().strip('`').strip()
            if result.startswith('json'):
                result = result[4:].strip()
            return result
        except Exception as e:
            delay = min(15 * (2 ** attempt), 120)
            logging.warning(f"Gemini attempt {attempt+1}/{max_retries} failed: {e}. Retry in {delay}s")
            if attempt < max_retries - 1:
                time.sleep(delay)
    return None


class FCManagerBot(ZaloAPI):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._last_event_time = time.time()
        self._watchdog_thread = None
        self._stop_watchdog = threading.Event()

    def _start_watchdog(self):
        self._stop_watchdog.clear()
        self._last_event_time = time.time()
        self._watchdog_thread = threading.Thread(target=self._watchdog_loop, daemon=True)
        self._watchdog_thread.start()

    def _watchdog_loop(self):
        while not self._stop_watchdog.is_set():
            elapsed = time.time() - self._last_event_time
            if elapsed > WATCHDOG_TIMEOUT:
                logging.error(f"WATCHDOG: Không nhận event nào trong {int(elapsed)}s. Force disconnect!")
                try:
                    self._stop_watchdog.set()
                    if hasattr(self, '_ws') and self._ws:
                        self._ws.close()
                except Exception:
                    pass
                os._exit(1)
                return
            self._stop_watchdog.wait(30)

    def onListening(self):
        self._last_event_time = time.time()
        logging.info("Websocket connected")
        self._start_watchdog()

    def onErrorCallBack(self, error, ts=None):
        self._last_event_time = time.time()
        logging.error(f"WS Error: {error}")

    def onEvent(self, event_data, event_type):
        self._last_event_time = time.time()

    def onMessage(self, mid, author_id, message, message_object, thread_id, thread_type):
        self._last_event_time = time.time()

        msg_type = message_object.msgType if message_object and hasattr(message_object, 'msgType') else 'text'
        logging.info(f"===> MSG: thread={thread_id}, author={author_id}, msg_type={msg_type}")

        if str(thread_id) != str(GROUP_ID):
            return

        if datetime.now() > datetime(2026, 12, 31, 23, 59, 59):
            return

        logging.info(f"Group message from {author_id}: {message}")

        is_photo = (msg_type == 'chat.photo')

        text_content = ""
        if isinstance(message, str):
            text_content = message
        elif message_object and hasattr(message_object, 'content') and hasattr(message_object.content, 'text'):
            text_content = message_object.content.text

        text_lower = text_content.lower() if isinstance(text_content, str) and text_content else ""
        text_no_accents = remove_accents(text_lower) if text_lower else ""

        is_text_command = False
        if not is_photo and ("@anh vu" in text_no_accents or "#tran" in text_no_accents or "#chi" in text_no_accents or "ghi nhan giup" in text_no_accents):
            is_text_command = True

        if not is_photo and not is_text_command:
            return

        try:
            if is_photo:
                self._handle_photo(message_object, thread_id, thread_type)
            elif is_text_command:
                self._handle_text_command(author_id, text_content, message_object, thread_id, thread_type)
        except Exception as e:
            logging.error(f"Lỗi xử lý: {e}", exc_info=True)

    def _handle_photo(self, message_object, thread_id, thread_type):
        logging.info("Phát hiện ảnh, đang xử lý thu quỹ...")
        photo_url = message_object.content.href
        img_data = requests.get(photo_url).content
        with open("temp_bill.jpg", "wb") as f:
            f.write(img_data)

        img_file = genai.upload_file("temp_bill.jpg")
        member_list = ", ".join(MEMBERS)
        prompt = f"""Đây là ảnh chụp màn hình chuyển khoản đóng quỹ đội bóng FC Friend.
Danh sách thành viên: [{member_list}]

Hãy đọc ảnh và trả về JSON với 2 trường:
1. "name": tên người chuyển, mapping với tên gần đúng nhất trong danh sách thành viên ở trên
2. "amount": số tiền (số nguyên, không dấu phẩy)

Chỉ trả về chuỗi JSON thuần, không markdown, không giải thích.
Lưu ý: BẮT BUỘC giữ nguyên tên gốc nếu tên đó không có trong danh sách. 
Lưu ý quan trọng: "Đào Văn Tiên" hoặc "Đào Tiên" hoặc "Dao Van Tien" là THỦ QUỸ (người nhận tiền). Tuyệt đối KHÔNG ĐƯỢC lấy người nhận tiền làm người nộp quỹ. Người nộp quỹ thường nằm trong phần 'Lời nhắn', 'Tên người gửi', hoặc 'Tài khoản trích nợ'.
Nếu không phải ảnh bill chuyển khoản, trả về {{"error": "not_a_bill"}}."""

        result = gemini_call([prompt, img_file])
        if not result:
            logging.error("Gemini failed after retries (photo)")
            return

        try:
            data = json.loads(result)
        except json.JSONDecodeError:
            logging.error(f"Photo: Failed to parse Gemini JSON: {result}")
            return

        if "error" in data:
            logging.info(f"Gemini: không phải bill - {data}")
            return

        if "amount" not in data or "name" not in data:
            logging.warning(f"Gemini trả thiếu field: {data}")
            return

        logging.info(f"Bóc tách OK: {data['name']} - {data['amount']} VND")

        period = get_current_period()
        payload = {
            "period": period,
            "member": data['name'],
            "amount": data['amount'],
            "note": "Zalo Bot auto"
        }

        res = requests.put(API_FUNDS_URL, json=payload, timeout=15)
        logging.info(f"API response: {res.status_code} - {res.text}")

        if res.status_code == 200:
            reply_text = f"✅ Đã ghi nhận {data['name']} nộp {data['amount']:,} VNĐ ({period})"
            self.sendMessage(Message(text=reply_text), thread_id, thread_type)
            logging.info(f"Đã reply group: {reply_text}")
        else:
            logging.error(f"API lỗi: {res.status_code} - {res.text}")

    def _handle_text_command(self, author_id, text_content, message_object, thread_id, thread_type):
        logging.info("Phát hiện text lệnh điều hành từ đội trưởng...")

        if CAPTAIN_ID and str(author_id) != str(CAPTAIN_ID):
            self.sendMessage(Message(text=f"❌ Chỉ Đội trưởng mới có quyền dùng lệnh này!"), thread_id, thread_type)
            return
        elif not CAPTAIN_ID:
            logging.warning("ZALO_CAPTAIN_ID chưa được cấu hình trong .env")
            return

        member_list = ", ".join(MEMBERS)
        prompt = f"""Đây là tin nhắn của đội trưởng FC Friend trong nhóm Zalo.
Tin nhắn: "{text_content}"
Danh sách thành viên: [{member_list}]

NHIỆM VỤ: Phân tích xem tin nhắn này có phải là LỆNH CHÍNH THỨC không.
Chỉ có 3 loại lệnh hợp lệ:
1. BÁO CÁO TRẬN ĐẤU: "@[Tên đối thủ] thắng/thua/hòa [Số tiền]" hoặc "#trận ..."
2. GHI NHẬN ĐÓNG QUỸ: "ghi nhận giúp [Tên] [Số tiền]" hoặc "@[Bot] [Tên] [Số tiền]"
3. CẢ HAI: kết hợp báo trận và ghi quỹ trong 1 tin nhắn

CÁC TRƯỜNG HỢP PHẢI TRẢ type="error":
- Nói chuyện phiếm, bàn luận, hỏi han, nhờ vả thường
- Chỉ đạo chiến thuật, xếp đội hình, phân công vị trí
- Bàn luận về tiền nhưng không phải LỆNH ghi nhận (ví dụ: "chi 200k nhặt bóng đóng quỹ tháng sau" là bàn luận, KHÔNG phải lệnh)
- Bất kỳ tin nhắn nào không rõ ràng yêu cầu GHI NHẬN dữ liệu

Trả về JSON thuần (không tag markdown):
{{
  "type": "match" | "fund" | "both" | "error",
  "match": {{
    "date": "{datetime.now().strftime('%Y-%m-%d')}",
    "opponent": "Tên đối thủ",
    "result": "Thắng" | "Thua" | "Hòa",
    "cost": số nguyên (800000, 0 nếu ko nói),
    "note": "ghi chú"
  }},
  "funds": [
    {{
      "name": "Tên thành viên (mapping: Quân→Viết Quân, Huỳnh→Huỳnh Lê. Tên lạ như Ánh, Kiên → GIỮ NGUYÊN)",
      "amount": số nguyên (200k = 200000)
    }}
  ]
}}

QUY TẮC BẮT BUỘC:
- "@Anh Vũ" là TÊN CỦA BOT, được đội trưởng tag để gọi lệnh. TUYỆT ĐỐI KHÔNG ĐƯỢC lấy "Anh Vũ" làm tên đối thủ trong trận đấu. Nếu tin nhắn là "@Anh Vũ thắng 300k", tên đối thủ phải là để trống hoặc "Không rõ", kết quả là Thắng, cost là 300000.
- Lệnh có dạng "@[Tên] thắng/thua/hòa" (Tên khác Anh Vũ) → type="match", đối thủ=[Tên], KHÔNG đưa vào funds.
- Giữ nguyên tên gốc nếu không có trong danh sách
- Khi nghi ngờ → trả type="error" (an toàn hơn ghi sai)"""

        result = gemini_call(prompt)
        if not result:
            logging.error("Gemini text failed after retries")
            return

        try:
            data = json.loads(result)
        except json.JSONDecodeError:
            logging.error(f"Failed to parse JSON: {result}")
            return

        if data.get("type") == "error":
            logging.info(f"Gemini: không phải lệnh trận đấu/quỹ - {data}")
            return

        logging.info(f"Bóc tách Text OK: {data}")

        if data.get("type") in ["match", "both"] and "match" in data:
            match_data = data["match"]
            payload = {
                "date": match_data.get("date", datetime.now().strftime('%Y-%m-%d')),
                "opponent": match_data.get("opponent", "Đối"),
                "venue": "",
                "result": match_data.get("result", "Hòa"),
                "cost": match_data.get("cost", 0),
                "note": match_data.get("note", "Zalo Bot auto")
            }
            res = requests.post(API_MATCHES_URL, json=payload, timeout=15)
            if res.status_code == 200:
                reply_text = f"✅ Đã ghi nhận trận đấu với {payload['opponent']}: {payload['result']} (Chi: {payload['cost']:,}đ)"
                self.sendMessage(Message(text=reply_text), thread_id, thread_type)
                logging.info(f"Đã reply group: {reply_text}")
            else:
                logging.error(f"API Match lỗi: {res.status_code} - {res.text}")

        if data.get("type") in ["fund", "both"] and "funds" in data and len(data["funds"]) > 0:
            period = get_current_period()
            success_funds = []
            for fund in data["funds"]:
                payload = {
                    "period": period,
                    "member": fund['name'],
                    "amount": fund['amount'],
                    "note": "Zalo Bot auto (đội trưởng báo)"
                }
                res = requests.put(API_FUNDS_URL, json=payload, timeout=15)
                if res.status_code == 200:
                    success_funds.append(f"{fund['name']} ({fund['amount']:,}đ)")
                else:
                    logging.error(f"Lỗi API Funds cho {fund['name']}: {res.text}")

            if success_funds:
                reply_text = f"✅ Đã ghi nhận đóng quỹ:\n- " + "\n- ".join(success_funds) + f"\n({period})"
                self.sendMessage(Message(text=reply_text), thread_id, thread_type)
                logging.info(f"Đã reply group funds: {reply_text}")


cookie_dict = {}
if COOKIE:
    for item in COOKIE.split(";"):
        item = item.strip()
        if "=" in item:
            k, v = item.split("=", 1)
            cookie_dict[k] = v

if __name__ == "__main__":
    acquire_lock()
    atexit.register(release_lock)

    reconnect_delay = 10

    while True:
        if datetime.now() > datetime(2026, 12, 31, 23, 59, 59):
            logging.info("Bot hết hạn (31/12/2026). Dừng.")
            break
        try:
            logging.info(f"Khởi động Zalo Bot... (PID: {os.getpid()})")
            client = FCManagerBot(imei=IMEI, cookies=cookie_dict)
            logging.info("Kết nối Zalo thành công. Đang lắng nghe...")
            reconnect_delay = 10
            client.listen(reconnect=5)
        except KeyboardInterrupt:
            logging.info("Bot dừng bởi người dùng.")
            break
        except Exception as e:
            logging.error(f"Bot crash: {e}", exc_info=True)

        logging.info(f"Tự động khởi động lại sau {reconnect_delay}s...")
        time.sleep(reconnect_delay)
        reconnect_delay = min(reconnect_delay * 2, MAX_RECONNECT_DELAY)
