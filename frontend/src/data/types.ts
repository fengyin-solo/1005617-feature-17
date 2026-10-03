/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 停暖通知的四个状态，只允许沿数组顺序单向推进。 */
export type NoticeStatus = '待拟稿' | '待发布' | '已发布' | '已撤销'

/** 操作人上下文：权限和归属都从这里取，页面只负责把当前会话传进来。 */
export type OperatorContext = {
  role: 'shift_leader' | 'duty_admin'
  operator: string
  /** 归属片区：值班管理员必填本片区，值班长为空串 */
  district: string
}

/** 停暖通知单：通知沿用既有口径，只在原字段之外补齐归属与流转留痕。 */
export type HeatNotice = {
  id: number
  status: NoticeStatus
  pending: boolean
  abnormal: boolean
  通知编号: string
  影响片区: string
  停暖原因: string
  计划开始: string
  计划恢复: string
  通知方式: string
  发布人: string
  /** 与其他模块保持一致的状态冗余列，写入时随 status 同步 */
  通知状态: NoticeStatus
  /** 归属：本片区值班管理员拟稿时落定，之后谁都不能再改影响片区 */
  拟稿人: string
  拟稿人片区: string
  提交时间: string
  发布时间: string
  撤销人: string
  撤销时间: string
  撤销原因: string
  /** 重新拟稿另起一条时，回指被撤销的原单，便于追溯 */
  来源通知单: string
}

/** 登记/改单时页面提交的字段（沿用既有口径的那几项）。 */
export type NoticeDraft = {
  影响片区: string
  停暖原因: string
  计划开始: string
  计划恢复: string
  通知方式: string
}

/** 撤销附带的原因。 */
export type RevokeDraft = {
  撤销原因: string
}

/** 对外通知口径：列表与详情取同一份，撤销单按已撤销口径对外。 */
export type PublicNotice = {
  通知编号: string
  影响片区: string
  停暖原因: string
  计划开始: string
  计划恢复: string
  通知方式: string
  发布人: string
  status: NoticeStatus
  /** 对外文案：已发布单按发布口径，已撤销单明确告知已撤销 */
  对外口径: string
}

/** 撤销结果落到入户服务的待补发清单项。 */
export type ReissueItem = {
  key: string
  通知编号: string
  影响片区: string
  停暖原因: string
  计划开始: string
  计划恢复: string
  撤销人: string
  撤销时间: string
  撤销原因: string
  待补发: true
}
