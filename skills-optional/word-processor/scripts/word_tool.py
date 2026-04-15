#!/usr/bin/env python3
"""
Word 文档处理命令行工具
"""

import sys
import os
import json
import argparse
from pathlib import Path

# 添加脚本目录到路径
sys.path.insert(0, str(Path(__file__).parent))

from word_lib import (
    WordDocument, 
    create_document, 
    read_document, 
    edit_document,
    fill_template,
    batch_fill_template
)


def cmd_create(args):
    """创建新文档"""
    doc = WordDocument()
    
    if args.title:
        doc.add_heading(args.title, level=1)
    
    if args.content:
        doc.add_paragraph(args.content)
    
    if args.headings:
        headings = args.headings.split(',')
        for heading in headings:
            doc.add_heading(heading.strip(), level=2)
    
    if args.table:
        rows, cols = map(int, args.table.split('x'))
        doc.add_table(rows, cols)
    
    doc.save(args.output)
    print(f"✅ 文档已创建：{args.output}")


def cmd_read(args):
    """读取文档"""
    if not os.path.exists(args.input):
        print(f"❌ 文件不存在：{args.input}")
        sys.exit(1)
    
    doc = WordDocument(args.input)
    
    if args.output == 'text':
        print(doc.get_text())
    elif args.output == 'table':
        tables = doc.get_tables()
        if args.table_index is not None:
            if args.table_index < len(tables):
                for row in tables[args.table_index]:
                    print('\t'.join(row))
            else:
                print(f"❌ 表格索引超出范围")
        else:
            for i, table in enumerate(tables):
                print(f"\n=== 表格 {i+1} ===")
                for row in table:
                    print('\t'.join(row))
    elif args.output == 'metadata':
        meta = doc.get_metadata()
        print(json.dumps(meta, ensure_ascii=False, indent=2))


def cmd_edit(args):
    """编辑文档"""
    if not os.path.exists(args.input):
        print(f"❌ 文件不存在：{args.input}")
        sys.exit(1)
    
    doc = WordDocument(args.input)
    
    if args.replace:
        for pair in args.replace:
            if ':' in pair:
                old, new = pair.split(':', 1)
                count = doc.replace_text(old, new)
                print(f"替换 '{old}' → '{new}': {count} 处")
    
    if args.append:
        doc.append_text(args.append)
        print(f"已添加内容")
    
    if args.add_table:
        rows, cols = map(int, args.add_table.split('x'))
        doc.add_table(rows, cols)
        print(f"已添加 {rows}x{cols} 表格")
    
    output = args.output or args.input
    doc.save(output)
    print(f"✅ 文档已保存：{output}")


def cmd_template(args):
    """模板填充"""
    if not os.path.exists(args.input):
        print(f"❌ 模板不存在：{args.input}")
        sys.exit(1)
    
    if args.data:
        # 单个 JSON 文件
        with open(args.data, 'r', encoding='utf-8') as f:
            data = json.load(f)
        output = args.output or args.input.replace('.docx', '_filled.docx')
        fill_template(args.input, data, output)
        print(f"✅ 模板已填充：{output}")
    
    elif args.data_dir:
        # 批量处理
        output_dir = args.output_dir or './output'
        json_files = [f for f in os.listdir(args.data_dir) if f.endswith('.json')]
        
        data_list = []
        for json_file in json_files:
            with open(os.path.join(args.data_dir, json_file), 'r', encoding='utf-8') as f:
                data = json.load(f)
                data['filename'] = json_file.replace('.json', '.docx')
                data_list.append(data)
        
        output_files = batch_fill_template(args.input, data_list, output_dir)
        print(f"✅ 批量填充完成，生成 {len(output_files)} 个文件")
        for f in output_files[:5]:  # 只显示前 5 个
            print(f"   - {f}")
        if len(output_files) > 5:
            print(f"   ... 还有 {len(output_files) - 5} 个文件")


