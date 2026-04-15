# transnetv2-scene-detect

当前推荐主入口：

- `run.sh` → 默认调用 `scripts/run_transnetv2_light.py`
- `scripts/setup.sh` → 初始化 `.venv`

## 推荐用法

```bash
bash scripts/setup.sh
./run.sh /path/to/video.mp4
./run.sh /path/to/video.mp4 --output output/custom_scenes.json
```

未传 `--output` 时，默认会自动保存到 `output/<视频名>_<时间戳>_scenes.json`，并刷新 `output/scenes.json` 作为 latest 快照。

## 当前结构

- 主代码：`scripts/`
- 权重：`assets/weights/transnetv2-pytorch-weights.pth`
- 输出：`output/`
- 历史说明：`archive/docs/README_分镜检测方案.md`

补充：历史扩展脚本 `scripts/video_analysis_workflow.py` 当前也已收口为纯本地链路，不再依赖云上传配置。

## 配置

- `config.json`：检测方法、阈值、预处理参数等
  - `scene_detection.method`：`transnetv2` 或 `opencv`
  - `transnetv2.threshold`：深度学习方案阈值
  - `opencv.*`：OpenCV / PySceneDetect 方案参数
  - `video_preprocessing.*`：预处理分辨率、fps、crf

## 说明

- `scripts/run_transnetv2_light.py` 是当前默认推荐入口
- `output/` 下内容属于运行产物，不是源码
- `archive/` 下内容仅供历史参考，不属于当前主说明
- 技能目录下的 `.venv/` 与 `.git/` 当前视为本地环境 / 仓库元信息，不属于当前主链路
