const storage = require('./storage')

// ==================== 纯工具函数 ====================

function calcAccuracy(correct, total) {
  return total > 0 ? Math.round((correct / total) * 100) : 0
}

function formatDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// ==================== 模板库 ====================

// 新手期（总记录 < 3 条）
const NEWBIE_TEMPLATES = [
  { emoji: '🎉', text: '一开始就对了 未来的通关大佬就是你' },
  { emoji: '🚀', text: '新号启动 一个月后看看能卷成什么样' },
  { emoji: '💪', text: '正式进入备考模式 欢迎加入学霸大家庭' },
  { emoji: '🌟', text: '来都来了 这道题缘分到了必能通关' },
  { emoji: '🔥', text: '新手村第一天 你的潜力已经开始暴露了' },
  { emoji: '👀', text: '命运的齿轮开始转动 从这道题开始' },
  { emoji: '✨', text: '开局即正确 你这个新手有点东西' },
  { emoji: '🏆', text: '第一次打卡就稳了 天赋正在加载中' },
  { emoji: '🎯', text: '新手保护期已开启 请尽情刷题' },
  { emoji: '🌱', text: '种下第一颗学习种子 静待发芽' }
]

// 规则1: 里程碑（30/14/7天）
const MILESTONE_TEMPLATES = {
  30: [
    { emoji: '👑', text: '连续30天！已经next level了' },
    { emoji: '🏆', text: '30天了 这毅力比我ddl还坚定' },
    { emoji: '🔥', text: '打卡满月了 你已经卷成天花板了' },
    { emoji: '💎', text: '30天不断签 这波稳到不讲武德' },
    { emoji: '⚡', text: '整整一个月 你是真·自律天花板' },
    { emoji: '🚀', text: '连续打卡30天 助我破鼎' },
    { emoji: '🥂', text: '满30天 敬自己一杯 真不含糊' },
    { emoji: '❤️', text: '30天全勤 爱你老己 继续保持' },
    { emoji: '🌟', text: '一个月不断签 活人感自律天花板' },
    { emoji: '💪', text: '30天打卡达成 下一步继续通关' }
  ],
  14: [
    { emoji: '🚀', text: '两周全勤 这波节奏已经拿捏了' },
    { emoji: '🎯', text: '14天不断签 你就是学习圈的活爹' },
    { emoji: '💪', text: '半个月了 这意志力讲不讲理啊' },
    { emoji: '🔥', text: '连续两周 自律的齿轮已经卡死了' },
    { emoji: '✨', text: '14天 没人能阻挡你通关的步伐' },
    { emoji: '🥂', text: '两周全勤达成 必须敬自己一杯' },
    { emoji: '🚀', text: '14天打卡不断签 助我破鼎' },
    { emoji: '💎', text: '连续14天 不是预制的 是真的稳' },
    { emoji: '👀', text: '两周了 你这自律也太有活人感了' },
    { emoji: '❤️', text: '14天全勤 爱你老己 继续冲' }
  ],
  7: [
    { emoji: '🎉', text: '一周全勤 这谁还分得清你和学霸' },
    { emoji: '⚡', text: '7天成就解锁 已经超越80%的学习者' },
    { emoji: '🌟', text: '一周了 自律的DNA已经开始动了' },
    { emoji: '💎', text: '7天打卡成就达成 稳住别浪' },
    { emoji: '👀', text: '坚持一周了 没想到你这么能打吧' },
    { emoji: '🥂', text: '打卡满七天 敬自己一杯' },
    { emoji: '🚀', text: '7天不断签 小目标轻松拿捏' },
    { emoji: '🔥', text: '一周全勤 活人感满满 不是演的' },
    { emoji: '💪', text: '7天打卡达成 下一步继续升级' },
    { emoji: '❤️', text: '爱你老己 七天全勤真的很棒' }
  ]
}

