#!/usr/bin/env python3
"""
生成表格格式的专业分镜脚本 Word
循环调用视频理解 API，整合所有镜头分析
"""

import sys
import json
import time
import os
from pathlib import Path

# 添加路径
sys.path.insert(0, '/Users/leiqian/.crawclaw/skills/video-understand')
sys.path.insert(0, '/Users/leiqian/.crawclaw/skills/word-processor/scripts')

from video_analyzer import analyze_video
from word_lib import WordDocument


def parse_analysis_result(result_text):
    """解析视频理解 API 返回的结果"""
    fields = {
        '景别': '',
        '运镜方式': '',
        '光影风格': '',
        '色彩调性': '',
        '画面内容描述': '',
        '音频设计': '',
        '后期备注': ''
    }
    
    lines = result_text.split('\n')
    i = 0
    
    while i < len(lines):
        line = lines[i].strip()
        
        # 检测字段
        for field in fields.keys():
            if line.startswith(f'- {field}:') or line.startswith(f'{field}:'):
                value = line.split(':', 1)[1].strip()
                # 多行值
                i += 1
                while i < len(lines) and not lines[i].strip().startswith('-') and lines[i].strip():
                    value += '\n' + lines[i].strip()
                    i += 1
                fields[field] = value.strip()
                break
        else:
            i += 1
    
    return fields


def generate_word_table(scenes_file, clips_dir, output_path, max_clips=None):
    """
    生成表格格式的专业分镜脚本 Word
    
    Args:
        scenes_file: 分镜 JSON 文件路径
        clips_dir: 切割片段目录
        output_path: 输出 Word 路径
        max_clips: 最大处理镜头数（None=全部）
    """
    
    # 读取分镜 JSON
    with open(scenes_file, 'r', encoding='utf-8') as f:
        scenes_data = json.load(f)
    
    scenes = scenes_data['scenes']
    if max_clips:
        scenes = scenes[:max_clips]
    
    print(f'📊 共 {len(scenes)} 个镜头')
    print(f'🎬 开始分析每个镜头...\n')
    
    # 创建 Word 文档
    doc = WordDocument()
    
    # 标题
    doc.add_heading('专业分镜脚本', level=1)
    doc.add_paragraph('')
    doc.add_paragraph(f'视频：{scenes_data.get("video", "unknown")}')
    doc.add_paragraph(f'镜头数：{len(scenes)}个')
    doc.add_paragraph(f'模型：{scenes_data.get("model", "TransNetV2")}')
    doc.add_paragraph('')
    doc.add_paragraph('=' * 80)
    doc.add_paragraph('')
    
    # 表格数据
    table_data = []
    
    # 循环调用视频理解 API
    for i, scene in enumerate(scenes):
        clip_path = Path(clips_dir) / f'scene_{scene["index"]:03d}_{scene["start_time"]:.3f}s.mp4'
        
        if not clip_path.exists():
            print(f'[{i+1}/{len(scenes)}] 镜头 {scene["index"]}: ❌ 文件不存在')
            continue
        
        print(f'[{i+1}/{len(scenes)}] 分析镜头 {scene["index"]}...', end=' ')
        
        # 重试机制（最多 3 次）
        success = False
        for retry in range(3):
            try:
                # 调用视频理解 API
                result = analyze_video(str(clip_path))
                
                # 添加到表格数据（保存原始结果）
                table_data.append({
                    '镜头序号': scene['index'],
                    '时间码': f'{scene["start_time"]:.2f}s - {scene["end_time"]:.2f}s',
                    '时长': f'{scene["duration"]:.2f}s',
                    'raw_result': result  # 保存原始分析结果
                })
                
                print('✅')
                success = True
                break  # 成功后跳出重试循环
                
            except Exception as e:
                error_msg = str(e)
                if '429' in error_msg or 'Too Many Requests' in error_msg:
                    wait_time = 10 * (retry + 1)  # 指数退避
                    print(f'⚠️  API 限流，等待{wait_time}秒后重试 ({retry+1}/3)...')
                    time.sleep(wait_time)
                else:
                    print(f'❌ {e}')
                    time.sleep(3)
                    break
        
        if not success:
            # 失败后添加占位数据
            table_data.append({
                '镜头序号': scene['index'],
                '时间码': f'{scene["start_time"]:.2f}s - {scene["end_time"]:.2f}s',
                '时长': f'{scene["duration"]:.2f}s',
                '景别': '待分析',
                '运镜方式': '待分析',
                '光影风格': '待分析',
                '色彩调性': '待分析',
                '画面内容描述': 'API 调用失败',
                '音频设计': '待分析',
                '后期备注': '待分析'
            })
        
        # 添加延时避免 API 限流
        if i < len(scenes) - 1:
            time.sleep(5)
    
    # 生成表格格式 Word
    print('\n📝 生成表格格式 Word...')
    
    # 方法 1：使用文本表格（简单可靠）
    doc.add_heading('分镜解析总表', level=2)
    doc.add_paragraph('')
    
    for clip in table_data:
        # 每个镜头一个区块
        doc.add_heading(f'镜头【{clip["镜头序号"]}】', level=3)
        doc.add_paragraph('')
        
        # 时间码和时长
        doc.add_paragraph(f'时间码：{clip["时间码"]} | 时长：{clip["时长"]}')
        doc.add_paragraph('')
        
        # 直接输出原始分析结果
        if 'raw_result' in clip:
            for line in clip['raw_result'].split('\n'):
                doc.add_paragraph(line)
        else:
            doc.add_paragraph('待分析...')
        
        doc.add_paragraph('')
        doc.add_paragraph('-' * 80)
        doc.add_paragraph('')
    
    # 保存 Word
    doc.save(output_path)
    
    file_size = os.path.getsize(output_path) / 1024
    print(f'✅ Word 已生成：{output_path}')
    print(f'   文件大小：{file_size:.1f} KB')
    print(f'   镜头数：{len(table_data)}/{len(scenes)}')
    
    return len(table_data) == len(scenes)


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='生成表格格式的专业分镜脚本 Word')
    parser.add_argument('scenes_file', help='分镜 JSON 文件路径')
    parser.add_argument('clips_dir', help='切割片段目录')
    parser.add_argument('-o', '--output', required=True, help='输出 Word 路径')
    parser.add_argument('--max-clips', type=int, help='最大处理镜头数（测试用）')
    
    args = parser.parse_args()
    
    success = generate_word_table(
        args.scenes_file,
        args.clips_dir,
        args.output,
        args.max_clips
    )
    
    sys.exit(0 if success else 1)
