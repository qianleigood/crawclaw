#!/usr/bin/env python3
"""
根据 TransNetV2 分镜结果切割视频
"""

import os
import sys
import json
import subprocess
import argparse


def cut_video(video_path, scenes_file, output_dir=None, use_scaled=True):
    """
    根据分镜 JSON 切割视频
    
    Args:
        video_path: 原视频文件路径
        scenes_file: 分镜 JSON 文件路径
        output_dir: 输出目录
        use_scaled: 是否使用缩放后的视频（推荐：True）
    """
    
    # 读取分镜结果
    print('📦 加载 TransNetV2 分镜结果...')
    with open(scenes_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    scenes = data['scenes']
    fps = data['fps']
    
    # 自动检测缩放后的视频
    if use_scaled:
        base = os.path.splitext(video_path)[0]
        # 尝试常见的缩放后文件名
        scaled_candidates = [
            f"{base}_480x270_30fps.mp4",
            f"{base}_270x480_30fps.mp4",
            f"{base}_480x360_30fps.mp4",
            f"{base}_360x480_30fps.mp4",
            f"{base}_480x480_30fps.mp4"
        ]
        
        for candidate in scaled_candidates:
            if os.path.exists(candidate):
                video_path = candidate
                print(f'✅ 找到缩放后的视频：{os.path.basename(candidate)}\n')
                break
        else:
            print(f'⚠️  未找到缩放后的视频，使用原视频：{os.path.basename(video_path)}')
            print(f'   建议先运行预处理：python3 scripts/preprocess_video.py "{video_path}"\n')
    
    print(f'✅ 加载完成，共 {len(scenes)} 个镜头\n')
    
    # 创建输出目录
    if output_dir is None:
        output_dir = os.path.join(os.path.dirname(scenes_file), 'transnetv2_clips')
    
    os.makedirs(output_dir, exist_ok=True)
    
    print('✂️  开始切割视频...')
    print(f'📹 视频：{os.path.basename(video_path)}')
    print(f'📁 输出：{output_dir}\n')
    
    # 检查 ffmpeg
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print('❌ 未找到 ffmpeg，请先安装：brew install ffmpeg')
        sys.exit(1)
    
    # 切割视频
    success_count = 0
    failed_scenes = []
    
    for i, scene in enumerate(scenes):
        scene_num = scene['index']
        start_time = scene['start_time']
        end_time = scene['end_time']
        duration = scene['duration']
        
        # 输出文件名
        output_filename = f'scene_{scene_num:03d}_{start_time:.3f}s.mp4'
        output_path = os.path.join(output_dir, output_filename)
        
        # 构建 ffmpeg 命令
        cmd = [
            'ffmpeg',
            '-i', video_path,
            '-ss', str(start_time),
            '-t', str(duration),
            '-c:v', 'libx264',
            '-c:a', 'aac',
            '-y',
            output_path
        ]
        
        print(f'[{i+1:03d}/{len(scenes)}] 镜头 #{scene_num}: {start_time:.2f}s - {end_time:.2f}s ({duration:.2f}s)', end=' ')
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            
            if result.returncode == 0 and os.path.exists(output_path):
                file_size = os.path.getsize(output_path) / 1024 / 1024
                print(f'✅ {file_size:.2f} MB')
                success_count += 1
            else:
                print(f'❌ 失败')
                failed_scenes.append(scene_num)
        except subprocess.TimeoutExpired:
            print(f'⏱️ 超时')
            failed_scenes.append(scene_num)
        except Exception as e:
            print(f'❌ 错误：{e}')
            failed_scenes.append(scene_num)
    
    # 生成索引文件
    index_path = os.path.join(output_dir, 'scenes_index.txt')
    with open(index_path, 'w', encoding='utf-8') as f:
        f.write('=' * 80 + '\n')
        f.write('TransNetV2 视频分镜切割报告\n')
        f.write('=' * 80 + '\n\n')
        f.write(f'视频：{os.path.basename(video_path)}\n')
        f.write(f'模型：{data.get("model", "TransNetV2")}\n')
        f.write(f'总镜头数：{len(scenes)}\n')
        f.write(f'成功切割：{success_count}\n')
        f.write(f'失败镜头：{failed_scenes if failed_scenes else "无"}\n\n')
        f.write('=' * 80 + '\n')
        f.write('镜头列表:\n')
        f.write('=' * 80 + '\n')
        for scene in scenes:
            f.write(f'{scene["index"]:03d} | {scene["start_time"]:.3f}s - {scene["end_time"]:.3f}s | '
                    f'{scene["duration"]:.3f}s | scene_{scene["index"]:03d}.mp4\n')
    
    print(f'\n{"=" * 60}')
    print(f'✅ 切割完成！')
    print(f'   成功：{success_count}/{len(scenes)}')
    print(f'   失败：{len(failed_scenes)}')
    print(f'   索引文件：{index_path}')
    print(f'{"=" * 60}\n')
    
    return success_count == len(scenes)


def main():
    parser = argparse.ArgumentParser(
        description='根据 TransNetV2 分镜结果切割视频（默认使用缩放后的视频）',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
重要说明:
  脚本会自动查找缩放后的视频（如 video_480x270_30fps.mp4）
  如果找不到，会回退到原视频（但建议先预处理）

示例:
  python3 cut_video.py "video.mp4" "scenes.json"
  # 自动查找 video_480x270_30fps.mp4 并切割
  
  python3 cut_video.py "video_480x270_30fps.mp4" "scenes.json"
  # 直接使用缩放后的视频切割
  
  python3 cut_video.py "video.mp4" "scenes.json" --no-scaled
  # 强制使用原视频切割（不推荐）
        """
    )
    
    parser.add_argument('video', help='视频文件路径（会自动查找缩放后的版本）')
    parser.add_argument('scenes', help='分镜 JSON 文件路径')
    parser.add_argument('-o', '--output', help='输出目录（默认：自动生成）')
    parser.add_argument('--no-scaled', action='store_true', help='不使用缩放后的视频，强制用原视频')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.video):
        print(f'❌ 视频文件不存在：{args.video}')
        sys.exit(1)
    
    if not os.path.exists(args.scenes):
        print(f'❌ 分镜文件不存在：{args.scenes}')
        sys.exit(1)
    
    use_scaled = not args.no_scaled
    success = cut_video(args.video, args.scenes, args.output, use_scaled)
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
