import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 隔离测试环境：绝不能让测试读到开发者本机的 data/providers.json
process.env.PROVIDERS_DB_PATH = join(mkdtempSync(join(tmpdir(), 'reading-ai-test-')), 'providers.json');
