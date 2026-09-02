# 豆包实时语音真机验收阻塞记录

记录日期：2026-09-02

## 当前结论

- 已完成代码层测量修正、播放竞态保护、协议逐轮关联和 WebAudio 连续 PCM 调度候选。
- 默认配置保持 `single_wav + innerweb0 + vad1300`；未经真机验证的 WebAudio 和 800/1000ms VAD 没有启用。
- 离线验证通过：单元测试 50 项、页面测试 60 项。
- 当前没有目标真机采样，因此不能给出“用户说完到首个可听 AI 声音”的 P50/P90，也不能选择最终 VAD。
- 当前没有 10 轮连续播放真机结果，因此不能宣称 WebAudio 或 InnerAudio 队列无句内卡顿、重叠、欠载或声道路由问题。

## 阻塞原因

正式验收必须同时具备以下外部条件，当前代码执行环境无法代替：

1. 指定的同一台目标手机及其真实系统、微信和基础库运行环境。
2. 已登录并可预览该小程序的微信开发者工具/真机账号。
3. 真人按固定语料完成短句、自然停顿和思考停顿。
4. 第二台设备从同一条声学录音中标注用户末个可听音素与 AI 首个可听音素。
5. 稳定可复现的测试网络、音量、距离和房间条件。

`InnerAudioContext.onPlay` 只能证明微信播放器发出播放事件；WebAudio 的计划起播时间只能证明已调度。两者都不能替代扬声器实际出声，因此不能据此伪造正式可听时延。

## 已准备的执行材料

- 真机规程：`docs/realtime-latency-device-protocol.md`
- 采样表：`docs/realtime-latency-sampling-template.csv`
- 应用内持久化样本：小程序 Storage 键 `realtimeLatencySamplesV2`
- 可切换实验参数：`ACTIVE_VAD_WINDOW_MS`、`AUDIO_PLAYBACK_MODE`、`INNER_AUDIO_USE_WEB_AUDIO_IMPLEMENT`
- 每次实验构建会在 `profileTag` 中带出播放器、InnerAudio WebAudio 驱动开关和 VAD 窗口。

## 解除阻塞后的最短路径

1. 保持默认整轮单 WAV，完成 30 个有效基线轮次。
2. 分别验证 InnerAudio 预备方案和 WebAudio 连续队列，每个候选先跑 10 轮能力门。
3. 冻结通过的播放器，对 800/1000/1300ms VAD 各跑 30 轮。
4. 只有满足 P50 ≤ 1.8 秒、P90 ≤ 2.5 秒、误截断 ≤1 且无明显卡顿/重叠/崩溃的候选才可进入最终 30 轮复验。
5. 若播放器候选均失败，保持整轮单 WAV，并以“小程序音频能力阻塞”结束，不输出达标结论。
