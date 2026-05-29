-- pgroonga 扩展初始化（CJK 分词支持）
-- 在 PostgreSQL 容器首次启动时自动执行

CREATE EXTENSION IF NOT EXISTS pgroonga;

-- 验证安装
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgroonga') THEN
    RAISE EXCEPTION 'pgroonga 扩展安装失败';
  END IF;
  RAISE NOTICE 'pgroonga 扩展已就绪';
END $$;
