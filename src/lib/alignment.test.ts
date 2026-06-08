import { describe, expect, it } from 'vitest';
import type { Article } from '../types';
import { alignArticles, articleSimilarity } from './alignment';

const article = (number: string, text: string): Article => ({
  id: number,
  number,
  chapter: null,
  text,
  raw: `${number} ${text}`
});

describe('articleSimilarity', () => {
  it('scores highly similar legal text above unrelated text', () => {
    const close = articleSimilarity(
      article('第八条', '网络运营者发现网络安全事件后，应当及时报告。'),
      article('第九条', '网络运营者发现网络安全事件后，应当立即报告。')
    );
    const far = articleSimilarity(
      article('第八条', '网络运营者发现网络安全事件后，应当及时报告。'),
      article('第十条', '本办法自公布之日起施行。')
    );

    expect(close).toBeGreaterThan(0.8);
    expect(far).toBeLessThan(0.4);
  });
});

describe('alignArticles', () => {
  it('aligns renumbered similar articles and separates insertions', () => {
    const left = [
      article('第七条', '网络运营者应当建立报告机制。'),
      article('第八条', '网络运营者发现网络安全事件后，应当及时报告。'),
      article('第九条', '本办法自公布之日起施行。')
    ];
    const right = [
      article('第七条', '网络运营者应当建立报告机制。'),
      article('第八条', '国家网信部门可以要求补充报告。'),
      article('第九条', '网络运营者发现网络安全事件后，应当立即报告。'),
      article('第十条', '本办法自公布之日起施行。')
    ];

    const rows = alignArticles(left, right);

    expect(rows.map((row) => row.type)).toEqual(['matched', 'inserted', 'matched', 'matched']);
    expect(rows[2].left?.number).toBe('第八条');
    expect(rows[2].right?.number).toBe('第九条');
    expect(rows[2].similarity).toBeGreaterThan(0.8);
  });

  it('turns very low similarity pairs into delete plus insert', () => {
    const rows = alignArticles(
      [article('第一条', '网络安全事件报告适用本办法。')],
      [article('第一条', '食品生产经营活动应当遵守本规定。')]
    );

    expect(rows.map((row) => row.type)).toEqual(['deleted', 'inserted']);
  });

  it('rescues moved and renumbered articles after sequence alignment', () => {
    const left = [
      article('第一条', '总则条文一。'),
      article('第二条', '总则条文二。'),
      article('第三条', '总则条文三。'),
      article('第四条', '总则条文四。'),
      article('第五条', '网络运营者应当建立网络安全事件监测预警和报告制度。'),
      article('第六条', '网络运营者应当保存网络日志不少于六个月。'),
      article('第七条', '发生较大网络安全事件时，运营者应当启动应急预案并处置。'),
      article('第八条', '网络运营者发现网络安全事件后，应当在一小时内向网信部门报告。'),
      article('第九条', '网络运营者应当在二十四小时内提交补充报告和处置情况。'),
      article('第十条', '监督检查条文十。'),
      article('第十一条', '监督检查条文十一。'),
      article('第十二条', '法律责任条文十二。'),
      article('第十三条', '附则条文十三。'),
      article('第十四条', '本办法自公布之日起施行。')
    ];
    const right = [
      article('第一条', '总则条文一。'),
      article('第二条', '总则条文二。'),
      article('第三条', '总则条文三。'),
      article('第四条', '总则条文四。'),
      article('第五条', '网络运营者发现网络安全事件后，应当在一小时内向网信部门报告。'),
      article('第六条', '网络运营者应当在二十四小时内提交补充报告和处置情况。'),
      article('第七条', '网络运营者应当建立网络安全事件监测预警和报告制度。'),
      article('第八条', '发生较大网络安全事件时，运营者应当启动应急预案并处置。'),
      article('第九条', '国家网信部门可以要求网络运营者补充报告有关情况。'),
      article('第十条', '监督检查条文十。'),
      article('第十一条', '监督检查条文十一。'),
      article('第十二条', '法律责任条文十二。'),
      article('第十三条', '附则条文十三。'),
      article('第十四条', '本办法自公布之日起施行。')
    ];

    const rows = alignArticles(left, right);
    const pair = (leftNumber: string) => rows.find((row) => row.left?.number === leftNumber);

    expect(pair('第八条')).toMatchObject({ type: 'matched', moved: true });
    expect(pair('第八条')?.right?.number).toBe('第五条');
    expect(pair('第九条')).toMatchObject({ type: 'matched', moved: true });
    expect(pair('第九条')?.right?.number).toBe('第六条');
    expect(pair('第五条')).toMatchObject({ type: 'matched', moved: true });
    expect(pair('第五条')?.right?.number).toBe('第七条');
    expect(pair('第七条')).toMatchObject({ type: 'matched', moved: true });
    expect(pair('第七条')?.right?.number).toBe('第八条');
    expect(rows.find((row) => row.type === 'inserted')?.right?.number).toBe('第九条');
    expect(pair('第一条')?.moved).toBeUndefined();
    expect(pair('第十四条')?.moved).toBeUndefined();
  });
});
