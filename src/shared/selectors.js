// 集中管理页面选择器。
//
// BOSS 直聘的前端页面结构会不定期改版，如果自动化脚本"找不到职位卡片"
// 或"找不到打招呼输入框"，通常只需要更新本文件里的选择器即可，不用改动
// 其余逻辑。每一项都提供了若干候选选择器（数组），脚本会依次尝试，
// 建议保留多个候选以提高兼容性。
//
// 排查方法：在职位搜索页按 F12 打开开发者工具，用"选中元素"工具点击对应
// 区域，把新的 class / 结构补充进对应数组即可。
const BOSS_SELECTORS = {
  // 职位列表容器
  jobListContainer: ['.job-list-box', '.search-job-result', '#main'],

  // 单个职位卡片
  jobCard: ['.job-card-wrapper', '.job-card-box', '.job-primary'],

  // 卡片内：职位名称
  jobTitle: ['.job-name', '.job-title'],

  // 卡片内：公司名称
  companyName: ['.company-name', '.company-text .name'],

  // 卡片内：薪资
  jobSalary: ['.salary'],

  // 卡片内：标签（学历/经验/技能标签等），用于关键词匹配
  jobTags: ['.tag-list', '.job-labels', '.job-card-footer .info-desc'],

  // 卡片内：职位描述简介（如果列表页有展示）
  jobDesc: ['.info-desc', '.job-desc'],

  // 卡片上直接可点击的"打招呼/立即沟通"按钮（部分列表样式会直接展示）
  cardChatButton: ['.btn-startchat', '.start-chat-btn'],

  // 翻页：下一页按钮
  nextPageButton: ['.options-pages a.ui-icon-arrow-right:not(.disabled)', '.next-page:not(.disabled)'],

  // 聊天对话框（点击打招呼后弹出/跳转的会话面板）
  chatDialog: ['.dialog-container', '.chat-panel', '.im-chat-panel'],

  // 聊天输入框
  chatInput: ['.chat-input textarea', '.im-editor-input', 'textarea.input-area'],

  // 聊天发送按钮
  chatSendButton: ['.chat-input .send-btn', '.btn-send', '.send-message-btn'],

  // 一些"已沟通/继续沟通"之类的按钮文案，用来判断这个岗位是否已经打过招呼
  alreadyChattedTextHints: ['继续沟通', '已发送', '继续聊']
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BOSS_SELECTORS;
}
