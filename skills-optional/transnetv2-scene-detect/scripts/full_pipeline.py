#!/usr/bin/env python3
"""
TransNetV2 完整流程：预处理 + 检测 + 切割 + 画质验证
一键完成所有步骤
"""

import os
import sys
import argparse
import subprocess

# 获取脚本所在目录
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def run_step(step_name, script, args):
    """运行单个步骤"""
    print(f'\n{"=" * 60}')
    print(f'📍 步骤：{step_name}')
    print(f'{"=" * 60}\n')
    
    cmd = [sys.executable, os.path.join(SCRIPT_DIR, script)] + args
    
    try:
        result = subprocess.run(cmd, check=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f'❌ {step_name} 失败！')
        return False


def main():
    parser = argparse.ArgumentParser(
        description='TransNetV2 完整流程：预处理 + 检测 + 切割 + 画质验证',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python3 full_pipeline.py "input_video.mp4"
  python3 full_pipeline.py "input_video.mp4" --skip-verify
  python3 full_pipeline.py "input_video.mp4" --threshold 0.25
        """
    )
    
    parser.add_argument('input', help='输入视频文件路径')
    parser.add_argument('--skip-verify', action='store_true', help='跳过画质验证')
    parser.add_argument('--threshold', type=float, default=0.3, help='镜头检测阈值')
    parser.add_argument('--no-cut', action='store_true', help='跳过视频切割')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.input):
        print(f'❌ 文件不存在：{args.input}')
        sys.exit(1)
    
    print('\n' + '=' * 60)
    print('🎬 TransNetV2 完整流程')
    print('=' * 60)
    print(f'📹 输入：{os.path.basename(args.input)}')
    print(f'🎯 阈值：{args.threshold}')
    print(f'📊 画质验证：{"跳过" if args.skip_verify else "启用"}')
    print(f'✂️  视频切割：{"跳过" if args.no_cut else "启用"}')
    print('=' * 60)
    
    # 步骤 1：视频预处理
    base = os.path.splitext(args.input)[0]
    scaled_video = f"{base}_480x270_30fps.mp4"
    
    success = run_step(
        '视频预处理（480x270 + 30fps CFR）',
        'preprocess_video.py',
        [args.input, '-o', scaled_video]
    )
    
    if not success:
        print('\n❌ 流程中断：预处理失败')
        sys.exit(1)
    
    # 步骤 2：画质验证（可选）
    if not args.skip_verify:
        report_file = f"{base}_quality_report.txt"
        success = run_step(
            '画质验证（SSIM/PSNR）',
            'verify_quality.py',
            [args.input, scaled_video, '-o', report_file]
        )
        
        if not success:
            print('\n⚠️  画质验证未通过，但继续流程...')
    
    # 步骤 3：TransNetV2 镜头检测
    output_root = os.path.join(os.path.dirname(SCRIPT_DIR), 'output')
    os.makedirs(output_root, exist_ok=True)
    scenes_file = os.path.join(output_root, f"{os.path.basename(base)}_scenes.json")
    weights_file = os.path.join(os.path.dirname(SCRIPT_DIR), 'assets', 'weights', 'transnetv2-pytorch-weights.pth')
    
    # 检查权重文件
    if not os.path.exists(weights_file):
        print(f'\n❌ 未找到模型权重：{weights_file}')
        print('   请下载：https://huggingface.co/MiaoshouAI/transnetv2-pytorch-weights/resolve/main/transnetv2-pytorch-weights.pth')
        sys.exit(1)
    
    success = run_step(
        'TransNetV2 镜头检测',
        'run_transnetv2.py',
        [scaled_video, '-o', scenes_file, '--weights', weights_file, '--threshold', str(args.threshold)]
    )
    
    if not success:
        print('\n❌ 流程中断：镜头检测失败')
        sys.exit(1)
    
    # 步骤 4：视频切割（可选）
    if not args.no_cut:
        output_dir = f"{base}_clips"
        # 使用缩放后的视频切割（不是原视频）
        success = run_step(
            '视频切割',
            'cut_video.py',
            [scaled_video, scenes_file, '-o', output_dir]
        )
        
        if not success:
            print('\n⚠️  视频切割部分失败，请检查输出目录')
    
    # 完成
    print('\n' + '=' * 60)
    print('✅ TransNetV2 完整流程完成！')
    print('=' * 60)
    print(f'\n📁 输出文件:')
    print(f'   预处理视频：{scaled_video}')
    print(f'   分镜结果：{scenes_file}')
    if not args.skip_verify:
        print(f'   画质报告：{report_file}')
    if not args.no_cut:
        print(f'   切割片段：{output_dir}/')
    print()


if __name__ == '__main__':
    main()
