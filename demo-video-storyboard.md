# 5G新通话 AI吃药提醒 Demo视频分镜脚本

## 概述
- **场景**：AI小护士主动拨打5G视频电话，提醒老人吃药，完成后状态同步到子女App
- **风格**：纯手机屏幕录屏视角，无外部实景
- **AI形象**：年轻女性小护士，浅粉色护士服+白色护士帽，亲切专业
- **总时长**：约25-30秒
- **总帧数**：7帧
- **制作流程**：GPT生成分镜关键帧图片 → Seedance图生视频

---

## 分镜总览

| 镜号 | 画面 | 时长 | 对白/文字 |
|------|------|------|----------|
| 1 | 锁屏来电通知 | 3s | 来电铃声 |
| 2 | 视频通话接通，护士打招呼 | 4s | "王奶奶您好呀~" |
| 3 | 护士提醒吃药，底部浮现药物提示 | 5s | "到时间该吃降压药啦，您今天吃了吗？" |
| 4 | 用户语音回复，护士露出开心表情 | 4s | 语音识别："吃过了" |
| 5 | 护士给生活建议+预告明天提醒 | 5s | "今天天气不错，去晒晒太阳…明天还会提醒您" |
| 6 | 通话结束页面 | 3s | "通话结束 03:21" |
| 7 | App提醒事项自动打勾同步 | 4s | 提示音效 |

---

## GPT 图片生成 Prompt

### 统一角色描述（所有帧复用）

```
Young Chinese nurse in her mid-20s, shoulder-length black hair, wearing 
a light pink nurse uniform with a small white nurse cap, warm gentle 
smile, looking professional yet approachable.
```

---

### 镜1 — 来电通知

```
A smartphone lock screen screenshot, modern Chinese Android phone UI, 
1080x2400 resolution. The wallpaper is a warm gradient of light orange 
and cream. At the top, an incoming video call notification banner shows: 
a round avatar of a young Chinese nurse in her mid-20s with a warm 
smile, wearing a light pink nurse uniform and a small white nurse cap, 
caller name "AI健康助手" in Chinese, subtitle "视频来电" below. Two 
buttons: green "接听" and red "拒绝". The lock screen shows time "08:00" 
and date in Chinese. Clean, realistic UI design, no watermarks.
```

---

### 镜2 — 视频通话接通

```
A smartphone screen showing a full-screen video call interface, 1080x2400 
resolution. The main video area shows a young Chinese nurse in her 
mid-20s, shoulder-length black hair, wearing a light pink nurse uniform 
with a small white nurse cap, warm natural smile, looking directly at 
camera as if greeting an elderly person cheerfully. She is in a bright 
clean medical office with soft warm lighting and a small potted plant in 
the background. Bottom of screen has a video call toolbar: mute button, 
end call red circle button, speaker button. Top shows "AI健康助手" and 
call timer "00:12". Realistic Chinese phone UI.
```

---

### 镜3 — 提醒吃药

```
A smartphone screen showing a video call, 1080x2400 resolution. The 
young Chinese nurse has a caring, slightly concerned expression, leaning 
forward slightly as if reminding someone gently. She wears a light pink 
nurse uniform with a small white nurse cap, shoulder-length black hair. 
At the bottom of the video, a translucent overlay card shows a medicine 
pill icon 💊 and text "降压药 - 每日08:00" in Chinese. The call timer 
shows "00:25". Warm, caring atmosphere. Realistic Chinese phone video 
call UI.
```

---

### 镜4 — 用户语音回复

```
A smartphone screen showing a video call, 1080x2400 resolution. The 
young Chinese nurse is smiling happily with a relieved expression, eyes 
bright. She wears a light pink nurse uniform with a small white nurse 
cap, shoulder-length black hair. At the very bottom of the screen, a 
voice recognition bar is active, showing a sound waveform animation and 
recognized text "吃过了吃过了，刚刚吃的" in a speech bubble. The bar has 
a microphone icon glowing blue. Call timer "00:38". Realistic Chinese 
phone video call UI.
```

---

### 镜5 — 生活建议 + 预告明天

```
A smartphone screen showing a video call, 1080x2400 resolution. The 
young Chinese nurse is speaking with a caring warm expression, one hand 
gently gesturing as if giving friendly advice. She wears a light pink 
nurse uniform with a small white nurse cap, shoulder-length black hair. 
A small stethoscope hangs around her neck. At bottom, a subtitle bar 
shows "今天天气不错，吃完药可以去楼下晒晒太阳散散步哦～明天这个时候我还会提醒您的！" 
in Chinese. Call timer "00:52". Warm caring mood. Realistic Chinese 
phone video call UI.
```

