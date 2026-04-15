#!/usr/bin/env python3
"""
SSIM/PSNR 画质验证
对比原视频和缩放后视频的画质差异
"""

import os
import sys
import subprocess
import argparse


def verify_quality(original_path, scaled_path, output_report=None):
    """
    验证 SSIM/PSNR 画质指标
    
    Args:
        original_path: 原视频文件路径
        scaled_path: 缩放后视频文件路径
        output_report: 输出报告文件路径
    """
    
    print('🔍 画质验证：SSIM/PSNR')
    print(f'📹 原视频：{os.path.basename(original_path)}')
    print(f'📐 缩放后：{os.path.basename(scaled_path)}\n')
    
    # 检查 ffmpeg
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print('❌ 未找到 ffmpeg，请先安装：brew install ffmpeg')
        return False
    
    # 构建 ffmpeg 命令
    # 需要将缩放后的视频放大到原视频分辨率再对比
    cmd = [
        'ffmpeg',
        '-i', scaled_path,
        '-i', original_path,
        '-lavfi',
        '[1:v]scale=iw:ih:flags=lanczos[orig_scaled];[0:v][orig_scaled]ssim;[0:v][orig_scaled]psnr',
        '-f', 'null',
        '-'
    ]
    
    print('⏳ 正在计算 SSIM/PSNR...')
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    # 解析结果
    ssim_line = None
    psnr_line = None
    
    for line in result.stderr.split('\n'):
        if 'SSIM' in line and 'All:' in line:
            ssim_line = line.split('All:')[1].strip().split()[0]
        if 'PSNR' in line and 'average:' in line:
            psnr_line = line.split('average:')[1].strip().split()[0]
    
    # 输出报告
    report_lines = [
        '=' * 80,
        'TransNetV2 画质验证报告（SSIM/PSNR）',
        '=' * 80,
        '',
        f'原视频：{os.path.basename(original_path)}',
        f'缩放后：{os.path.basename(scaled_path)}',
        '',
        '-' * 80,
        '画质指标:',
        '-' * 80,
    ]
    
    if ssim_line:
        report_lines.append(f'SSIM 综合：{ssim_line}')
        ssim_value = float(ssim_line)
        if ssim_value >= 0.98:
            report_lines.append('✅ SSIM ≥ 0.98：视觉无损，AI 识别 0 损失')
        elif ssim_value >= 0.95:
            report_lines.append('⚠️  SSIM ≥ 0.95：接近视觉无损，AI 识别几乎无影响')
        else:
            report_lines.append('❌ SSIM < 0.95：画质损失明显，可能影响 AI 识别')
    else:
        report_lines.append('SSIM: 无法计算')
    
    report_lines.append('')
    
    if psnr_line and psnr_line != 'inf':
        report_lines.append(f'PSNR 综合：{psnr_line} dB')
        psnr_value = float(psnr_line)
        if psnr_value >= 40:
            report_lines.append('✅ PSNR ≥ 40dB：画质优秀')
        elif psnr_value >= 30:
            report_lines.append('⚠️  PSNR ≥ 30dB：画质可接受')
        else:
            report_lines.append('❌ PSNR < 30dB：画质较差')
    else:
        report_lines.append('PSNR: 无法计算（分辨率不同）')
        report_lines.append('ℹ️  注：分辨率不同时 PSNR 无法直接对比，以 SSIM 为准')
    
    report_lines.extend([
        '',
        '-' * 80,
        '结论:',
        '-' * 80,
    ])
    
    if ssim_line:
        ssim_value = float(ssim_line)
        if ssim_value >= 0.98:
            report_lines.append('✅ 画质验证通过：视觉无损，AI 识别 0 损失')
        elif ssim_value >= 0.95:
            report_lines.append('✅ 画质验证基本通过：接近视觉无损，AI 识别几乎无影响')
        else:
            report_lines.append('⚠️  画质验证警告：画质损失明显，建议检查缩放参数')
    else:
        report_lines.append('❌ 无法验证画质')
    
    report_lines.append('=' * 80)
    
    # 输出报告
    report_text = '\n'.join(report_lines)
    print('\n' + report_text)
    
    if output_report:
        os.makedirs(os.path.dirname(output_report) or '.', exist_ok=True)
        with open(output_report, 'w', encoding='utf-8') as f:
            f.write(report_text)
        print(f'\n📄 报告已保存：{output_report}')
    
    # 返回验证是否通过
    if ssim_line:
        return float(ssim_line) >= 0.95
    return False


def main():
    parser = argparse.ArgumentParser(
        description='SSIM/PSNR 画质验证',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python3 verify_quality.py "original.mp4" "scaled.mp4"
  python3 verify_quality.py "original.mp4" "scaled.mp4" -o "report.txt"
        """
    )
    
    parser.add_argument('original', help='原视频文件路径')
    parser.add_argument('scaled', help='缩放后视频文件路径')
    parser.add_argument('-o', '--output', help='输出报告文件路径')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.original):
        print(f'❌ 文件不存在：{args.original}')
        sys.exit(1)
    
    if not os.path.exists(args.scaled):
        print(f'❌ 文件不存在：{args.scaled}')
        sys.exit(1)
    
    success = verify_quality(args.original, args.scaled, args.output)
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
