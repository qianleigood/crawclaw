#!/usr/bin/env python3
"""
OpenCV 增强版分镜检测
使用 PySceneDetect 进行镜头边界检测，支持多种检测算法
- ContentDetector: 基于内容变化检测（硬切）
- ThresholdDetector: 基于像素变化检测（硬切）
- FadeDetector: 检测淡入淡出渐变过渡
"""

import os
import sys
import json
import argparse
from pathlib import Path
from datetime import timedelta
from typing import List, Tuple, Dict

# 检查依赖
try:
    import cv2
    import numpy as np
    from scenedetect import detect, ContentDetector, ThresholdDetector, FadeDetector
    from scenedetect.video_manager import VideoManager
    from scenedetect.scene_manager import SceneManager
    from scenedetect.stats_manager import StatsManager
    from scenedetect.platform import get_cv2_imwrite_params
except ImportError as e:
    print(f"❌ 缺少依赖：{e}")
    print("请安装：pip3 install opencv-python scenedetect")
    sys.exit(1)


def detect_scenes_opencv(video_path: str, threshold: float = 27.0, min_scene_len: int = 15, 
                         detect_fades: bool = False, fade_threshold: float = 0.8):
    """
    使用 PySceneDetect 检测镜头边界（支持硬切 + 渐变检测）
    
    Args:
        video_path: 视频文件路径
        threshold: 场景切换阈值（默认 27.0，越低越敏感）
        min_scene_len: 最小镜头长度（帧数，默认 15 帧）
        detect_fades: 是否检测淡入淡出渐变（默认 False）
        fade_threshold: 渐变检测阈值（0-1，默认 0.8）
    
    Returns:
        镜头列表
    """
    print(f"🔍 使用 OpenCV PySceneDetect 检测镜头...")
    print(f"   硬切阈值：{threshold}, 最小镜头长度：{min_scene_len} 帧")
    if detect_fades:
        print(f"   渐变检测：启用（阈值：{fade_threshold}）")
    
    # 创建 VideoManager
    video_manager = VideoManager([video_path])
    scene_manager = SceneManager()
    stats_manager = StatsManager()
    
    # 添加检测器
    detectors_used = []
    
    # ContentDetector - 硬切检测
    content_detector = ContentDetector(threshold=threshold, min_scene_len=min_scene_len)
    scene_manager.add_detector(content_detector, stats_manager)
    detectors_used.append('ContentDetector')
    
    # FadeDetector - 渐变检测（可选）
    if detect_fades:
        fade_detector = FadeDetector(threshold=fade_threshold, min_scene_len=min_scene_len)
        scene_manager.add_detector(fade_detector, stats_manager)
        detectors_used.append('FadeDetector')
    
    # 获取视频信息
    video_manager.set_downscale_factor()
    video_manager.start()
    
    # 获取帧率和时长
    base_timecode = video_manager.get_base_timecode()
    frame_rate = video_manager.get_framerate()
    duration_frames = video_manager.get_duration_frames()
    duration_seconds = duration_frames / frame_rate
    
    print(f"📊 视频信息：{frame_rate} fps, {duration_seconds:.2f} 秒，共 {duration_frames} 帧")
    print(f"🔧 使用检测器：{', '.join(detectors_used)}")
    
    # 检测场景
    print("⏳ 正在分析视频...")
    scene_list = scene_manager.detect_scenes(video_manager, show_progress=True)
    
    # 提取镜头信息
    scenes = []
    for i, (start, end) in enumerate(scene_list):
        start_frame = start.get_frames()
        end_frame = end.get_frames()
        start_time = start_frame / frame_rate
        end_time = end_frame / frame_rate
        duration = end_time - start_time
        
        scenes.append({
            'index': i + 1,
            'start_frame': start_frame,
            'end_frame': end_frame,
            'start_time': round(start_time, 3),
            'end_time': round(end_time, 3),
            'duration': round(duration, 3)
        })
    
    video_manager.release()
    
    model_name = 'PySceneDetect-OpenCV'
    if detect_fades:
        model_name += ' (ContentDetector + FadeDetector)'
    else:
        model_name += ' (ContentDetector)'
    
    return {
        'model': model_name,
        'video': os.path.basename(video_path),
        'fps': frame_rate,
        'scene_count': len(scenes),
        'threshold': threshold,
        'min_scene_len': min_scene_len,
        'detect_fades': detect_fades,
        'fade_threshold': fade_threshold if detect_fades else None,
        'input_resolution': f'{video_manager.get_frame_size()[0]}x{video_manager.get_frame_size()[1]}',
        'scenes': scenes
    }