---

### 镜6 — 通话结束

```
A smartphone screen showing the end of a video call, 1080x2400 
resolution. The screen shows a slightly dimmed and faded view of the 
young Chinese nurse waving goodbye with a gentle smile. She wears a 
light pink nurse uniform with a small white nurse cap. Center of screen 
overlays a semi-transparent card showing "通话结束" in large Chinese 
text, call duration "03:21" below it, and a green checkmark icon with 
text "吃药提醒已完成" in Chinese. Clean modern Chinese phone UI design.
```

---

### 镜7 — App提醒事项同步

```
A smartphone screen showing a Chinese health reminder app interface, 
1080x2400 resolution. Clean white background with a top header "今日提醒" 
in Chinese with a small calendar icon. A list of reminder items: the 
first item "降压药 08:00" has a green checkmark ✅ with status "已完成" in 
green text and a small timestamp "08:03确认" below. The second item 
"量血压 09:00" is unchecked with a grey circle, status "待完成" in grey. 
The third item "散步30分钟 16:00" is also unchecked. Bottom tab bar shows 
four tabs: 首页, 提醒, 通话记录, 我的. The "提醒" tab icon is highlighted 
in blue. Modern minimal Chinese app UI design with a warm coral and 
white color scheme.
```

---

## Seedance 2.0 视频生成 Prompt

> **核心原则**（基于Seedance 2.0最佳实践研究）：
> - 用**中文**写prompt（字节模型，中文理解力原生级别）
> - **8维公式**：主体 + 动作 + 场景 + 光影 + 镜头 + 风格 + 画质 + 约束
> - **不写负面提示词**，全部翻转为正向描述
> - **动作要慢**，Seedance擅长缓慢连续运动
> - **约束词必加**：面部稳定、画面不抖等
> - **描述音效**：Seedance 2.0支持原生音频生成，prompt中描述声音即可自动生成
> - **首尾帧模式**：通话部分(镜2-6)用首尾帧，UI页面(镜1、镜7)用单图生视频
> - **建议参数**：9:16竖屏，5-8秒，1080p

---

### 镜1 — 来电通知（单图生视频）

**输入**：镜1关键帧图片 × 1
**参数**：9:16 / 5秒 / 1080p

```
手机锁屏画面，屏幕顶部缓缓滑入一条来电通知横幅，显示AI健康助手的视频来电，
护士头像和来电信息从上方滑入停留。手机轻微震动，屏幕亮度缓缓变亮。

固定镜头，画面稳定无抖动，面部清晰不变形，UI界面锐利清晰，细节丰富，
写实手机界面风格，4K高清。

伴随清脆悦耳的来电铃声，铃声节奏舒缓温和，适合老年人接听。
```

---

### 镜2→3 — 打招呼过渡到提醒吃药（首尾帧模式）

**输入**：镜2图片（首帧）+ 镜3图片（尾帧）
**参数**：9:16 / 8秒 / 1080p

```
手机视频通话界面，一位穿浅粉色护士服、戴白色护士帽的年轻中国女护士，
齐肩黑发，面带温暖微笑。

她先微笑点头打招呼，嘴唇自然张合仿佛在说"王奶奶您好呀"，
然后表情逐渐变得关切认真，身体微微前倾，仿佛在温柔地提醒对方吃药。
画面底部缓缓浮现一条半透明的药物提醒卡片。

近景，固定镜头，柔和的室内暖光从侧面洒入，背景是明亮整洁的护理站。
画面稳定无抖动，面部稳定不变形，五官清晰，人体结构正常，
动作自然流畅不僵硬，4K超高清，电影质感。

伴随温柔的女声说话声，语调亲切如同晚辈关心长辈，背景有轻微的室内环境音。
```

---

### 镜3→4 — 提醒吃药过渡到用户回复（首尾帧模式）

**输入**：镜3图片（首帧）+ 镜4图片（尾帧）
**参数**：9:16 / 8秒 / 1080p

```
手机视频通话界面，穿浅粉色护士服、戴白色护士帽的年轻中国女护士，
齐肩黑发，正在关切地说话提醒吃药。

她从认真关切的表情，逐渐过渡到听到回答后露出开心释然的笑容，
眼睛变得明亮，嘴角上扬。画面底部语音识别条亮起，显示蓝色声波动画。

近景，固定镜头，柔和暖光，面部稳定不变形，五官清晰，
动作自然流畅，画面稳定无抖动，4K超高清，写实风格。

伴随一位老奶奶沙哑慈祥的声音说"吃过了，吃过了，刚刚吃的"，语速偏慢，
语气轻松带笑意。护士听到后轻声回应"嗯嗯，太好了"，语音识别提示音轻响。
```

