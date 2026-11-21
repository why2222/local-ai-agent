import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdownBlocks, parseInline, isSafeLink } from '../public/markdown.mjs';

test('标题与分隔线', () => {
  const blocks = parseMarkdownBlocks('#### 三、补充说明\n\n内容\n\n---\n\n### 总结');
  assert.deepEqual(blocks[0], { type: 'heading', level: 4, text: '三、补充说明' });
  assert.equal(blocks[2].type, 'hr');
  assert.deepEqual(blocks[3], { type: 'heading', level: 3, text: '总结' });
});

test('表格：表头与多行数据', () => {
  const text = '| 操作步骤 | 说明 |\n| --- | --- |\n| 1. 启动 | 创建项目 |\n| 2. 连接 | 授权对接 |';
  const blocks = parseMarkdownBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'table');
  assert.deepEqual(blocks[0].header, ['操作步骤', '说明']);
  assert.equal(blocks[0].rows.length, 2);
  assert.deepEqual(blocks[0].rows[0], ['1. 启动', '创建项目']);
});

test('引用块合并连续行', () => {
  const blocks = parseMarkdownBlocks('> 适用对象：小白\n> 第二行\n\n普通段落');
  assert.equal(blocks[0].type, 'quote');
  assert.match(blocks[0].text, /适用对象/);
  assert.match(blocks[0].text, /第二行/);
  assert.equal(blocks[1].type, 'paragraph');
});

test('代码块与列表保持既有行为', () => {
  const blocks = parseMarkdownBlocks('```js\nconst a = 1;\n```\n\n- 项目一\n- 项目二\n\n1. 第一步\n2. 第二步');
  assert.deepEqual(blocks[0], { type: 'code', text: 'const a = 1;' });
  assert.deepEqual(blocks[1], { type: 'list', ordered: false, items: ['项目一', '项目二'] });
  assert.deepEqual(blocks[2], { type: 'list', ordered: true, items: ['第一步', '第二步'] });
});

test('行内：粗体、代码、链接', () => {
  const tokens = parseInline('这是 **加粗** 和 `代码` 以及 [飞书文档](https://example.com/wiki)');
  assert.deepEqual(tokens[1], { type: 'bold', text: '加粗' });
  assert.deepEqual(tokens[3], { type: 'code', text: '代码' });
  assert.deepEqual(tokens[5], { type: 'link', text: '飞书文档', href: 'https://example.com/wiki' });
});

test('链接安全：拒绝 javascript 协议，允许 https 和站内路径', () => {
  assert.equal(isSafeLink('https://example.com'), true);
  assert.equal(isSafeLink('/api/chats/1'), true);
  assert.equal(isSafeLink('javascript:alert(1)'), false);
  assert.equal(isSafeLink('data:text/html,x'), false);
});
