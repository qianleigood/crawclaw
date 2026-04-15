#!/usr/bin/env python3
"""
TransNetV2 专业视频分镜分析工作流
1. TikHub 获取下载链接
2. 下载到本地
3. TransNetV2 分镜切割
4. 本地逐片段视频理解分析
5. 输出专业分镜脚本 Word
"""

import os
import sys
import json
import subprocess
import argparse
from pathlib import Path

# 添加路径
SCRIPT_DIR = Path(__file__).parent
SKILLS_BASE = SCRIPT_DIR.parent.parent

sys.path.insert(0, str(SKILLS_BASE / 'tikhub' / 'scripts'))
sys.path.insert(0, str(SKILLS_BASE / 'word-processor' / 'scripts'))


def detect_platform(video_url):
    """检测视频链接平台"""
    if 'douyin.com' in video_url or 'v.douyin' in video_url:
        return 'douyin'
    elif 'xiaohongshu.com' in video_url or 'xhslink.com' in video_url:
        return 'xiaohongshu'
    elif 'tiktok.com' in video_url:
        return 'tiktok'
    else:
        return 'unknown'


def step1_tikhub_download(video_url, output_dir):
    """步骤 1：TikHub 获取下载链接并下载（支持抖音/小红书/TikTok）"""
    print('\n' + '=' * 60)
    print('📥 步骤 1：TikHub 获取下载链接并下载')
    print('=' * 60 + '\n')
    
    try:
        # 检测平台
        platform = detect_platform(video_url)
        print(f'🔗 视频链接：{video_url}')
        print(f'📱 检测到平台：{platform}')
        
        if platform == 'unknown':
            print('❌ 不支持的平台，仅支持抖音、小红书、TikTok')
            return None
        
        # 根据平台选择对应函数
        from tikhub_tool import (
            douyin_fetch_video_by_url,
            xhs_get_note_info_by_url,
            tiktok_fetch_post_by_url
        )
        
        if platform == 'douyin':
            fetch_func = douyin_fetch_video_by_url
        elif platform == 'xiaohongshu':
            fetch_func = xhs_get_note_info_by_url
        elif platform == 'tiktok':
            fetch_func = tiktok_fetch_post_by_url
        
        # 获取视频信息
        result = fetch_func(video_url)
        
        if 'data' not in result:
            print(f'❌ TikHub 获取失败：{result}')
            return None
        
        # 提取视频信息（不同平台数据结构略有不同）
        if platform == 'douyin':
            aweme = result['data'].get('aweme_detail', {})
            video_info = {
                'title': aweme.get('desc', 'unknown')[:50],
                'author': aweme.get('author', {}).get('nickname', 'unknown'),
                'duration': aweme.get('duration', 0) / 1000,
                'aweme_id': aweme.get('aweme_id', 'unknown'),
                'platform': 'douyin'
            }
            video_url_list = aweme.get('video', {}).get('play_addr', {}).get('url_list', [])
        elif platform == 'xiaohongshu':
            note_data = result['data'].get('data', [{}])[0] if result['data'].get('data') else {}
            video_info = {
                'title': note_data.get('title', 'unknown')[:50],
                'author': note_data.get('user', {}).get('nickname', 'unknown'),
                'duration': 0,  # 小红书可能没有时长信息
                'note_id': note_data.get('note_id', 'unknown'),
                'platform': 'xiaohongshu'
            }
            video_url_list = [note_data.get('video', {}).get('url', '')]
        elif platform == 'tiktok':
            video_data = result.get('data', {})
            video_info = {
                'title': video_data.get('title', 'unknown')[:50],
                'author': video_data.get('author', {}).get('nickname', 'unknown'),
                'duration': 0,
                'video_id': video_data.get('aweme_id', 'unknown'),
                'platform': 'tiktok'
            }
            video_url_list = video_data.get('video', {}).get('play_addr', {}).get('url_list', [])
        
        if not video_url_list or not video_url_list[0]:
            print('❌ 未找到视频下载地址')
            return None
        
        download_url = video_url_list[0]
        print(f'✅ 获取到下载链接')
        print(f'   标题：{video_info["title"]}')
        print(f'   作者：{video_info["author"]}')
        if video_info.get('duration'):
            print(f'   时长：{video_info["duration"]:.1f}秒')
        
        # 下载到本地
        import requests
        file_id = video_info.get('aweme_id') or video_info.get('note_id') or video_info.get('video_id', 'unknown')
        local_path = output_dir / f"{file_id}_{platform}_original.mp4"
        
        print(f'\n⏳ 正在下载视频...')
        headers = {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
            'Referer': f'https://www.{platform}.com/' if platform != 'xiaohongshu' else 'https://www.xiaohongshu.com/'
        }
        
        response = requests.get(download_url, headers=headers, timeout=300, stream=True)
        if response.status_code == 200:
            with open(local_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            file_size = os.path.getsize(local_path) / 1024 / 1024
            print(f'✅ 下载完成：{local_path.name} ({file_size:.2f} MB)')
            
            video_info['local_path'] = str(local_path)
            return video_info
        else:
            print(f'❌ 下载失败：{response.status_code}')
            return None
            
    except Exception as e:
        print(f'❌ 错误：{e}')
        import traceback
        traceback.print_exc()
        return None


def step2_preprocess(video_path, output_dir):
    """步骤 2：视频预处理（480x270 + 30fps）"""
    print('\n' + '=' * 60)
    print('🎬 步骤 2：视频预处理（480x270 + 30fps）')
    print('=' * 60 + '\n')
    
    from preprocess_video import preprocess_video
    
    output_path = output_dir / f"{Path(video_path).stem}_480x270_30fps.mp4"
    
    success = preprocess_video(
        video_path,
        str(output_path),
        resolution=None,  # 自动检测
        fps=30,
        crf=18,
        auto_detect=True
    )
    
    if success:
        print(f'✅ 预处理完成：{output_path.name}')
        return str(output_path)
    else:
        print('❌ 预处理失败')
        return None


def step3_detect_scenes(video_path, output_dir, method='transnetv2'):
    """步骤 3：分镜检测（支持 TransNetV2 和 OpenCV 两种方案）"""
    print('\n' + '=' * 60)
    if method == 'opencv':
        print('🎯 步骤 3：OpenCV PySceneDetect 镜头检测')
    else:
        print('🎯 步骤 3：TransNetV2 镜头检测')
    print('=' * 60 + '\n')
    
    scenes_file = output_dir / f"{Path(video_path).stem}_scenes.json"
    
    if method == 'opencv':
        # 使用 OpenCV PySceneDetect
        # 加载配置
        config_path = SCRIPT_DIR.parent / 'config.json'
        if config_path.exists():
            with open(config_path, 'r') as f:
                config = json.load(f)
            opencv_config = config.get('opencv', {})
            threshold = opencv_config.get('threshold', 27.0)
            min_len = opencv_config.get('min_scene_len', 15)
            detect_method = opencv_config.get('method', 'content')
            fade_threshold = opencv_config.get('fade_threshold', 0.8)
        else:
            threshold, min_len, detect_method, fade_threshold = 27.0, 15, 'content', 0.8
        
        cmd = [
            sys.executable,
            str(SCRIPT_DIR / 'run_opencv_scenedetect.py'),
            video_path,
            '-o', str(scenes_file),
            '--threshold', str(threshold),
            '--fade-threshold', str(fade_threshold),
            '--min-len', str(min_len),
            '--method', detect_method
        ]
    else:
        # 使用 TransNetV2
        weights_path = SCRIPT_DIR.parent / 'assets' / 'weights' / 'transnetv2-pytorch-weights.pth'
        if not weights_path.exists():
            print(f'❌ 未找到模型权重：{weights_path}')
            return None
        
        # 加载配置
        config_path = SCRIPT_DIR.parent / 'config.json'
        if config_path.exists():
            with open(config_path, 'r') as f:
                config = json.load(f)
            transnetv2_config = config.get('transnetv2', {})
            threshold = transnetv2_config.get('threshold', 0.3)
        else:
            threshold = 0.3
        
        cmd = [
            sys.executable,
            str(SCRIPT_DIR / 'run_transnetv2.py'),
            video_path,
            '-o', str(scenes_file),
            '--weights', str(weights_path),
            '--threshold', str(threshold)
        ]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if result.returncode == 0 and scenes_file.exists():
        with open(scenes_file, 'r') as f:
            data = json.load(f)
        print(f'✅ 检测到 {data["scene_count"]} 个镜头')
        print(f'📄 分镜文件：{scenes_file.name}')
        return str(scenes_file)
    else:
        print(f'❌ 镜头检测失败：{result.stderr}')
        return None


def step4_cut_videos(video_path, scenes_file, output_dir):
    """步骤 4：根据分镜切割视频"""
    print('\n' + '=' * 60)
    print('✂️  步骤 4：根据分镜切割视频')
    print('=' * 60 + '\n')
    
    clips_dir = output_dir / 'clips'
    
    cmd = [
        sys.executable,
        str(SCRIPT_DIR / 'cut_video.py'),
        video_path,
        scenes_file,
        '-o', str(clips_dir)
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if result.returncode == 0:
        # 统计切割的片段
        clip_files = list(clips_dir.glob('scene_*.mp4'))
        print(f'✅ 切割完成：{len(clip_files)} 个片段')
        return str(clips_dir), clip_files
    else:
        print(f'❌ 切割失败：{result.stderr}')
        return None, []


def step5_prepare_local_clips(clip_files):
    """步骤 5：整理本地片段输入"""
    print('\n' + '=' * 60)
    print('📦 步骤 5：整理本地片段输入')
    print('=' * 60 + '\n')

    local_clips = []
    for clip_path in clip_files:
        local_clips.append({
            'clip_name': clip_path.name,
            'clip_path': str(clip_path)
        })

    print(f'✅ 已准备 {len(local_clips)} 个本地片段供后续分析')
    return local_clips


def step6_analyze_clips(local_clips, scenes_file, output_dir):
    """步骤 6：视频理解逐一处理（使用本地片段 + video-understand 技能）"""
    print('\n' + '=' * 60)
    print('🤖 步骤 6：视频理解逐一处理')
    print('=' * 60 + '\n')
    
    # 读取分镜信息（获取时间码）
    with open(scenes_file, 'r', encoding='utf-8') as f:
        scenes_data = json.load(f)
    
    # 导入 video-understand 技能
    video_understand_dir = SKILLS_BASE / 'video-understand'
    sys.path.insert(0, str(video_understand_dir))
    
    try:
        from video_analyzer import analyze_video
        print('✅ 已加载 video-understand 技能\n')
    except ImportError as e:
        print(f'❌ 无法加载 video-understand 技能：{e}')
        print('   将使用备用方案\n')
        analyze_video = None
    
    analysis_results = []
    
    print(f'📊 需要分析 {len(local_clips)} 个片段')
    print('🎬 直接使用本地切割片段做视频理解分析\n')
    
    for i, clip_info in enumerate(local_clips):
        clip_name = clip_info['clip_name']
        clip_path = clip_info['clip_path']
        
        # 获取镜头信息（序号、时间码、时长）
        scene_info = scenes_data['scenes'][i] if i < len(scenes_data['scenes']) else {}
        scene_index = scene_info.get('index', i + 1)
        start_time = scene_info.get('start_time', 0)
        end_time = scene_info.get('end_time', 0)
        duration = scene_info.get('duration', 0)
        
        print(f'   [{i+1}/{len(local_clips)}] 分析 {clip_name} (镜头{scene_index}: {start_time:.2f}s-{end_time:.2f}s)...', end=' ')
        
        try:
            if analyze_video:
                # 构造包含镜头信息的问题（系统提示词已配置，只需传镜头基本信息）
                clip_question = f"""镜头序号：{scene_index}
镜头起止时间码：{start_time:.3f}s - {end_time:.3f}s
镜头时长：{duration:.3f}秒"""
                
                # 使用 video-understand 技能分析本地切片（API 端已配置系统提示词）
                analysis_text = analyze_video(clip_path, clip_question)
                
                # 解析 JSON 结果
                import re
                json_match = re.search(r'\{.*\}', analysis_text, re.DOTALL)
                if json_match:
                    analysis = json.loads(json_match.group())
                else:
                    analysis = json.loads(analysis_text)
                
                print('✅')
            else:
                # 备用方案：模拟数据
                analysis = {
                    '景别': '中景',
                    '运镜方式': '固定镜头',
                    '光影风格': '自然光',
                    '色彩调性': '暖色调',
                    '画面内容描述': f'{clip_name} 的画面内容',
                    '音频设计': '背景音乐 + 环境音',
                    '后期备注': '无'
                }
                print('⚠️  模拟数据')
            
            # 保存分析结果
            result = {
                'clip_name': clip_name,
                'clip_path': clip_path,
                'scene_index': scene_index,
                'start_time': start_time,
                'end_time': end_time,
                'duration': duration,
                'analysis': analysis
            }
            analysis_results.append(result)
            
        except Exception as e:
            print(f'❌ 错误：{e}')
            analysis_results.append({
                'clip_name': clip_name,
                'clip_path': clip_path,
                'scene_index': i + 1,
                'analysis': {'error': str(e)}
            })
    
    # 保存分析结果
    analysis_file = output_dir / 'clip_analysis.json'
    with open(analysis_file, 'w', encoding='utf-8') as f:
        json.dump(analysis_results, f, ensure_ascii=False, indent=2)
    
    print(f'\n✅ 分析完成，结果已保存：{analysis_file.name}')
    
    return analysis_results


def step7_generate_word(analysis_results, video_info, output_dir):
    """步骤 7：生成专业分镜脚本 Word"""
    print('\n' + '=' * 60)
    print('📝 步骤 7：生成专业分镜脚本 Word')
    print('=' * 60 + '\n')
    
    try:
        from word_lib import WordDocument
        
        doc = WordDocument()
        
        # 标题
        doc.add_heading('专业分镜脚本', level=1)
        doc.add_paragraph('')
        doc.add_paragraph(f'视频标题：{video_info["title"]}')
        doc.add_paragraph(f'视频作者：{video_info["author"]}')
        doc.add_paragraph(f'视频时长：{video_info["duration"]:.1f}秒')
        doc.add_paragraph(f'镜头数量：{len(analysis_results)}个')
        doc.add_paragraph('')
        
        # 逐个镜头
        for i, clip in enumerate(analysis_results):
            analysis = clip.get('analysis', {})
            
            # 跳过错误镜头
            if 'error' in analysis:
                continue
            
            doc.add_heading(f'镜头【{clip.get("scene_index", i+1)}】', level=2)
            doc.add_paragraph('')
            
            # 基础信息
            doc.add_heading('【基础信息】', level=3)
            doc.add_paragraph(f'- 镜头序号：{clip.get("scene_index", i+1)}')
            doc.add_paragraph(f'- 起止时间码：{clip.get("start_time", 0):.3f}s - {clip.get("end_time", 0):.3f}s')
            doc.add_paragraph(f'- 镜头时长：{clip.get("duration", 0):.2f}秒')
            doc.add_paragraph(f'- 画面比例：16:9')
            doc.add_paragraph('')
            
            # 画面技术参数
            doc.add_heading('【画面技术参数】', level=3)
            doc.add_paragraph(f'- 景别：{analysis.get("景别", "中景")}')
            doc.add_paragraph(f'- 运镜方式：{analysis.get("运镜方式", "固定镜头")}')
            doc.add_paragraph(f'- 光影风格：{analysis.get("光影风格", "自然光")}')
            doc.add_paragraph(f'- 色彩调性：{analysis.get("色彩调性", "暖色调")}')
            doc.add_paragraph('')
            
            # 画面内容描述
            doc.add_heading('【画面内容描述】', level=3)
            doc.add_paragraph(analysis.get("画面内容描述", "画面内容描述"))
            doc.add_paragraph('')
            
            # 音频设计
            doc.add_heading('【音频设计】', level=3)
            doc.add_paragraph(analysis.get("音频设计", "背景音乐 + 环境音"))
            doc.add_paragraph('')
            
            # 后期备注
            doc.add_heading('【后期备注】', level=3)
            doc.add_paragraph(analysis.get("后期备注", "无"))
            doc.add_paragraph('')
            
            doc.add_paragraph('-' * 60)
            doc.add_paragraph('')
        
        # 保存
        output_path = output_dir / f'{video_info["aweme_id"]}_分镜脚本.docx'
        doc.save(str(output_path))
        
        print(f'✅ 分镜脚本已生成：{output_path.name}')
        print(f'📁 输出目录：{output_dir}')
        
        return str(output_path)
        
    except Exception as e:
        print(f'❌ Word 生成失败：{e}')
        return None


def process_feishu_file(file_path, trigger_text):
    """处理飞书发送的 MP4 文件"""
    print('\n' + '=' * 60)
    print('📨 飞书 MP4 文件触发')
    print('=' * 60 + '\n')
    
    # 检查是否包含触发词
    if '分镜拆分' not in trigger_text:
        print('⚠️  未检测到"分镜拆分"触发词，跳过处理')
        return None
    
    # 检查文件是否为 MP4
    if not file_path.lower().endswith('.mp4'):
        print(f'⚠️  文件不是 MP4 格式：{file_path}')
        return None
    
    if not os.path.exists(file_path):
        print(f'❌ 文件不存在：{file_path}')
        return None
    
    # 创建视频信息
    file_size = os.path.getsize(file_path) / 1024 / 1024
    video_info = {
        'title': os.path.basename(file_path),
        'author': '飞书用户',
        'duration': 0,  # 需要后续获取
        'aweme_id': Path(file_path).stem,
        'platform': 'feishu',
        'local_path': file_path
    }
    
    print(f'✅ 检测到飞书 MP4 文件')
    print(f'   文件：{os.path.basename(file_path)}')
    print(f'   大小：{file_size:.2f} MB')
    print(f'   触发词：分镜拆分')
    
    return video_info


def main():
    parser = argparse.ArgumentParser(
        description='TransNetV2 专业视频分镜分析工作流（支持抖音/小红书/TikTok/飞书 MP4）',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 抖音视频
  python3 video_analysis_workflow.py "https://v.douyin.com/xxx"
  
  # 小红书笔记
  python3 video_analysis_workflow.py "https://www.xiaohongshu.com/explore/xxx"
  
  # TikTok 视频
  python3 video_analysis_workflow.py "https://www.tiktok.com/@user/video/xxx"
  
  # 飞书 MP4 文件（需要包含"分镜拆分"触发词）
  python3 video_analysis_workflow.py --feishu-file "/path/to/video.mp4" --feishu-text "分镜拆分"
  
  # 指定输出目录
  python3 video_analysis_workflow.py "https://v.douyin.com/xxx" -o ./output
  
  # 跳过视频理解分析
  python3 video_analysis_workflow.py "https://v.douyin.com/xxx" --skip-analyze
        """
    )
    
    parser.add_argument('video_url', nargs='?', help='视频链接（抖音/小红书/TikTok）')
    parser.add_argument('-o', '--output', default='./transnetv2_output', help='输出目录')
    parser.add_argument('--skip-analyze', action='store_true', help='跳过视频理解分析')
    parser.add_argument('--feishu-file', help='飞书 MP4 文件路径')
    parser.add_argument('--feishu-text', help='飞书消息文本（需要包含"分镜拆分"）')
    
    args = parser.parse_args()
    
    # 创建输出目录
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    print('\n' + '=' * 60)
    print('🎬 TransNetV2 专业视频分镜分析工作流')
    print('=' * 60)
    
    # 步骤 1：处理视频源（支持链接或飞书文件）
    video_info = None
    
    if args.feishu_file:
        # 飞书 MP4 文件
        video_info = process_feishu_file(args.feishu_file, args.feishu_text or '')
        if not video_info:
            print('\n❌ 工作流中断：飞书文件处理失败')
            sys.exit(1)
    elif args.video_url:
        # 视频链接
        print(f'🔗 视频链接：{args.video_url}')
        print(f'📁 输出目录：{output_dir}')
        print('=' * 60)
        
        video_info = step1_tikhub_download(args.video_url, output_dir)
        if not video_info:
            print('\n❌ 工作流中断：下载失败')
            sys.exit(1)
    else:
        print('❌ 请提供视频链接或飞书 MP4 文件')
        print('   示例：python3 video_analysis_workflow.py "https://v.douyin.com/xxx"')
        print('   或：python3 video_analysis_workflow.py --feishu-file "video.mp4" --feishu-text "分镜拆分"')
        sys.exit(1)
    
    # 步骤 2：预处理
    scaled_video = step2_preprocess(video_info['local_path'], output_dir)
    if not scaled_video:
        print('\n❌ 工作流中断：预处理失败')
        sys.exit(1)
    
    # 步骤 3：分镜检测（根据配置选择方案）
    # 加载配置
    config_path = SCRIPT_DIR.parent / 'config.json'
    detect_method = 'transnetv2'  # 默认 TransNetV2
    if config_path.exists():
        with open(config_path, 'r') as f:
            config = json.load(f)
        detect_method = config.get('scene_detection', {}).get('method', 'transnetv2')
    
    print(f'\n🔧 使用分镜检测方案：{detect_method.upper()}')
    
    scenes_file = step3_detect_scenes(scaled_video, output_dir, method=detect_method)
    if not scenes_file:
        print('\n❌ 工作流中断：镜头检测失败')
        sys.exit(1)
    
    # 步骤 4：切割视频
    clips_dir, clip_files = step4_cut_videos(scaled_video, scenes_file, output_dir)
    if not clips_dir:
        print('\n❌ 工作流中断：视频切割失败')
        sys.exit(1)
    
    # 步骤 5：整理本地片段输入
    local_clips = step5_prepare_local_clips(clip_files)
    
    # 步骤 6：视频理解分析
    if not args.skip_analyze and local_clips:
        analysis_results = step6_analyze_clips(local_clips, scenes_file, output_dir)
    else:
        analysis_results = [{'clip_name': c.name, 'clip_path': str(c), 'analysis': {}} for c in clip_files]
        print('\n⚠️  跳过视频理解分析')
    
    # 步骤 7：生成 Word
    word_path = step7_generate_word(analysis_results, video_info, output_dir)
    
    # 完成
    print('\n' + '=' * 60)
    print('✅ TransNetV2 专业视频分镜分析工作流完成！')
    print('=' * 60)
    print(f'\n📁 输出文件:')
    print(f'   原视频：{video_info["local_path"]}')
    print(f'   预处理：{scaled_video}')
    print(f'   分镜 JSON: {scenes_file}')
    print(f'   切割片段：{clips_dir}/')
    if not args.skip_analyze:
        print(f'   分析结果：{output_dir}/clip_analysis.json')
    if word_path:
        print(f'   分镜脚本：{word_path}')
    print()


if __name__ == '__main__':
    main()