def cmd_batch(args):
    """批量处理"""
    if not os.path.exists(args.input_dir):
        print(f"❌ 目录不存在：{args.input_dir}")
        sys.exit(1)
    
    os.makedirs(args.output_dir, exist_ok=True)
    
    docx_files = [f for f in os.listdir(args.input_dir) if f.endswith('.docx')]
    
    if args.replace:
        # 批量替换
        for pair in args.replace:
            old, new = pair.split(':', 1)
            for filename in docx_files:
                input_path = os.path.join(args.input_dir, filename)
                output_path = os.path.join(args.output_dir, filename)
                
                doc = WordDocument(input_path)
                doc.replace_text(old, new)
                doc.save(output_path)
        
        print(f"✅ 批量替换完成，处理 {len(docx_files)} 个文件")
    
    elif args.convert_to:
        # 批量转换（需要额外依赖）
        print("⚠️  格式转换功能需要安装 pypandoc")
        print("   运行：pip3 install pypandoc-binary")


def main():
    parser = argparse.ArgumentParser(
        description='Word 文档处理工具',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 创建文档
  python3 word_tool.py create --output test.docx --title "标题" --content "内容"
  
  # 读取文档
  python3 word_tool.py read --input test.docx
  
  # 编辑文档
  python3 word_tool.py edit --input test.docx --replace "旧：新" --output edited.docx
  
  # 模板填充
  python3 word_tool.py template --input template.docx --data data.json --output output.docx
  
  # 批量处理
  python3 word_tool.py batch --input-dir ./docs --replace "旧：新" --output-dir ./output
        """
    )
    
    subparsers = parser.add_subparsers(dest='command', help='命令')
    
    # create 命令
    create_parser = subparsers.add_parser('create', help='创建新文档')
    create_parser.add_argument('--output', '-o', required=True, help='输出文件路径')
    create_parser.add_argument('--title', '-t', help='标题')
    create_parser.add_argument('--content', '-c', help='内容')
    create_parser.add_argument('--headings', help='二级标题（逗号分隔）')
    create_parser.add_argument('--table', help='表格（如 3x3）')
    create_parser.set_defaults(func=cmd_create)
    
    # read 命令
    read_parser = subparsers.add_parser('read', help='读取文档')
    read_parser.add_argument('--input', '-i', required=True, help='输入文件路径')
    read_parser.add_argument('--output', '-o', default='text', 
                            choices=['text', 'table', 'metadata'], help='输出格式')
    read_parser.add_argument('--table-index', type=int, help='表格索引')
    read_parser.set_defaults(func=cmd_read)
    
    # edit 命令
    edit_parser = subparsers.add_parser('edit', help='编辑文档')
    edit_parser.add_argument('--input', '-i', required=True, help='输入文件路径')
    edit_parser.add_argument('--output', '-o', help='输出文件路径（默认覆盖原文件）')
    edit_parser.add_argument('--replace', '-r', action='append', help='替换文本（旧：新）')
    edit_parser.add_argument('--append', '-a', help='追加内容')
    edit_parser.add_argument('--add-table', help='添加表格（如 3x3）')
    edit_parser.set_defaults(func=cmd_edit)
    
    # template 命令
    template_parser = subparsers.add_parser('template', help='模板填充')
    template_parser.add_argument('--input', '-i', required=True, help='模板文件路径')
    template_parser.add_argument('--data', '-d', help='JSON 数据文件')
    template_parser.add_argument('--output', '-o', help='输出文件路径')
    template_parser.add_argument('--data-dir', help='数据目录（批量）')
    template_parser.add_argument('--output-dir', help='输出目录（批量）')
    template_parser.set_defaults(func=cmd_template)
    
    # batch 命令
    batch_parser = subparsers.add_parser('batch', help='批量处理')
    batch_parser.add_argument('--input-dir', required=True, help='输入目录')
    batch_parser.add_argument('--output-dir', required=True, help='输出目录')
    batch_parser.add_argument('--replace', '-r', action='append', help='替换文本（旧：新）')
    batch_parser.add_argument('--convert-to', help='转换格式（pdf/markdown）')
    batch_parser.set_defaults(func=cmd_batch)
    
    args = parser.parse_args()
    
    if args.command is None:
        parser.print_help()
        sys.exit(1)
    
    args.func(args)


if __name__ == '__main__':
    main()
