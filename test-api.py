"""
测试火山引擎端到端语音 API 连通性
运行: python3 test-api.py
依赖: pip3 install websocket-client
"""

import struct
import json
import uuid
import sys

try:
    import websocket
except ImportError:
    print("需要安装 websocket-client:")
    print("  pip3 install websocket-client")
    sys.exit(1)

APP_ID = '9606461235'
ACCESS_KEY = 'puU5nJ6DO0bGo7-BAVLNQ3xsfy5Mwsr7'
WS_URL = 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue'

session_id = str(uuid.uuid4())
step = 0
chat_text = ''


def build_frame(msg_type, event_id, sid, payload):
    is_audio = msg_type == 0b0010
    flags = 0b0100
    serialization = 0b0000 if is_audio else 0b0001

    header = bytes([
        (0b0001 << 4) | 0b0001,
        (msg_type << 4) | flags,
        (serialization << 4) | 0b0000,
        0,
    ])

    event_bytes = struct.pack('>I', event_id)

    session_bytes = b''
    if sid:
        sid_encoded = sid.encode('utf-8')
        session_bytes = struct.pack('>I', len(sid_encoded)) + sid_encoded

    if is_audio:
        payload_bytes = payload or b''
    else:
        payload_bytes = json.dumps(payload or {}).encode('utf-8')

    payload_size = struct.pack('>I', len(payload_bytes))
    return header + event_bytes + session_bytes + payload_size + payload_bytes


def parse_frame(data):
    if len(data) < 4:
        return None
    msg_type = (data[1] >> 4) & 0x0F
    flags = data[1] & 0x0F
    offset = 4
    event_id = 0
    sid = ''

    if flags & 0b0100:
        event_id = struct.unpack('>I', data[offset:offset+4])[0]
        offset += 4
        if event_id >= 100:
            sid_len = struct.unpack('>I', data[offset:offset+4])[0]
            offset += 4
            sid = data[offset:offset+sid_len].decode('utf-8')
            offset += sid_len

    if msg_type == 0b1111:
        error_code = struct.unpack('>I', data[offset:offset+4])[0]
        offset += 4
        ps = struct.unpack('>I', data[offset:offset+4])[0]
        offset += 4
        payload = data[offset:offset+ps].decode('utf-8') if ps > 0 else ''
        return {'type': 'error', 'event': event_id, 'error_code': error_code, 'payload': payload}

    if msg_type == 0b1011:
        ps = struct.unpack('>I', data[offset:offset+4])[0]
        offset += 4
        return {'type': 'audio', 'event': event_id, 'audio_size': ps}

    ps = struct.unpack('>I', data[offset:offset+4])[0]
    offset += 4
    payload = data[offset:offset+ps].decode('utf-8') if ps > 0 else '{}'
    try:
        payload = json.loads(payload)
    except:
        pass
    return {'type': 'text', 'event': event_id, 'payload': payload}


def on_open(ws):
    print('✅ WebSocket 已连接')
    ws.send(build_frame(0b0001, 1, None, {}), opcode=websocket.ABNF.OPCODE_BINARY)


def on_message(ws, data):
    global step, chat_text

    if isinstance(data, str):
        data = data.encode('utf-8')

    parsed = parse_frame(data)
    if not parsed:
        return

    event = parsed['event']

    if parsed['type'] == 'error':
        print(f'❌ 错误 (event={event}): code={parsed["error_code"]}, {parsed["payload"]}')
        ws.close()
        return

    # ConnectionStarted (50)
    if event == 50 and step == 0:
        print('✅ 连接建立成功')
        step = 1
        session_payload = {
            'tts': {'speaker': 'saturn_zh_female_tiexinnvyou_tob'},
            'asr': {'extra': {}},
            'dialog': {
                'bot_name': '小林',
                'system_role': '你是小林，一个温柔体贴的女孩。简短回复。',
                'speaking_style': '温柔自然',
                'dialog_id': '',
                'extra': {
                    'model': '2.2.0.0',
                    'strict_audit': False,
                },
            },
        }
        ws.send(build_frame(0b0001, 100, session_id, session_payload), opcode=websocket.ABNF.OPCODE_BINARY)

    # SessionStarted (150)
    elif event == 150 and step == 1:
        dialog_id = parsed.get('payload', {}).get('dialog_id', '')
        print(f'✅ 会话启动成功, dialog_id: {dialog_id}')
        step = 2
        ws.send(build_frame(0b0001, 300, session_id, {'content': '你好呀！'}), opcode=websocket.ABNF.OPCODE_BINARY)
        print('📤 已发送 SayHello: "你好呀！"')
        print('⏳ 等待 AI 回复...')

    # SessionFailed (153)
    elif event == 153:
        print(f'❌ 会话启动失败: {parsed.get("payload", "")}')
        ws.close()

    # TTSSentenceStart (350)
    elif event == 350:
        text = parsed.get('payload', {}).get('text', '')
        if text:
            print(f'🗣️  AI 说: {text}')

    # ChatResponse (550)
    elif event == 550:
        content = parsed.get('payload', {}).get('content', '')
        chat_text += content

    # TTSResponse (352)
    elif event == 352:
        audio_size = parsed.get('audio_size', 0)
        print(f'🔊 收到音频数据: {audio_size} bytes')

    # TTSEnded (359)
    elif event == 359 and step == 2:
        print(f'\n💬 AI 完整回复: {chat_text}')
        print()
        print('✅✅✅ API 全链路测试通过！')
        print('  - WebSocket 连接 ✓')
        print('  - 会话启动 ✓')
        print('  - AI 对话响应 ✓')
        print('  - TTS 音频生成 ✓')

        ws.send(build_frame(0b0001, 102, session_id, {}), opcode=websocket.ABNF.OPCODE_BINARY)
        ws.close()


def on_error(ws, error):
    print(f'❌ WebSocket 错误: {error}')


def on_close(ws, close_status_code, close_msg):
    print('🔌 连接已关闭')


if __name__ == '__main__':
    print('🔌 连接火山引擎语音 API...')
    ws = websocket.WebSocketApp(
        WS_URL,
        header={
            'X-Api-App-ID': APP_ID,
            'X-Api-Access-Key': ACCESS_KEY,
            'X-Api-Resource-Id': 'volc.speech.dialog',
            'X-Api-App-Key': 'PlgvMymc7f3tQnJ6',
            'X-Api-Connect-Id': str(uuid.uuid4()),
        },
        on_open=on_open,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close,
    )
    ws.run_forever()
