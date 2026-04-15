# Feishu Bitable Attachment API Notes

## 用到的接口

### 1. 获取 tenant access token

```http
POST /auth/v3/tenant_access_token/internal
```

请求体：

```json
{
  "app_id": "cli_xxx",
  "app_secret": "xxx"
}
```

### 2. 小文件直传到 bitable 附件池

```http
POST /drive/v1/medias/upload_all
```

multipart form fields：

- `file_name`
- `parent_type=bitable_file`
- `parent_node=<app_token>`
- `size`
- `file`

成功后拿 `data.file_token`。

### 3. 大文件分片上传

```http
POST /drive/v1/medias/upload_prepare
POST /drive/v1/medias/upload_part
POST /drive/v1/medias/upload_finish
```

`upload_prepare` 需要：

```json
{
  "file_name": "demo.mp4",
  "parent_type": "bitable_file",
  "parent_node": "app_token",
  "size": 31457280
}
```

返回重点字段：

- `upload_id`
- `block_size`
- `block_num`

`upload_part` 走 multipart，字段：

- `upload_id`
- `seq`
- `size`
- `file`

`upload_finish`：

```json
{
  "upload_id": "...",
  "block_num": 8
}
```

### 4. 更新 bitable 记录附件字段

```http
PUT /bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id}
```

请求体示例：

```json
{
  "fields": {
    "附件": [
      {
        "file_token": "boxcn...",
        "name": "demo.png",
        "type": "image/png"
      }
    ]
  }
}
```

## 附件字段对象结构

最常用的是：

```json
{
  "file_token": "token",
  "name": "filename.ext",
  "type": "mime/type"
}
```

其中：

- `file_token` 必填
- `name` 强烈建议带上
- `type` 建议带上，尤其图片/视频/PDF

## 搜索记录

脚本采用：

```http
POST /bitable/v1/apps/{app_token}/tables/{table_id}/records/search
```

请求体里传：

```json
{
  "filter": "CurrentValue.[图文地址] = \"https://example.com\"",
  "page_size": 1
}
```

注意：这是精确匹配思路，适合 URL / 唯一标题 / 外部 id 这类字段。

## 实战约定

- 追加附件前先读记录当前值，再把旧数组 + 新数组一起 PUT 回去。
- 同一条记录附件很多时，分批追加，避免单次更新过重。
- 如果只是普通文本字段，不要绕到这个 skill。
