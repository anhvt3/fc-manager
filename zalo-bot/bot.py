import os
import json
import time
import requests
import logging
from datetime import datetime
from dotenv import load_dotenv
import google.generativeai as genai
from zlapi import ZaloAPI
from zlapi.models import Message

load_dotenv(override=True)

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
    "Thế Anh","Thanh Sơn","Như Ý","Công Dậu"
]

genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel('gemini-2.5-flash')

logging.basicConfig(
    filename='bot.log',
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    encoding='utf-8'
)

def get_current_period():
    now = datetime.now()
    return f"Quỹ T{now.month}/{now.year}"

class FCManagerBot(ZaloAPI):
    def onListening(self):
        logging.info("Websocket connected")

    def onErrorCallBack(self, error, ts=None):
        logging.error(f"WS Error: {error}")

    def onEvent(self, event_data, event_type):
        logging.info(f"--- EVENT: type={event_type}")

    def onMessage(self, mid, author_id, message, message_object, thread_id, thread_type):
        logging.info(f"===> MSG: thread={thread_id}, author={author_id}, msg_type={message_object.msgType if message_object and hasattr(message_object, 'msgType') else 'text'}")

        if str(thread_id) != str(GROUP_ID):
            return

        logging.info(f"Group message from {author_id}: {message}")

        msg_type = message_object.msgType if message_object and hasattr(message_object, 'msgType') else 'text'
        is_photo = (msg_type == 'chat.photo')
        
        text_content = ""
        if isinstance(message, str):
            text_content = message
        elif message_object and hasattr(message_object, 'content') and hasattr(message_object.content, 'text'):
            text_content = message_object.content.text
            
        text_lower = text_content.lower() if text_content else ""
        is_match_command = False
        if not is_photo and ("#tran" in text_lower or "@anh vu" in text_lower or "#chi" in text_lower):
            is_match_command = True

        if not is_photo and not is_match_command:
            return

        try:
            if is_photo:
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
Nếu không phải ảnh bill chuyển khoản, trả về {{"error": "not_a_bill"}}."""

                result = None
                for attempt in range(3):
                    try:
                        response = model.generate_content([prompt, img_file])
                        result = response.text.strip().strip('`').strip()
                        if result.startswith('json'):
                            result = result[4:].strip()
                        break
                    except Exception as gemini_err:
                        logging.warning(f"Gemini attempt {attempt+1} failed: {gemini_err}")
                        if attempt < 2:
                            time.sleep(60)

                if not result:
                    logging.error("Gemini failed after 3 attempts")
                    return

                data = json.loads(result)

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
                    self.replyTo(Message(text=reply_text), message_object, thread_id, thread_type)
                    logging.info(f"Đã reply group: {reply_text}")
                else:
                    logging.error(f"API lỗi: {res.status_code} - {res.text}")

            elif is_match_command:
                logging.info("Phát hiện text lệnh chi quỹ/trận đấu...")
                
                if CAPTAIN_ID and str(author_id) != str(CAPTAIN_ID):
                    self.replyTo(Message(text=f"❌ Cảnh báo: Chỉ Đội trưởng mới có quyền báo cáo trận đấu/chi quỹ!\n(ID của bạn: {author_id})"), message_object, thread_id, thread_type)
                    return
                elif not CAPTAIN_ID:
                    self.replyTo(Message(text=f"⚠️ Bot chưa được cấu hình ZALO_CAPTAIN_ID trong file .env.\nNếu bạn là đội trưởng, hãy thêm:\nZALO_CAPTAIN_ID={author_id}\nvào file .env trên VPS rồi restart bot!"), message_object, thread_id, thread_type)
                    return

                prompt = f"""Đây là tin nhắn của đội trưởng FC Friend báo cáo kết quả trận đấu và chi phí.
Tin nhắn: "{text_content}"

Hãy phân tích và trả về JSON thuần (không chứa tag markdown như ```json) với các trường:
1. "date": ngày trận đấu (định dạng YYYY-MM-DD), nếu không rõ lấy ngày hôm nay là {datetime.now().strftime('%Y-%m-%d')}
2. "opponent": tên đối thủ (mặc định "Đối" nếu không nói rõ)
3. "result": kết quả (chỉ được chọn 1 trong 3: "Thắng", "Thua", "Hòa")
4. "cost": số tiền chi ra (số nguyên, ví dụ 800000. Nếu không có thì để 0)
5. "note": ghi chú thêm (nếu có)
Nếu nội dung hoàn toàn không liên quan đến trận đấu hoặc chi quỹ, trả về {{"error": "not_match"}}."""
                
                result = None
                for attempt in range(3):
                    try:
                        response = model.generate_content(prompt)
                        result = response.text.strip().strip('`').strip()
                        if result.startswith('json'):
                            result = result[4:].strip()
                        break
                    except Exception as gemini_err:
                        logging.warning(f"Gemini text attempt {attempt+1} failed: {gemini_err}")
                        if attempt < 2:
                            time.sleep(5)
                
                if not result:
                    logging.error("Gemini text failed after 3 attempts")
                    return
                
                data = json.loads(result)
                
                if "error" in data:
                    logging.info(f"Gemini: không phải lệnh trận đấu - {data}")
                    return
                    
                logging.info(f"Bóc tách Match OK: {data}")
                
                payload = {
                    "date": data.get("date", datetime.now().strftime('%Y-%m-%d')),
                    "opponent": data.get("opponent", "Đối"),
                    "venue": "",
                    "result": data.get("result", "Hòa"),
                    "cost": data.get("cost", 0),
                    "note": data.get("note", "Zalo Bot auto")
                }
                
                res = requests.post(API_MATCHES_URL, json=payload, timeout=15)
                logging.info(f"API Match response: {res.status_code} - {res.text}")
                
                if res.status_code == 200:
                    reply_text = f"✅ Đã ghi nhận trận đấu với {payload['opponent']}: {payload['result']} (Chi: {payload['cost']:,}đ)"
                    self.replyTo(Message(text=reply_text), message_object, thread_id, thread_type)
                    logging.info(f"Đã reply group: {reply_text}")
                else:
                    logging.error(f"API Match lỗi: {res.status_code} - {res.text}")

        except Exception as e:
            logging.error(f"Lỗi xử lý: {e}", exc_info=True)

cookie_dict = {}
if COOKIE:
    for item in COOKIE.split(";"):
        item = item.strip()
        if "=" in item:
            k, v = item.split("=", 1)
            cookie_dict[k] = v

logging.info("Khởi động Zalo Bot...")
client = FCManagerBot(imei=IMEI, cookies=cookie_dict)
logging.info("Kết nối Zalo thành công. Đang lắng nghe...")
client.listen()
