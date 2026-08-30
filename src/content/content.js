// content.js
// 运行在 BOSS 直聘职位搜索页 (https://www.zhipin.com/web/geek/job*) 上，
// 负责实际的"搜索匹配职位 -> 打招呼 -> 投递"自动化流程。
//
// 设计要点：
// - 完全基于当前已登录的页面 DOM 操作，不读取、不上传任何账号 / Cookie 信息。
// - 状态保存在本脚本内的一个模块级对象里，独立于 popup 是否打开，
//   进度通过 chrome.runtime.sendMessage 上报给 background，
//   popup 打开时向 background 拉取最新状态即可，即使中途关闭 popup 也不会丢进度。
// - 所有涉及"下一步"的地方都做了轮询等待（waitFor），并且每一步都会检查
//   是否被用户点了"停止"，保证可以及时中断。

(function () {
  const SEL = window.__BOSS_SELECTORS__ || (typeof BOSS_SELECTORS !== 'undefined' ? BOSS_SELECTORS : null);
  const MATCH = typeof matchJob !== 'undefined' ? matchJob : null;
  const PARSE_SALARY = typeof parseSalaryRange !== 'undefined' ? parseSalaryRange : null;

  const state = {
    running: false,
    appliedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    log: [],
    config: null,
    stopRequested: false
  };

  const STORAGE_KEY_SEEN = 'ba_seen_job_ids';

  function log(message, level = 'info') {
    const entry = { time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), message, level };
    state.log.push(entry);
    if (state.log.length > 300) state.log.shift();
    reportProgress();
    // eslint-disable-next-line no-console
    console.log(`[BOSS自动投递] ${entry.time} ${message}`);
  }

  function reportProgress() {
    chrome.runtime.sendMessage({
      type: 'BA_PROGRESS',
      payload: {
        running: state.running,
        appliedCount: state.appliedCount,
        skippedCount: state.skippedCount,
        errorCount: state.errorCount,
        log: state.log.slice(-50)
      }
    }).catch(() => {});
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function randomDelay(minMs, maxMs) {
    const lo = Math.max(300, minMs || 3000);
    const hi = Math.max(lo, maxMs || 8000);
    return lo + Math.random() * (hi - lo);
  }

  async function waitFor(conditionFn, { timeout = 8000, interval = 200 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (state.stopRequested) return null;
      const result = conditionFn();
      if (result) return result;
      await sleep(interval);
    }
    return null;
  }

  function queryFirst(root, selectors) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function queryAllFirst(root, selectors) {
    for (const sel of selectors) {
      const els = root.querySelectorAll(sel);
      if (els && els.length > 0) return Array.from(els);
    }
    return [];
  }

  function findByText(root, tagSelector, textIncludesList) {
    const candidates = Array.from(root.querySelectorAll(tagSelector));
    return candidates.find((el) => {
      const t = (el.textContent || '').trim();
      return textIncludesList.some((needle) => t.includes(needle));
    }) || null;
  }

  function getJobCards() {
    const container = queryFirst(document, SEL.jobListContainer) || document.body;
    return queryAllFirst(container, SEL.jobCard);
  }

  function buildJobId(href, title, company, salary) {
    // 职位详情链接通常带有 lid / securityId 等每次搜索都会变化的追踪参数，
    // 必须只取路径部分作为稳定 ID，否则同一个职位每次搜索都会被当成"新职位"，
    // 导致重复打招呼。
    if (href) {
      try {
        const url = new URL(href, window.location.href);
        if (url.pathname && url.pathname !== '/') return url.pathname;
      } catch (e) {
        // 不是合法 URL，走兜底方案
      }
    }
    return `${title}__${company}__${salary}`;
  }

  function extractJobInfo(card) {
    const titleEl = queryFirst(card, SEL.jobTitle);
    const companyEl = queryFirst(card, SEL.companyName);
    const salaryEl = queryFirst(card, SEL.jobSalary);
    const tagsEls = queryAllFirst(card, SEL.jobTags);
    const linkEl = card.querySelector('a[href]');

    const title = titleEl ? titleEl.textContent.trim() : '';
    const company = companyEl ? companyEl.textContent.trim() : '';
    const salary = salaryEl ? salaryEl.textContent.trim() : '';
    const tagsText = tagsEls.map((el) => el.textContent.trim()).join(' ');
    const href = linkEl ? linkEl.getAttribute('href') : '';

    const jobId = buildJobId(href, title, company, salary);

    return { jobId, title, company, salary, tagsText };
  }

  async function loadSeenIds() {
    const data = await chrome.storage.local.get(STORAGE_KEY_SEEN);
    return new Set(data[STORAGE_KEY_SEEN] || []);
  }

  async function markSeen(jobId) {
    const data = await chrome.storage.local.get(STORAGE_KEY_SEEN);
    const list = data[STORAGE_KEY_SEEN] || [];
    if (!list.includes(jobId)) {
      list.push(jobId);
      if (list.length > 5000) list.splice(0, list.length - 5000);
      await chrome.storage.local.set({ [STORAGE_KEY_SEEN]: list });
    }
  }

  function setNativeValue(element, value) {
    const proto = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function isCardAlreadyChatted(card) {
    const text = card.textContent || '';
    return SEL.alreadyChattedTextHints.some((hint) => text.includes(hint));
  }

  async function performSearch(keyword) {
    const input = await waitFor(() => queryFirst(document, SEL.searchInput), { timeout: 5000 });
    if (!input) {
      log('未找到页面搜索框，将直接使用当前页面已有的职位列表（如需按关键词搜索，请先手动在 BOSS 搜索框中搜索）', 'warn');
      return false;
    }

    input.focus();
    setNativeValue(input, keyword);
    await sleep(300);

    const searchBtn = queryFirst(document, SEL.searchButton);
    if (searchBtn) {
      searchBtn.click();
    } else {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    }

    const ok = await waitFor(() => getJobCards().length > 0, { timeout: 8000 });
    if (!ok) {
      log(`搜索「${keyword}」后未加载出职位列表，请确认关键词是否有结果`, 'warn');
      return false;
    }
    await sleep(800);
    return true;
  }

  async function applySalaryFilter(minK, maxK) {
    if (!minK && !maxK) return; // 用户没设置薪资范围，保持"不限"
    if (!PARSE_SALARY) return;

    const trigger = findByText(document, 'div, span, button, a', SEL.salaryFilterTriggerTexts);
    if (!trigger) {
      log('未找到"薪资待遇"筛选按钮，跳过原生筛选设置（仍会按薪资对已加载的结果做二次过滤）', 'warn');
      return;
    }

    trigger.click();
    await sleep(400);

    const panel = await waitFor(() => queryFirst(document, SEL.filterDropdownPanel), { timeout: 3000 }) || document;
    const optionEls = queryAllFirst(panel, SEL.filterOptionItem).filter((el) => (el.textContent || '').trim());

    const lo = minK || 0;
    const hi = maxK || Infinity;
    let bestEl = null;
    let bestOverlap = -Infinity;
    for (const el of optionEls) {
      const range = PARSE_SALARY(el.textContent.trim());
      if (!range) continue;
      const overlap = Math.min(range.max, hi) - Math.max(range.min, lo);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestEl = el;
      }
    }

    if (!bestEl) {
      log('未能在薪资筛选选项里找到可解析的档位，跳过原生筛选设置', 'warn');
      trigger.click(); // 尝试收起面板
      return;
    }

    const chosenText = bestEl.textContent.trim();
    bestEl.click();
    await sleep(300);

    const confirmBtn = findByText(document, 'button, span, a', SEL.filterConfirmButtonTexts);
    if (confirmBtn) confirmBtn.click();

    await sleep(600);
    await waitFor(() => getJobCards().length > 0, { timeout: 6000 });
    log(`已应用薪资筛选：${chosenText}`);
  }

  // 清掉可能挡在流程中间的通用弹窗（完善简历提示、活动广告等）。
  // 专门处理"已向BOSS发送消息"确认框的逻辑在 sendGreeting 里，这里只处理其余的。
  function dismissGenericDialog() {
    const closeBtn = findByText(document, 'button, span, a, i, div', SEL.genericDialogCloseTexts);
    if (closeBtn) {
      closeBtn.click();
      return true;
    }
    const closeIcon = queryFirst(document, SEL.genericDialogCloseIconSelectors);
    if (closeIcon) {
      closeIcon.click();
      return true;
    }
    return false;
  }

  async function openChatForCard(card) {
    // 优先尝试卡片上直接可见的"打招呼/立即沟通"按钮
    let chatBtn = queryFirst(card, SEL.cardChatButton) || findByText(card, 'button, a, span', ['打招呼', '立即沟通', '沟通']);

    if (!chatBtn) {
      // 退而求其次：点击卡片本身，唤出详情面板，再在详情面板里找按钮
      card.scrollIntoView({ block: 'center', behavior: 'instant' });
      card.click();
      await sleep(600);
      const detailRoot = document;
      chatBtn = findByText(detailRoot, 'button, a, span', ['打招呼', '立即沟通']);
    }

    if (!chatBtn) return false;

    chatBtn.scrollIntoView({ block: 'center', behavior: 'instant' });
    chatBtn.click();
    return true;
  }

  function findAutoSentDialogButtons() {
    const hasDialogText = SEL.autoSentDialogHints.some((hint) => document.body.textContent.includes(hint));
    if (!hasDialogText) return null;
    const stayBtn = findByText(document, 'button, span, a, div', SEL.autoSentDialogStayButtonTexts);
    const continueBtn = findByText(document, 'button, span, a, div', SEL.autoSentDialogContinueButtonTexts);
    if (!stayBtn && !continueBtn) return null;
    return { stayBtn, continueBtn };
  }

  async function sendGreeting(greetingText) {
    // 点击"打招呼"后，BOSS 可能出现两种情况，谁先出现处理谁：
    // 1) 一个可编辑的聊天输入框 —— 我们填入自定义话术并发送；
    // 2) 一个"已向BOSS发送消息"确认框 —— 说明 BOSS 已经用你在官方设置里配置的
    //    默认招呼语直接发出去了，这里的自定义话术不会生效，只能确认并关闭继续下一个。
    const outcome = await waitFor(() => {
      const input = queryFirst(document, SEL.chatInput);
      if (input) return { type: 'input', input };
      const dialog = findAutoSentDialogButtons();
      if (dialog) return { type: 'auto-sent', dialog };
      return null;
    }, { timeout: 6000 });

    if (!outcome) {
      return { ok: false, reason: '未找到聊天输入框，也没有检测到发送确认弹窗（可能页面结构已变化，或该职位需要先完善简历）' };
    }

    if (outcome.type === 'auto-sent') {
      const btn = outcome.dialog.stayBtn || outcome.dialog.continueBtn;
      await sleep(300);
      btn.click();
      await sleep(400);
      return { ok: true, usedDefaultGreeting: true };
    }

    const input = outcome.input;
    setNativeValue(input, '');
    await sleep(150);
    setNativeValue(input, greetingText);
    await sleep(200);

    const sendBtn = queryFirst(document, SEL.chatSendButton) || findByText(document, 'button, span, div', ['发送']);
    if (sendBtn) {
      sendBtn.click();
    } else {
      // 回退方案：模拟回车发送
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    }

    return { ok: true };
  }

  async function goToNextPage() {
    const nextBtn = queryFirst(document, SEL.nextPageButton);
    if (!nextBtn) return false;
    const isDisabled = nextBtn.classList.contains('disabled') || nextBtn.getAttribute('aria-disabled') === 'true';
    if (isDisabled) return false;
    nextBtn.scrollIntoView({ block: 'center', behavior: 'instant' });
    nextBtn.click();
    await sleep(1500);
    return true;
  }

  async function runAutomation(config) {
    if (!SEL || !MATCH) {
      log('脚本依赖未正确加载（selectors.js / matcher.js），请检查扩展是否完整安装', 'error');
      state.running = false;
      reportProgress();
      return;
    }

    state.running = true;
    state.stopRequested = false;
    state.config = config;
    state.appliedCount = 0;
    state.skippedCount = 0;
    state.errorCount = 0;
    state.log = [];

    log('开始自动投递任务');

    if (config.keywords && config.keywords.length > 0) {
      const searchTerm = config.keywords[0];
      log(`自动搜索关键词「${searchTerm}」...`);
      await performSearch(searchTerm);
      if (state.stopRequested) {
        state.running = false;
        reportProgress();
        return;
      }
    }

    if (config.salaryMin || config.salaryMax) {
      await applySalaryFilter(config.salaryMin, config.salaryMax);
      if (state.stopRequested) {
        state.running = false;
        reportProgress();
        return;
      }
    }

    const seen = await loadSeenIds();
    const maxApplications = config.maxApplications || 20;

    let page = 1;
    while (state.running && !state.stopRequested && state.appliedCount < maxApplications) {
      const cards = getJobCards();
      if (cards.length === 0) {
        const found = await waitFor(() => getJobCards().length > 0, { timeout: 5000 });
        if (!found) {
          log('当前页面未找到职位卡片，任务结束', 'warn');
          break;
        }
      }

      const freshCards = getJobCards();
      log(`第 ${page} 页：发现 ${freshCards.length} 个职位卡片`);

      for (const card of freshCards) {
        if (state.stopRequested || state.appliedCount >= maxApplications) break;

        dismissGenericDialog();

        let info;
        try {
          info = extractJobInfo(card);
        } catch (e) {
          state.errorCount += 1;
          log(`解析职位卡片失败：${e.message}`, 'error');
          continue;
        }

        if (!info.title) continue;
        if (seen.has(info.jobId)) continue;
        if (isCardAlreadyChatted(card)) {
          seen.add(info.jobId);
          await markSeen(info.jobId);
          continue;
        }

        const { matched, reason } = MATCH(info, config);
        if (!matched) {
          state.skippedCount += 1;
          seen.add(info.jobId);
          await markSeen(info.jobId);
          log(`跳过《${info.title}》@${info.company}：${reason}`);
          continue;
        }

        // 注意：只有"成功投递"或"确定要跳过"（不匹配 / 已打过招呼，见上方两处
        // seen.add）才会把 jobId 写入已处理列表。像"没找到按钮""发送失败""
        // 抛异常"这类偶发性技术故障不会标记为已处理，这样下次运行时会重试，
        // 而不是因为一次页面加载慢就把这个岗位永久拉黑。
        try {
          const opened = await openChatForCard(card);
          if (!opened) {
            state.errorCount += 1;
            log(`《${info.title}》@${info.company}：未找到打招呼按钮，跳过（下次会重试）`, 'warn');
            continue;
          }

          const result = await sendGreeting(config.greeting);
          if (result.ok) {
            state.appliedCount += 1;
            const note = result.usedDefaultGreeting
              ? '（该职位使用了 BOSS 自带的默认招呼语，未能填入自定义话术，可在 BOSS「消息通知-设置招呼语」里修改默认文案）'
              : '';
            log(`已投递《${info.title}》@${info.company}（${info.salary}）${note}`, 'success');
            seen.add(info.jobId);
            await markSeen(info.jobId);
          } else {
            state.errorCount += 1;
            log(`《${info.title}》@${info.company}：${result.reason}（下次会重试）`, 'error');
          }
        } catch (e) {
          state.errorCount += 1;
          log(`处理《${info.title}》@${info.company} 时出错：${e.message}（下次会重试）`, 'error');
        }

        if (state.appliedCount >= maxApplications) break;

        const delay = randomDelay(config.minDelayMs, config.maxDelayMs);
        await sleep(delay);
      }

      if (state.stopRequested || state.appliedCount >= maxApplications) break;

      log('本页处理完毕，尝试翻页...');
      dismissGenericDialog();
      const moved = await goToNextPage();
      if (!moved) {
        log('没有更多职位了，任务结束');
        break;
      }
      page += 1;
      await sleep(1500);
    }

    state.running = false;
    log(`任务结束，共投递 ${state.appliedCount} 个职位，跳过 ${state.skippedCount} 个，${state.errorCount} 个异常`);
    reportProgress();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'BA_START') {
      if (state.running) {
        sendResponse({ ok: false, reason: '任务已在运行中' });
        return true;
      }
      runAutomation(message.config);
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === 'BA_STOP') {
      state.stopRequested = true;
      state.running = false;
      log('收到停止指令，正在结束当前任务...', 'warn');
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === 'BA_GET_STATE') {
      sendResponse({
        running: state.running,
        appliedCount: state.appliedCount,
        skippedCount: state.skippedCount,
        errorCount: state.errorCount,
        log: state.log.slice(-50)
      });
      return true;
    }
    return false;
  });
})();
