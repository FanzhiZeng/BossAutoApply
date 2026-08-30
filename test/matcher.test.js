const test = require('node:test');
const assert = require('node:assert/strict');
const { matchJob, parseSalaryRange } = require('../src/shared/matcher.js');

test('matches on keyword hit in title', () => {
  const job = { title: '高级前端工程师', company: 'A公司', salary: '20-30K', tagsText: 'React TypeScript' };
  const { matched } = matchJob(job, { keywords: ['前端'] });
  assert.equal(matched, true);
});

test('rejects when no keyword matches', () => {
  const job = { title: '销售经理', company: 'A公司', salary: '10-15K', tagsText: '' };
  const { matched } = matchJob(job, { keywords: ['前端', 'Java'] });
  assert.equal(matched, false);
});

test('rejects on exclude keyword', () => {
  const job = { title: '前端工程师（外包）', company: 'A公司', salary: '15-20K', tagsText: '' };
  const { matched, reason } = matchJob(job, { keywords: ['前端'], excludeKeywords: ['外包'] });
  assert.equal(matched, false);
  assert.match(reason, /排除关键词/);
});

test('rejects on excluded company', () => {
  const job = { title: '前端工程师', company: '黑名单公司', salary: '15-20K', tagsText: '' };
  const { matched } = matchJob(job, { keywords: ['前端'], excludeCompanies: ['黑名单公司'] });
  assert.equal(matched, false);
});

test('filters by salary overlap', () => {
  const job = { title: '前端工程师', company: 'A公司', salary: '10-14K', tagsText: '' };
  const { matched } = matchJob(job, { keywords: ['前端'], salaryMin: 15, salaryMax: 25 });
  assert.equal(matched, false);
});

test('accepts overlapping salary range', () => {
  const job = { title: '前端工程师', company: 'A公司', salary: '13-18K', tagsText: '' };
  const { matched } = matchJob(job, { keywords: ['前端'], salaryMin: 15, salaryMax: 25 });
  assert.equal(matched, true);
});

test('empty keyword list means no restriction', () => {
  const job = { title: '随便什么岗位', company: 'A公司', salary: '5-8K', tagsText: '' };
  const { matched } = matchJob(job, { keywords: [] });
  assert.equal(matched, true);
});

test('parseSalaryRange handles common formats', () => {
  assert.deepEqual(parseSalaryRange('15-25K'), { min: 15, max: 25 });
  assert.deepEqual(parseSalaryRange('15-25K·14薪'), { min: 15, max: 25 });
  assert.deepEqual(parseSalaryRange('20K以上'), { min: 20, max: Infinity });
  assert.equal(parseSalaryRange(''), null);
});
