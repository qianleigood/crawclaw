# -*- coding: utf-8 -*-
import os, json, re, urllib.request
from pathlib import Path
from cdp_publish import XiaohongshuPublisher

APP='U6GSbyL0uaa8AnsioYLcLpAynJf'
TABLE='tblPBxhjRACRM3OD'
WS='/Users/qianleilei/.crawclaw/workspace'
ENV=Path(WS)/'skills/feishu-office-toolkit/server/.env'

for line in ENV.read_text(encoding='utf-8').splitlines():
    if '=' in line and not line.strip().startswith('#'):
        k,v=line.strip().split('=',1)
        os.environ.setdefault(k,v)

def post_json(url, obj, headers=None, method='POST'):
    data = json.dumps(obj).encode('utf-8') if obj is not None else None
    req = urllib.request.Request(url, data=data, headers={'Content-Type':'application/json; charset=utf-8', **(headers or {})}, method=method)
    with urllib.request.urlopen(req, timeout=60) as r:
        body = json.loads(r.read().decode('utf-8'))
    if body.get('code') != 0:
        raise RuntimeError(body)
    return body.get('data', body)

def get_json(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {}, method='GET')
    with urllib.request.urlopen(req, timeout=60) as r:
        body = json.loads(r.read().decode('utf-8'))
    if body.get('code') != 0:
        raise RuntimeError(body)
    return body.get('data', body)

auth = post_json('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {'app_id':os.environ['FEISHU_APP_ID'],'app_secret':os.environ['FEISHU_APP_SECRET']})
headers={'Authorization': 'Bearer ' + auth['tenant_access_token']}
fields=get_json(f'https://open.feishu.cn/open-apis/bitable/v1/apps/{APP}/tables/{TABLE}/fields', headers=headers)['items']
by={f['field_name']:f for f in fields}
if '作品链接' in by and '具体内容' not in by:
    f=by['作品链接']
    post_json(f'https://open.feishu.cn/open-apis/bitable/v1/apps/{APP}/tables/{TABLE}/fields/{f["field_id"]}', {'field_name':'具体内容','type':f['type']}, headers=headers, method='PUT')
    fields=get_json(f'https://open.feishu.cn/open-apis/bitable/v1/apps/{APP}/tables/{TABLE}/fields', headers=headers)['items']
    by={f['field_name']:f for f in fields}
if '内容主题' in by and '话题' not in by:
    f=by['内容主题']
    post_json(f'https://open.feishu.cn/open-apis/bitable/v1/apps/{APP}/tables/{TABLE}/fields/{f["field_id"]}', {'field_name':'话题','type':f['type']}, headers=headers, method='PUT')
records=post_json(f'https://open.feishu.cn/open-apis/bitable/v1/apps/{APP}/tables/{TABLE}/records/search', {'page_size':200}, headers=headers)['items']

publisher = XiaohongshuPublisher(host='127.0.0.1', port=9223, timing_jitter=0.0, account_name='default')
publisher.connect(reuse_existing_tab=True)

def extract_note(link):
    publisher._navigate(link)
    publisher._wait_for_page_ready(timeout_seconds=18.0)
    return publisher._evaluate(r'''
    (() => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const title = norm(document.title || '').replace(/\s*-\s*小红书$/, '');
      const nodes = Array.from(document.querySelectorAll('div, span, p'));
      const texts = nodes.filter(el => el instanceof HTMLElement && el.offsetParent !== null)
        .map(el => norm(el.innerText || el.textContent || ''))
        .filter(Boolean);
      const topics = Array.from(document.querySelectorAll('a, span, div'))
        .filter(el => el instanceof HTMLElement && el.offsetParent !== null)
        .map(el => norm(el.innerText || el.textContent || ''))
        .filter(t => t.startsWith('#'));
      return { title, texts, topics, url: location.href };
    })()
    ''')

def clean_content(payload):
    title = (payload.get('title') or '').strip()
    texts = payload.get('texts') or []
    topics = payload.get('topics') or []
    candidates = [t for t in texts if title and title in t and len(t) > len(title) + 8]
    best = sorted(candidates, key=len)[0] if candidates else (max(texts, key=len) if texts else '')
    content = best
    if title and title in content:
        content = content.split(title, 1)[1].strip()
    content = re.sub(r'^[-—:：\s]+', '', content)
    content = re.split(r'(共\s*\d+\s*条评论|\d+[天小时分钟]+前)', content)[0].strip()
    content = re.sub(r'^(Zenbliss Bedding\s+作者\s*)+', '', content).strip()
    content = re.sub(r'^(创作中心.*?电话：9501-3888)', '', content).strip()
    content = re.sub(r'\s+', ' ', content).strip()
    uniq_topics = []
    seen = set()
    for t in topics:
        if t not in seen:
            uniq_topics.append(t); seen.add(t)
    return content or title, ' '.join(uniq_topics)

updated=0
for rec in records:
    f = rec.get('fields', {})
    link = f.get('具体内容') or f.get('作品链接')
    if isinstance(link, list):
        link=''.join(x.get('text','') for x in link if isinstance(x,dict))
    if not link or not str(link).startswith('http'):
        continue
    payload = extract_note(link)
    content, topics = clean_content(payload)
    post_json(f'https://open.feishu.cn/open-apis/bitable/v1/apps/{APP}/tables/{TABLE}/records/{rec["record_id"]}', {'fields': {'具体内容': content, '话题': topics}}, headers=headers, method='PUT')
    updated += 1

publisher.disconnect()
print(json.dumps({'updated_records': updated}, ensure_ascii=False))