// 规则2: 重新开始（昨天未打卡）
const RESTART_TEMPLATES = [
  { emoji: '🔋', text: '今天重新起航 咱主打一个稳中带卷' },
  { emoji: '💪', text: '断卡是战术性休息 今天正式重启' },
  { emoji: '✨', text: '没关系 重新开始本身就是一种进步' },
  { emoji: '🎯', text: '昨天已是昨日 今天节奏重新拿捏' },
  { emoji: '🔥', text: '一切归零重新出发 这次必须稳到最后' },
  { emoji: '🌟', text: '断就断了呗 今天开始就是全新的自己' },
  { emoji: '🚀', text: '重启成功 今天的你已经是next level' },
  { emoji: '💎', text: '断卡不丢人 重新捡起来才是真本事' },
  { emoji: '🌱', text: '跌倒的地方 正是下一次起飞的风口' },
  { emoji: '👀', text: '回来就好 学习搭子们都在等你' }
]

// 规则3: 表扬（正确率高出10%+）
const PRAISE_TEMPLATES = [
  { emoji: '🚀', text: '这正确率是开了挂吧 天赋型选手就是你' },
  { emoji: '🔥', text: '突然开窍了属于是 正确率直接起飞' },
  { emoji: '💎', text: '别人做题基础 你这正确率不基础' },
  { emoji: '⚡', text: '今天的状态拉满了 正确率狠狠拿捏' },
  { emoji: '👀', text: '这正确率老铁们帮我看看是不是幻觉' },
  { emoji: '🎯', text: '正确率高得离谱 你怕不是AI本I吧' },
  { emoji: '🌟', text: '这正确率涨得太有活人感了 不是演的' },
  { emoji: '🥂', text: '正确率起飞 必须敬自己一杯' },
  { emoji: '🔥', text: '这正确率不是预制的 是真材实料' },
  { emoji: '❤️', text: '正确率暴涨 爱你老己 继续保持' }
]

// 规则4: 关心鼓励（正确率低10%+）
const ENCOURAGE_TEMPLATES = [
  { emoji: '😴', text: '今天是不是有点困 正确率偷偷打了个盹' },
  { emoji: '💪', text: '正确率小波动而已 你底子是稳的' },
  { emoji: '🧘', text: '问题不大 咱主打一个长期主义' },
  { emoji: '🌊', text: '没事儿 低谷之后必是反弹高峰' },
  { emoji: '🫶', text: '允许自己有波动 这才是活人感拉满' },
  { emoji: '🤝', text: '不讲不讲 明天这分数直接翻一倍' },
  { emoji: '🌱', text: '正确率只是暂时掉线 实力还在的' },
  { emoji: '🔋', text: '今天电量不足 充完电明天继续拿捏' },
  { emoji: '💎', text: '一次波动不算啥 不是预制的低谷' },
  { emoji: '🎯', text: '状态会回来的 明天再给它上强度' }
]

// 规则5: 板块表扬（某板块高出15%+）
const SUBJECT_PRAISE_TEMPLATES = [
  { emoji: '🚀', text: '{name}这波起飞了 专项突破已解锁' },
  { emoji: '💡', text: '{name}原地进化 你开窍了我先说' },
  { emoji: '⚡', text: '今天的{name}像开了加速 buff叠满' },
  { emoji: '👀', text: '{name}突然拿捏 之前是在隐藏实力吧' },
  { emoji: '🔥', text: '不得了 {name}直接进阶了属于是' },
  { emoji: '🎯', text: '{name}正确率炸了 这就是暴击伤害吗' },
  { emoji: '🌟', text: '{name}正确率涨得太有活人感了' },
  { emoji: '🥂', text: '{name}拿下 必须敬自己一杯' },
  { emoji: '💎', text: '{name}这波不是预制的 是真强了' },
  { emoji: '❤️', text: '{name}助我破鼎 爱你老己' }
]

// 规则6: 板块建议（某板块低15%+）
const SUBJECT_SUGGEST_TEMPLATES = [
  { emoji: '🤝', text: '{name}今天心情不好 明天宠幸它一下' },
  { emoji: '🎯', text: '今天和{name}没对上频 明天再约' },
  { emoji: '🧘', text: '{name}先放过 明天收拾它也不迟' },
  { emoji: '😴', text: '没事 {name}只是今天不在状态' },
  { emoji: '🌱', text: '让{name}休息一天 明天多刷两道就行' },
  { emoji: '💪', text: '{name}今天摆烂 明天必须给它上强度' },
  { emoji: '🌊', text: '{name}小波动 低谷之后必是反弹' },
  { emoji: '🤝', text: '不讲不讲 明天{name}直接翻一倍' },
  { emoji: '🧘', text: '{name}今天电量低 充完电再收拾' },
  { emoji: '✨', text: '允许{name}有波动 这才是活人感' }
]