def detect_scenes_threshold(video_path: str, threshold: float = 27.0):
    """
    使用 ThresholdDetector（基于像素变化）
    
    Args:
        video_path: 视频文件路径
        threshold: 像素变化阈值（默认 27.0）
    
    Returns:
        镜头列表
    """
    print(f"🔍 使用 OpenCV ThresholdDetector 检测镜头...")
    print(f"   像素变化阈值：{threshold}")
    
    scene_list = detect(video_path, ThresholdDetector(threshold=threshold))
    
    # 获取视频信息
    cap = cv2.VideoCapture(video_path)
    frame_rate = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration_seconds = total_frames / frame_rate
    cap.release()
    
    # 提取镜头信息
    scenes = []
    for i, (start, end) in enumerate(scene_list):
        start_frame = start.get_frames()
        end_frame = end.get_frames()
        start_time = start_frame / frame_rate
        end_time = end_frame / frame_rate
        duration = end_time - start_time
        
        scenes.append({
            'index': i + 1,
            'start_frame': start_frame,
            'end_frame': end_frame,
            'start_time': round(start_time, 3),
            'end_time': round(end_time, 3),
            'duration': round(duration, 3)
        })
    
    return {
        'model': 'PySceneDetect-OpenCV (ThresholdDetector)',
        'video': os.path.basename(video_path),
        'fps': frame_rate,
        'scene_count': len(scenes),
        'threshold': threshold,
        'input_resolution': 'N/A',
        'scenes': scenes
    }


def detect_scenes_combined(video_path: str, hard_threshold: float = 27.0, 
                           fade_threshold: float = 0.8, min_scene_len: int = 15):
    """
    同时检测硬切和渐变过渡
    
    Args:
        video_path: 视频文件路径
        hard_threshold: 硬切检测阈值（默认 27.0）
        fade_threshold: 渐变检测阈值（默认 0.8）
        min_scene_len: 最小镜头长度（帧数，默认 15）
    
    Returns:
        镜头列表（包含过渡类型标记）
    """
    print(f"🔍 使用 OpenCV PySceneDetect 检测硬切 + 渐变...")
    print(f"   硬切阈值：{hard_threshold}, 渐变阈值：{fade_threshold}, 最小镜头长度：{min_scene_len} 帧")
    
    # 创建 VideoManager
    video_manager = VideoManager([video_path])
    scene_manager = SceneManager()
    stats_manager = StatsManager()
    
    # 添加两个检测器
    content_detector = ContentDetector(threshold=hard_threshold, min_scene_len=min_scene_len)
    fade_detector = FadeDetector(threshold=fade_threshold, min_scene_len=min_scene_len)
    scene_manager.add_detector(content_detector, stats_manager)
    scene_manager.add_detector(fade_detector, stats_manager)
    
    # 获取视频信息
    video_manager.set_downscale_factor()
    video_manager.start()
    
    frame_rate = video_manager.get_framerate()
    duration_frames = video_manager.get_duration_frames()
    duration_seconds = duration_frames / frame_rate
    
    print(f"📊 视频信息：{frame_rate} fps, {duration_seconds:.2f} 秒，共 {duration_frames} 帧")
    
    # 检测场景
    print("⏳ 正在分析视频（硬切 + 渐变）...")
    scene_list = scene_manager.detect_scenes(video_manager, show_progress=True)
    
    # 获取渐变位置列表
    fade_scene_list = scene_manager.get_scene_list(detector=fade_detector)
    fade_start_frames = set()
    for start, end in fade_scene_list:
        fade_start_frames.add(start.get_frames())
    
    # 提取镜头信息（包含过渡类型）
    scenes = []
    for i, (start, end) in enumerate(scene_list):
        start_frame = start.get_frames()
        end_frame = end.get_frames()
        start_time = start_frame / frame_rate
        end_time = end_frame / frame_rate
        duration = end_time - start_time
        
        # 判断过渡类型
        transition_type = 'fade' if start_frame in fade_start_frames else 'hard_cut'
        
        scenes.append({
            'index': i + 1,
            'start_frame': start_frame,
            'end_frame': end_frame,
            'start_time': round(start_time, 3),
            'end_time': round(end_time, 3),
            'duration': round(duration, 3),
            'transition_type': transition_type  # hard_cut 或 fade
        })
    
    video_manager.release()
    
    # 统计
    hard_count = sum(1 for s in scenes if s['transition_type'] == 'hard_cut')
    fade_count = sum(1 for s in scenes if s['transition_type'] == 'fade')
    
    return {
        'model': 'PySceneDetect-OpenCV (ContentDetector + FadeDetector)',
        'video': os.path.basename(video_path),
        'fps': frame_rate,
        'scene_count': len(scenes),
        'hard_cut_count': hard_count,
        'fade_count': fade_count,
        'hard_threshold': hard_threshold,
        'fade_threshold': fade_threshold,
        'min_scene_len': min_scene_len,
        'input_resolution': f'{video_manager.get_frame_size()[0]}x{video_manager.get_frame_size()[1]}',
        'scenes': scenes
    }


