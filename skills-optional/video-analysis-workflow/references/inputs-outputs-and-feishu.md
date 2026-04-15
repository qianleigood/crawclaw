# Video Analysis Inputs, Outputs, and Feishu Delivery

Use this reference when you need input coverage, output layout, default analysis prompt behavior, or Feishu auto-send behavior.

## Supported inputs

- local MP4
- Douyin link
- Xiaohongshu link

## Core outputs

- preprocessed video assets
- scene segmentation
- per-scene analysis results
- structured report output
- screenshots embedded into the report
- JSON / CSV style downstream artifacts

## Typical job directory

The workflow writes a job directory containing:
- job metadata
- manifests
- source videos
- scenes
- results
- report output
- logs

## Feishu behavior

When configured, completion can automatically send:
- a text summary
- a `.docx` report

## Use this reference when

- deciding whether this workflow matches the desired deliverable
- explaining where outputs go
- handling report delivery and Feishu options