// 规则7: 题量夸奖（题量高50%+）
const VOLUME_PRAISE_TEMPLATES = [
  { emoji: '📚', text: '今天这题量 你是打算把题库刷穿吗' },
  { emoji: '🏋️', text: '题量惊人 你这是学习还是在搬家啊' },
  { emoji: '🔥', text: '刷这么多 这是要卷死其他学友的节奏' },
  { emoji: '⚡', text: '今天直接肝出两天的量 狠人就是你' },
  { emoji: '👀', text: '这题量不讲不讲 生产队的驴都不敢这么干' },
  { emoji: '💎', text: '刷题量拉满 这波你是真的不讲武德' },
  { emoji: '🚀', text: '题量起飞 助我破鼎 继续保持' },
  { emoji: '🥂', text: '今天题量爆表 敬自己一杯' },
  { emoji: '💪', text: '别人刷题基础 你这题量不基础' },
  { emoji: '❤️', text: '题量超标 爱你老己 明天继续' }
]

// 规则8: 普通鼓励
const NORMAL_TEMPLATES = [
  { emoji: '😌', text: '稳如老狗的一天 明天继续保持节奏' },
  { emoji: '🧘', text: '不卷不躺 刚刚好就是最好的状态' },
  { emoji: '🌿', text: '一切正常 像呼吸一样自然地进步着' },
  { emoji: '🎯', text: '稳中有进 这是备考人的正确姿势' },
  { emoji: '✨', text: '平平无奇的一天 但坚持本身就是天赋' },
  { emoji: '💪', text: '没什么特别的 但每天坚持就是特别的' },
  { emoji: '🌟', text: '今天状态稳定 活人感满满 不是演的' },
  { emoji: '🌱', text: '稳步推进 种子正在悄悄发芽' },
  { emoji: '🚀', text: '节奏在线 明天继续拿捏' },
  { emoji: '💎', text: '今天的努力不是预制的 是真实的' }
]

