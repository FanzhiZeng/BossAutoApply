// 职位匹配逻辑：根据用户配置判断一个职位是否符合投递条件。
// 纯函数，不依赖 DOM，方便独立测试。

/**
 * @param {{
 *   title: string,
 *   company: string,
 *   salary: string,
 *   tagsText: string
 * }} job
 * @param {{
 *   keywords: string[],          // 关键词，标题/标签命中任意一个即视为匹配（为空表示不限制）
 *   excludeKeywords: string[],   // 排除关键词，标题/公司/标签命中任意一个即跳过
 *   excludeCompanies: string[],  // 公司黑名单（子串匹配）
 *   salaryMin: number,           // 单位：K，0 表示不限制
 *   salaryMax: number            // 单位：K，0 表示不限制
 * }} config
 * @returns {{matched: boolean, reason: string}}
 */
function matchJob(job, config) {
  const title = (job.title || '').trim();
  const company = (job.company || '').trim();
  const tagsText = (job.tagsText || '').trim();
  const haystack = `${title} ${tagsText}`.toLowerCase();
  const companyLower = company.toLowerCase();

  if (!title) {
    return { matched: false, reason: '未能解析出职位名称，跳过' };
  }

  const excludeKeywords = (config.excludeKeywords || []).map((s) => s.toLowerCase()).filter(Boolean);
  for (const kw of excludeKeywords) {
    if (haystack.includes(kw) || companyLower.includes(kw)) {
      return { matched: false, reason: `命中排除关键词「${kw}」` };
    }
  }

  const excludeCompanies = (config.excludeCompanies || []).map((s) => s.toLowerCase()).filter(Boolean);
  for (const c of excludeCompanies) {
    if (companyLower.includes(c)) {
      return { matched: false, reason: `公司命中黑名单「${c}」` };
    }
  }

  const keywords = (config.keywords || []).map((s) => s.toLowerCase()).filter(Boolean);
  if (keywords.length > 0) {
    const hit = keywords.some((kw) => haystack.includes(kw));
    if (!hit) {
      return { matched: false, reason: '未命中任何关键词' };
    }
  }

  const salaryRange = parseSalaryRange(job.salary);
  if (salaryRange && (config.salaryMin || config.salaryMax)) {
    const min = config.salaryMin || 0;
    const max = config.salaryMax || Infinity;
    // 只要职位薪资区间与用户期望区间有交集就算匹配
    const overlap = salaryRange.max >= min && salaryRange.min <= max;
    if (!overlap) {
      return { matched: false, reason: `薪资 ${job.salary} 不在期望范围内` };
    }
  }

  return { matched: true, reason: '匹配成功' };
}

/**
 * 解析类似 "15-25K"、"15-25K·14薪"、"20K以上" 的薪资字符串为 {min, max}（单位 K）。
 * 解析失败时返回 null（此时不参与薪资过滤）。
 */
function parseSalaryRange(salaryStr) {
  if (!salaryStr) return null;
  const s = String(salaryStr).replace(/\s/g, '');
  const rangeMatch = s.match(/(\d+(?:\.\d+)?)K?-(\d+(?:\.\d+)?)K/i);
  if (rangeMatch) {
    return { min: parseFloat(rangeMatch[1]), max: parseFloat(rangeMatch[2]) };
  }
  const aboveMatch = s.match(/(\d+(?:\.\d+)?)K以上/i);
  if (aboveMatch) {
    return { min: parseFloat(aboveMatch[1]), max: Infinity };
  }
  const singleMatch = s.match(/(\d+(?:\.\d+)?)K/i);
  if (singleMatch) {
    const v = parseFloat(singleMatch[1]);
    return { min: v, max: v };
  }
  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { matchJob, parseSalaryRange };
}