def main():
    parser = argparse.ArgumentParser(description='OpenCV 分镜检测（支持硬切 + 渐变）')
    parser.add_argument('video', help='视频文件路径')
    parser.add_argument('--output', '-o', help='输出 JSON 文件路径（默认：scenes_opencv.json）')
    parser.add_argument('--threshold', '-t', type=float, default=27.0, help='硬切检测阈值（默认：27.0）')
    parser.add_argument('--fade-threshold', type=float, default=0.8, help='渐变检测阈值（默认：0.8）')
    parser.add_argument('--min-len', type=int, default=15, help='最小镜头长度（帧数，默认：15）')
    parser.add_argument('--method', choices=['content', 'threshold', 'combined'], default='content', 
                       help='检测方法：content=ContentDetector, threshold=ThresholdDetector, combined=硬切 + 渐变（默认：content）')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.video):
        print(f"❌ 文件不存在：{args.video}")
        sys.exit(1)
    
    # 检测镜头
    if args.method == 'content':
        result = detect_scenes_opencv(args.video, args.threshold, args.min_len)
    elif args.method == 'threshold':
        result = detect_scenes_threshold(args.video, args.threshold)
    elif args.method == 'combined':
        result = detect_scenes_combined(args.video, args.threshold, args.fade_threshold, args.min_len)
    
    # 输出结果
    output_path = args.output or 'scenes_opencv.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    
    print(f"\n✅ 检测完成：{result['scene_count']} 个镜头")
    print(f"📄 结果已保存：{output_path}")
    
    # 打印前 5 个镜头预览
    print("\n📊 前 5 个镜头预览：")
    if 'transition_type' in result['scenes'][0]:
        # combined 模式，显示过渡类型
        print(f"{'序号':<6} {'起始帧':<10} {'结束帧':<10} {'开始时间':<12} {'结束时间':<12} {'时长':<8} {'过渡类型':<10}")
        print("-" * 70)
        for scene in result['scenes'][:5]:
            transition_display = '渐变' if scene['transition_type'] == 'fade' else '硬切'
            print(f"{scene['index']:<6} {scene['start_frame']:<10} {scene['end_frame']:<10} "
                  f"{scene['start_time']:<12.3f} {scene['end_time']:<12.3f} {scene['duration']:<8.3f} {transition_display:<10}")
        
        # 统计信息
        print(f"\n📈 过渡类型统计：")
        print(f"   硬切（Hard Cut）: {result.get('hard_cut_count', 'N/A')} 个")
        print(f"   渐变（Fade）: {result.get('fade_count', 'N/A')} 个")
    else:
        # 普通模式
        print(f"{'序号':<6} {'起始帧':<10} {'结束帧':<10} {'开始时间':<12} {'结束时间':<12} {'时长':<8}")
        print("-" * 60)
        for scene in result['scenes'][:5]:
            print(f"{scene['index']:<6} {scene['start_frame']:<10} {scene['end_frame']:<10} "
                  f"{scene['start_time']:<12.3f} {scene['end_time']:<12.3f} {scene['duration']:<8.3f}")
    
    if len(result['scenes']) > 5:
        print(f"... 还有 {len(result['scenes']) - 5} 个镜头")


if __name__ == '__main__':
    main()