// 自我对比总结文案
const COMPARE_TEMPLATES = {
  upBoth: [
    { emoji: '🚀', text: '这周期题量和正确率双涨 你已经在加速了' },
    { emoji: '🔥', text: '刷得更多还对得更稳 这谁顶得住啊' },
    { emoji: '💎', text: '量和质一起飞 这波叫全方位进化' },
    { emoji: '⚡', text: '题量上去了 正确率也没掉队 狠人' },
    { emoji: '👀', text: '这周期数据直接超车 平时偷偷卷了吧' },
    { emoji: '🥂', text: '双指标都涨 必须敬自己一杯' },
    { emoji: '🌟', text: '量和质双涨 太有活人感了' },
    { emoji: '❤️', text: '双开花 爱你老己 继续保持' },
    { emoji: '🚀', text: '这周期直接助我破鼎 太强了' },
    { emoji: '💪', text: '别人进步基础 你这进步速度不基础' }
  ],
  upVolume: [
    { emoji: '📚', text: '这周期刷题量起飞了 正确率稳住就能赢' },
    { emoji: '💪', text: '题量上去了 正确率会跟着上来的 别急' },
    { emoji: '🔥', text: '刷得多就是硬道理 量变正在路上' },
    { emoji: '🚀', text: '这周期明显加量了 节奏拿捏住了' },
    { emoji: '👀', text: '题量暴增 这是要刷穿题库的架势' },
    { emoji: '🥂', text: '题量起飞 敬自己一杯 稳住节奏' },
    { emoji: '⚡', text: '刷题量不基础 正确率随后就到' },
    { emoji: '🌟', text: '这题量涨得太有活人感了' },
    { emoji: '💎', text: '题量不是预制的 是真肝出来的' },
    { emoji: '❤️', text: '量先冲了 爱你老己 质马上来' }
  ],
  upAcc: [
    { emoji: '🎯', text: '正确率涨了 精准打击越来越稳' },
    { emoji: '💡', text: '刷得少但正确率高 质量玩家就是你' },
    { emoji: '🚀', text: '正确率悄悄提升 实力不允许低调' },
    { emoji: '🔥', text: '少而精路线 正确率已经next level' },
    { emoji: '✨', text: '题量稳了 正确率自己往上爬' },
    { emoji: '🥂', text: '正确率提升 敬自己一杯' },
    { emoji: '🌟', text: '正确率涨得也太有活人感了' },
    { emoji: '💎', text: '正确率不是预制的 是真进步了' },
    { emoji: '❤️', text: '精准度up 爱你老己 继续保持' },
    { emoji: '⚡', text: '正确率助我破鼎 下一题继续稳' }
  ],
  down: [
    { emoji: '🤝', text: '这周期稍微回落 没关系 起伏才是常态' },
    { emoji: '🧘', text: '数据小波动 放轻松 下一周期再弹回来' },
    { emoji: '😴', text: '这周期好像有点佛系 下周加把劲' },
    { emoji: '🌊', text: '有涨有跌很正常 咱不做数据奴隶' },
    { emoji: '💪', text: '暂时落后而已 调整后直接反超' },
    { emoji: '🌱', text: '低谷期而已 种子正在扎根' },
    { emoji: '🫶', text: '允许波动 活人感满满 不是机器' },
    { emoji: '🔋', text: '这周期电量不足 下一周期满血回归' },
    { emoji: '🎯', text: '数据回落 不讲不讲 下次直接反弹' },
    { emoji: '💎', text: '不是预制的低谷 是真在调整节奏' }
  ],
  flat: [
    { emoji: '😌', text: '和上一周期基本持平 稳得一批' },
    { emoji: '🧘', text: '节奏保持一致 这就是长期主义' },
    { emoji: '🌿', text: '没什么大起大落 稳定输出也是赢' },
    { emoji: '✨', text: '数据持平 说明你已经找到舒适节奏' },
    { emoji: '🎯', text: '不疾不徐 稳步前进就挺好' },
    { emoji: '💪', text: '稳也是一种本事 继续保持节奏' },
    { emoji: '🌟', text: '平平无奇但稳定 活人感拉满' },
    { emoji: '🌱', text: '扎根期 保持稳定就是最大的进步' },
    { emoji: '🚀', text: '节奏没乱 下一周期继续拿捏' },
    { emoji: '❤️', text: '稳得很 爱你老己 继续坚持' }
  ]
}

// ==================== 工具函数 ====================

