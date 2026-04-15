#!/usr/bin/env python3
"""
过渡镜头检测器

通过亮度变化分析识别视频中的过渡效果（淡入淡出、闪白等）
"""

import cv2
import numpy as np
from pathlib import Path
from typing import List, Dict, Tuple


class TransitionDetector:
    """过渡镜头检测器"""
    
    def __init__(self, 
                 fade_threshold: float = 5.0,
                 flash_threshold: float = 50.0,
                 min_samples: int = 5):
        """
        初始化检测器
        
        Args:
            fade_threshold: 淡入淡出检测阈值（亮度变化率）
            flash_threshold: 闪白/闪黑检测阈值（亮度突变）
            min_samples: 每个镜头最小采样帧数
        """
        self.fade_threshold = fade_threshold
        self.flash_threshold = flash_threshold
        self.min_samples = min_samples
    
    def analyze_scene(self, video_path: str, start: float, end: float) -> Tuple[bool, float, Dict]:
        """
        分析单个镜头是否为过渡镜头
        
        Args:
            video_path: 视频文件路径
            start: 开始时间（秒）
            end: 结束时间（秒）
            
        Returns:
            (is_transition, score, details)
            - is_transition: 是否为过渡镜头
            - score: 过渡分数（越大越可能是过渡）
            - details: 详细特征
        """
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return False, 0.0, {}
        
        # 计算采样点
        duration = end - start
        num_samples = max(self.min_samples, int(duration * 5))  # 每秒采样5帧
        timestamps = np.linspace(start, end, num_samples)
        
        brightness_values = []
        
        for ts in timestamps:
            cap.set(cv2.CAP_PROP_POS_MSEC, ts * 1000)
            ret, frame = cap.read()
            if not ret:
                continue
            
            # 转换为灰度图并计算平均亮度
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            brightness = np.mean(gray)
            brightness_values.append(brightness)
        
        cap.release()
        
        if len(brightness_values) < 3:
            return False, 0.0, {}
        
        # 分析亮度变化
        brightness_diff = np.diff(brightness_values)
        
        # 检测淡入（亮度上升）
        first_half_diff = brightness_diff[:len(brightness_diff)//2]
        fade_in = np.mean(first_half_diff) > self.fade_threshold
        
        # 检测淡出（亮度下降）
        second_half_diff = brightness_diff[len(brightness_diff)//2:]
        fade_out = np.mean(second_half_diff) < -self.fade_threshold
        
        # 检测闪白/闪黑（亮度突变）
        flash = np.max(np.abs(brightness_diff)) > self.flash_threshold
        
        # 计算过渡分数（亮度变化标准差）
        transition_score = float(np.std(brightness_values))
        
        is_transition = fade_in or fade_out or flash
        
        details = {
            'fade_in': fade_in,
            'fade_out': fade_out,
            'flash': flash,
            'avg_brightness': float(np.mean(brightness_values)),
            'brightness_std': transition_score,
            'brightness_range': float(np.max(brightness_values) - np.min(brightness_values))
        }
        
        return is_transition, transition_score, details
    
    def filter_scenes(self, video_path: str, scenes: List[Dict]) -> Tuple[List[Dict], List[Dict]]:
        """
        过滤过渡镜头
        
        Args:
            video_path: 视频文件路径
            scenes: 原始分镜列表
            
        Returns:
            (content_scenes, transition_scenes)
            - content_scenes: 有效内容镜头
            - transition_scenes: 过渡镜头
        """
        print(f"🔍 分析 {len(scenes)} 个镜头的过渡特征...\n")
        
        content_scenes = []
        transition_scenes = []
        
        for i, scene in enumerate(scenes, 1):
            start = scene.get('start', scene.get('start_time', 0))
            end = scene.get('end', scene.get('end_time', start + 5))
            
            is_transition, score, details = self.analyze_scene(video_path, start, end)
            
            # 添加分析结果到场景信息（确保JSON可序列化）
            scene['is_transition'] = bool(is_transition)
            scene['transition_score'] = float(score)
            scene['transition_details'] = {k: bool(v) if isinstance(v, (bool, np.bool_)) else float(v) for k, v in details.items()}
            
            if is_transition:
                transition_scenes.append(scene)
            else:
                content_scenes.append(scene)
            
            # 每10个镜头打印一次进度
            if i % 10 == 0 or i == len(scenes):
                print(f"   进度: {i}/{len(scenes)} (有效: {len(content_scenes)}, 过渡: {len(transition_scenes)})")
        
        print(f"\n✅ 过滤完成！")
        print(f"   总镜头: {len(scenes)}")
        print(f"   有效镜头: {len(content_scenes)} ({len(content_scenes)/len(scenes)*100:.1f}%)")
        print(f"   过渡镜头: {len(transition_scenes)} ({len(transition_scenes)/len(scenes)*100:.1f}%)")
        
        return content_scenes, transition_scenes


def filter_transition_scenes(video_path: str, scenes: List[Dict], 
                             fade_threshold: float = 5.0,
                             flash_threshold: float = 50.0) -> Tuple[List[Dict], List[Dict]]:
    """
    便捷函数：过滤过渡镜头
    
    Args:
        video_path: 视频文件路径
        scenes: 原始分镜列表
        fade_threshold: 淡入淡出检测阈值
        flash_threshold: 闪白/闪黑检测阈值
        
    Returns:
        (content_scenes, transition_scenes)
    """
    detector = TransitionDetector(
        fade_threshold=fade_threshold,
        flash_threshold=flash_threshold
    )
    return detector.filter_scenes(video_path, scenes)


if __name__ == '__main__':
    import json
    
    # 测试
    video_path = '/Users/leiqian/.crawclaw/skills/video-analysis-workflow/output/new_video/video.mp4'
    scenes_file = '/Users/leiqian/.crawclaw/skills/video-analysis-workflow/output/new_video/video_scenes.json'
    
    with open(scenes_file, 'r') as f:
        data = json.load(f)
    
    scenes = data['scenes']
    
    detector = TransitionDetector()
    content_scenes, transition_scenes = detector.filter_scenes(video_path, scenes)
    
    # 保存结果
    filtered_data = {
        'model': 'TransNetV2 + TransitionDetector',
        'video': data['video'],
        'original_count': len(scenes),
        'filtered_count': len(content_scenes),
        'transition_count': len(transition_scenes),
        'scenes': content_scenes
    }
    
    output_file = '/Users/leiqian/.crawclaw/skills/video-analysis-workflow/output/new_video/filtered_scenes.json'
    with open(output_file, 'w') as f:
        json.dump(filtered_data, f, indent=2)
    
    print(f"\n✅ 结果已保存: {output_file}")
