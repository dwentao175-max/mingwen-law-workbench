import { describe, expect, it } from 'vitest';
import { splitArticles } from './splitter';

describe('splitArticles', () => {
  it('keeps preface out of articles and assigns chapter to following articles', () => {
    const result = splitArticles(`
国家网络安全事件报告管理办法
公开征求意见稿

第一章 总则
第一条 为规范网络安全事件报告工作，制定本办法。
第二条 网络运营者应当按照本办法报告事件。
`);

    expect(result.preface).toContain('公开征求意见稿');
    expect(result.articles).toHaveLength(2);
    expect(result.articles[0]).toMatchObject({
      number: '第一条',
      chapter: '第一章 总则',
      text: '为规范网络安全事件报告工作，制定本办法。'
    });
  });

  it('preserves paragraph breaks inside one article', () => {
    const result = splitArticles(`
第一条 第一款内容。
（一）第一项；
（二）第二项。
第二条 下一条。
`);

    expect(result.articles[0].text).toBe('第一款内容。\n（一）第一项；\n（二）第二项。');
  });
});