---

### 镜4→5 — 用户回复过渡到生活建议（首尾帧模式）

**输入**：镜4图片（首帧）+ 镜5图片（尾帧）
**参数**：9:16 / 8秒 / 1080p

```
手机视频通话界面，穿浅粉色护士服、戴白色护士帽的年轻中国女护士，
齐肩黑发，脖子上挂着听诊器。

她从开心的笑容过渡到温和地用右手轻轻比划，仿佛在给出生活建议，
表情关切而温暖，像一个贴心的晚辈在叮嘱长辈。
画面底部字幕条显示她说的话。

近景，固定镜头，侧面暖光，日系清新暖色调，柔光散射，
面部稳定不变形，五官清晰，动作自然流畅不僵硬，
画面稳定无抖动，4K超高清，电影质感。

伴随温柔的女声说"今天天气不错，去楼下晒晒太阳"，语调轻快温暖，
背景有舒缓轻柔的钢琴旋律作为配乐。
```

---

### 镜5→6 — 生活建议过渡到通话结束（首尾帧模式）

**输入**：镜5图片（首帧）+ 镜6图片（尾帧）
**参数**：9:16 / 8秒 / 1080p

```
手机视频通话界面，穿浅粉色护士服、戴白色护士帽的年轻中国女护士，
齐肩黑发。

她从说话建议的姿态，过渡到微笑着缓缓举起右手挥手告别，
表情温暖不舍，像孙女跟奶奶说再见。画面逐渐变暗，
屏幕中央缓缓浮现"通话结束"的半透明卡片和通话时长。

近景到中景缓慢拉远，柔和暖光渐暗，面部稳定不变形，
五官清晰，动作自然流畅，画面稳定无抖动，4K超高清。

伴随温柔的女声说"那您好好休息，我先挂啦"，语调轻柔，
随后传来一声清脆的挂断提示音，画面安静下来。
```

---

### 镜7 — App提醒事项同步（单图生视频）

**输入**：镜7关键帧图片 × 1
**参数**：9:16 / 5秒 / 1080p

```
手机App提醒事项界面，白色背景，列表中第一项"降压药 08:00"的灰色圆圈
缓缓变成绿色对勾，状态文字从"待完成"变为"已完成"并变为绿色，
时间戳"08:03确认"淡入显示。动画流畅自然，有轻微的弹性效果。

固定镜头，画面稳定无抖动，UI界面锐利清晰，细节丰富，
现代简约中国App设计风格，4K高清。

伴随一声清脆悦耳的完成提示音"叮"，然后安静，
营造任务完成的满足感。
```

---

## 制作流程

### 第一步：生成关键帧图片
将上方7个GPT prompt逐一输入ChatGPT/DALL-E，生成7张静态关键帧图片。

### 第二步：一致性检查
确认护士形象（服装、发型、面部）和UI风格在各帧间一致。
不一致的帧用「全能参考」模式上传一致的参考图重新生成。

### 第三步：Seedance生成视频
- 打开即梦平台 `jimeng.jianying.com`，模型选 Seedance 2.0
- **镜1、镜7**：选「首尾帧」入口，只上传1张图 → 单图生视频
- **镜2→3、3→4、4→5、5→6**：选「首尾帧」入口，上传首帧+尾帧
- 参数统一：9:16 / 1080p / 时长按上方建议
- 粘贴对应的中文prompt，点生成
- 每组多生成2-3次，挑最好的

### 第四步：剪辑合成
用剪映将6段视频按顺序拼接：
- 镜1 → 镜2→3 → 镜3→4 → 镜4→5 → 镜5→6 → 镜7
- 镜1→镜2之间加一个「闪白」转场（模拟接听）
- 镜6→镜7之间加一个「渐黑→渐亮」转场（切换到App）
- 其余为Seedance自然过渡，无需额外转场

### 第五步：音频后期（如Seedance原生音频不够理想）
- **护士配音**：可用豆包TTS `zh_female_vv_jupiter_bigtts`（活泼女声）
- **老人回答**：录一段真人语音或TTS生成
- **背景音乐**：舒缓钢琴/温馨轻音乐，音量压低
- **音效**：来电铃声、挂断提示音、打勾完成音