function randomPick(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function formatTemplate(tpl, name) {
  return {
    emoji: tpl.emoji,
    text: tpl.text.replace(/\{name\}/g, name)
  }
}

// 检查昨天是否有打卡
function hadYesterdayRecord(records, checkedInDates = null) {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const ystr = formatDate(yesterday)
  if (checkedInDates) {
    return checkedInDates.includes(ystr)
  }
  return records.some(r => r.date === ystr)
}

// 计算连续打卡天数（包含今日），基于日期数组或记录直接计算
function calcStreak(records, checkedInDates = null) {
  let streak = 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let sortedDates
  if (checkedInDates) {
    sortedDates = [...checkedInDates].sort((a, b) => new Date(b) - new Date(a))
  } else {
    const dates = new Set(records.map(r => r.date))
    sortedDates = Array.from(dates).sort((a, b) => new Date(b) - new Date(a))
  }
  for (let i = 0; i < sortedDates.length; i++) {
    const expected = new Date(today)
    expected.setDate(expected.getDate() - i)
    if (sortedDates[i] === formatDate(expected)) {
      streak++
    } else {
      break
    }
  }
  return streak
}

// 计算今日综合正确率
function calcTodayAcc(todayRecord) {
  let total = 0
  let correct = 0
  todayRecord.subjects.forEach(s => {
    total += s.total
    correct += s.correct
  })
  return calcAccuracy(correct, total)
}

// 计算今日总题量
function calcTodayVolume(todayRecord) {
  let total = 0
  todayRecord.subjects.forEach(s => total += s.total)
  return total
}

// 计算历史综合正确率（排除今日）
function calcHistoryAvgAcc(historyRecords, historyStats = null) {
  if (historyStats) {
    return calcAccuracy(historyStats.totalCorrect, historyStats.totalQuestions)
  }
  if (historyRecords.length === 0) return 0
  let total = 0
  let correct = 0
  historyRecords.forEach(r => {
    r.subjects.forEach(s => {
      total += s.total
      correct += s.correct
    })
  })
  return calcAccuracy(correct, total)
}

// 计算历史平均每日题量（排除今日）
function calcHistoryAvgVolume(historyRecords, historyStats = null) {
  if (historyStats) {
    if (historyStats.totalRecords === 0) return 0
    return Math.round(historyStats.totalQuestions / historyStats.totalRecords)
  }
  if (historyRecords.length === 0) return 0
  let total = 0
  historyRecords.forEach(r => {
    r.subjects.forEach(s => total += s.total)
  })
  return Math.round(total / historyRecords.length)
}

// 计算各板块本次 vs 历史平均正确率差值
function calcSubjectDiffs(todayRecord, historyRecords, historyStats = null) {
  // 今日各板块正确率
  const todayAccMap = {}
  todayRecord.subjects.forEach(s => {
    todayAccMap[s.name] = calcAccuracy(s.correct, s.total)
  })

  let historyAccMap = {}
  let historyCountMap = {}

  if (historyStats && historyStats.subjectStats) {
    // 使用增量缓存的板块统计
    Object.entries(historyStats.subjectStats).forEach(([name, s]) => {
      historyAccMap[name] = s.avgAccuracy * s.count
      historyCountMap[name] = s.count
    })
  } else {
    // 历史各板块正确率
    historyRecords.forEach(r => {
      r.subjects.forEach(s => {
        if (!historyAccMap[s.name]) {
          historyAccMap[s.name] = 0
          historyCountMap[s.name] = 0
        }
        historyAccMap[s.name] += calcAccuracy(s.correct, s.total)
        historyCountMap[s.name]++
      })
    })
  }

  // 动态读取用户实际创建的板块，不再限制为固定科目
  const subjectNames = Object.keys(todayAccMap).filter(name => historyCountMap[name] > 0)

  const diffs = subjectNames.map(name => ({
    name,
    today: todayAccMap[name],
    historyAvg: Math.round(historyAccMap[name] / historyCountMap[name]),
    diff: todayAccMap[name] - Math.round(historyAccMap[name] / historyCountMap[name])
  }))

  return diffs
}

// ==================== 主评价函数 ====================

/**
 * 生成每日评语
 * @param {Object} todayRecord - 今日保存的打卡记录
 * @param {Array} allRecords - 包含今日之前的所有记录（含今日）
 * @param {Object} historyStats - 可选，增量缓存的历史统计，避免全量读取记录
 * @returns {{ emoji: string, text: string } | null}
 */
function evaluate(todayRecord, allRecords, historyStats = null) {
  // 历史记录（排除今日），仅在未提供 historyStats 时使用
  const historyRecords = historyStats ? [] : allRecords.filter(r => r.date !== todayRecord.date)

  // 总记录数（含今日）
  const totalRecords = historyStats ? historyStats.totalRecords : allRecords.length

  // 新手期判断：总记录数 < 3
  if (totalRecords < 3) {
    return randomPick(NEWBIE_TEMPLATES)
  }

  // 计算各项指标
  const streak = calcStreak(allRecords, historyStats ? historyStats.checkedInDates : null)
  const yesterdayHad = hadYesterdayRecord(allRecords, historyStats ? historyStats.checkedInDates : null)
  const todayAcc = calcTodayAcc(todayRecord)
  const historyAvgAcc = calcHistoryAvgAcc(historyRecords, historyStats)
  const accDiff = todayAcc - historyAvgAcc
  const todayVolume = calcTodayVolume(todayRecord)
  const historyAvgVolume = calcHistoryAvgVolume(historyRecords, historyStats)
  const volumeRatio = historyAvgVolume > 0 ? todayVolume / historyAvgVolume : 0
  const subjectDiffs = calcSubjectDiffs(todayRecord, historyRecords, historyStats)

  // 规则1: 里程碑
  if (streak >= 30) return randomPick(MILESTONE_TEMPLATES[30])
  if (streak >= 14) return randomPick(MILESTONE_TEMPLATES[14])
  if (streak >= 7) return randomPick(MILESTONE_TEMPLATES[7])

  // 规则2: 重新开始
  if (streak === 1 && !yesterdayHad) return randomPick(RESTART_TEMPLATES)

  // 规则3: 正确率大幅提升
  if (accDiff >= 10) return randomPick(PRAISE_TEMPLATES)

  // 规则4: 正确率大幅下降
  if (accDiff <= -10) return randomPick(ENCOURAGE_TEMPLATES)

  // 规则5: 某板块进步明显
  const bestSubject = subjectDiffs
    .filter(s => s.diff >= 15)
    .sort((a, b) => b.diff - a.diff)[0]
  if (bestSubject) {
    return formatTemplate(randomPick(SUBJECT_PRAISE_TEMPLATES), bestSubject.name)
  }

  // 规则6: 某板块退步明显
  const worstSubject = subjectDiffs
    .filter(s => s.diff <= -15)
    .sort((a, b) => a.diff - b.diff)[0]
  if (worstSubject) {
    return formatTemplate(randomPick(SUBJECT_SUGGEST_TEMPLATES), worstSubject.name)
  }

  // 规则7: 题量大幅增加
  if (volumeRatio >= 1.5) return randomPick(VOLUME_PRAISE_TEMPLATES)

  // 规则8: 普通鼓励
  return randomPick(NORMAL_TEMPLATES)
}

function getEvalCacheKey(planId, todayRecord) {
  const base = todayRecord
    ? `${todayRecord.date}_${todayRecord.totalQuestions || 0}_${todayRecord.totalCorrect || 0}_${todayRecord.subjects ? todayRecord.subjects.length : 0}`
    : 'none'
  return `today_evaluation_${planId || 'default'}_${base}`
}

// 保存今日评语；必须按 planId 与今日记录内容隔离，避免多计划或多条记录共享同一条评语
function saveEvaluationToday(todayRecord, allRecords, planId = '', historyStats = null) {
  const result = evaluate(todayRecord, allRecords, historyStats)
  if (result) {
    wx.setStorageSync(getEvalCacheKey(planId, todayRecord), {
      date: formatDate(new Date()),
      emoji: result.emoji,
      text: result.text
    })
  }
  return result
}

// 获取今日评语；优先读取与当前今日记录内容匹配的本地缓存，未命中时重新生成
function getEvaluationToday(todayRecord, allRecords, planId = '', historyStats = null) {
  const data = wx.getStorageSync(getEvalCacheKey(planId, todayRecord))
  const today = formatDate(new Date())
  if (data && data.date === today) {
    return { emoji: data.emoji, text: data.text }
  }
  if (!todayRecord) return null
  const result = evaluate(todayRecord, allRecords, historyStats)
  if (result) {
    wx.setStorageSync(getEvalCacheKey(planId, todayRecord), {
      date: today,
      emoji: result.emoji,
      text: result.text
    })
  }
  return result
}

function compareEvaluation(diff) {
  const questionUp = diff.questionDiff > 0
  const questionDown = diff.questionDiff < 0
  const accUp = diff.accuracyDiff > 0
  const accDown = diff.accuracyDiff < 0

  if (questionUp && accUp) return randomPick(COMPARE_TEMPLATES.upBoth)
  if (questionUp) return randomPick(COMPARE_TEMPLATES.upVolume)
  if (accUp) return randomPick(COMPARE_TEMPLATES.upAcc)
  if (questionDown || accDown) return randomPick(COMPARE_TEMPLATES.down)
  return randomPick(COMPARE_TEMPLATES.flat)
}

module.exports = {
  evaluate,
  saveEvaluationToday,
  getEvaluationToday,
  compareEvaluation,
  calcStreak
}
