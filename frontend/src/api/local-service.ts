import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OperatorContext,
  OperatorRole,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 详情与列表走同一份取数：都读本地数据层这一份，不另开副本。
export function getEntry(key: string, id: number): EntryRow | null {
  moduleMeta(key)
  return listRows(key).find((row) => Number(row.id) === id) ?? null
}

export function runAction(key: string, id: number, action: string): ActionResult {
  if (key === NOTICE_KEY) {
    return { ok: false, message: '停暖通知单已收口到专用流转（拟稿/发布/撤销），通用动作入口不再受理' }
  }
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// —— 停暖通知专用流转：权限、归属、单向状态机都收在这一段，页面不做业务判断 ——

const NOTICE_KEY = 'heatnotice'
const NOTICE_FINAL_STATUS = '已撤销'

// 单向推进：待拟稿 → 待发布 → 已发布 → 已撤销，每个动作只认唯一的来源状态。
const NOTICE_FLOW: Record<string, { from: string; to: string; role: OperatorRole }> = {
  提交拟稿: { from: '待拟稿', to: '待发布', role: '值班管理员' },
  发布通知: { from: '待发布', to: '已发布', role: '值班长' },
  撤销通知: { from: '已发布', to: '已撤销', role: '值班长' },
}

export type NoticeDraftInput = {
  id?: number
  影响片区: string
  停暖原因: string
  计划开始: string
  计划恢复: string
  通知方式: string
}

function isValidDateText(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    return false
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12) {
    return false
  }
  const daysInMonth = new Date(year, month, 0).getDate()
  return day >= 1 && day <= daysInMonth
}

function nextIdAndCode(rows: EntryRow[], field: string, prefix: string): { id: number; code: string } {
  let id = 0
  let seq = 0
  for (const row of rows) {
    id = Math.max(id, Number(row.id) || 0)
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(String(row[field] ?? ''))
    if (match) {
      seq = Math.max(seq, Number(match[1]))
    }
  }
  return { id: id + 1, code: `${prefix}-${String(seq + 1).padStart(4, '0')}` }
}

// 拟稿与修改：只限本片区值班管理员，且只有「待拟稿」能改；计划恢复非法值退回重填。
export function saveNoticeDraft(input: NoticeDraftInput, ctx: OperatorContext): ActionResult {
  if (ctx.role !== '值班管理员') {
    return { ok: false, message: `拟稿和修改只限本片区值班管理员，当前身份「${ctx.role}」越权，已拒绝` }
  }
  if (input.影响片区.trim() !== ctx.area) {
    return { ok: false, message: `只能维护本片区（${ctx.area}）的停暖通知单，越权改动已拒绝` }
  }
  const required: Array<[keyof NoticeDraftInput, string]> = [
    ['停暖原因', '停暖原因'],
    ['计划开始', '计划开始'],
    ['计划恢复', '计划恢复'],
    ['通知方式', '通知方式'],
  ]
  const missing = required.filter(([field]) => String(input[field] ?? '').trim() === '')
  if (missing.length > 0) {
    return { ok: false, message: `${missing.map(([, label]) => label).join('、')}未填写，退回重填` }
  }
  if (!isValidDateText(input.计划开始.trim())) {
    return { ok: false, message: '计划开始时间非法（应为 YYYY-MM-DD），退回重填' }
  }
  const 计划恢复 = input.计划恢复.trim()
  if (!isValidDateText(计划恢复) || 计划恢复 < input.计划开始.trim()) {
    return { ok: false, message: '计划恢复时间非法（应为 YYYY-MM-DD 且不早于计划开始），退回重填' }
  }

  const rows = listRows(NOTICE_KEY)
  if (input.id !== undefined) {
    const index = rows.findIndex((row) => Number(row.id) === input.id)
    if (index < 0) {
      return { ok: false, message: `没有找到编号为 ${input.id} 的停暖通知单` }
    }
    const current = rows[index]
    if (String(current.status) === NOTICE_FINAL_STATUS) {
      return { ok: false, message: '停暖通知单已撤销，整单只读；重新拟稿请另起一条' }
    }
    if (String(current.status) !== '待拟稿') {
      return { ok: false, message: `通知单已进入「${String(current.status)}」，不能回退修改；重新拟稿请另起一条` }
    }
    if (String(current['影响片区'] ?? '') !== ctx.area) {
      return { ok: false, message: `只能维护本片区（${ctx.area}）的停暖通知单，越权改动已拒绝` }
    }
    const next = [...rows]
    next[index] = {
      ...current,
      影响片区: input.影响片区.trim(),
      停暖原因: input.停暖原因.trim(),
      计划开始: input.计划开始.trim(),
      计划恢复,
      通知方式: input.通知方式.trim(),
    }
    saveRows(NOTICE_KEY, next)
    return { ok: true, message: `停暖通知单 ${String(current['通知编号'] ?? '')} 已保存，仍为「待拟稿」` }
  }

  const { id, code } = nextIdAndCode(rows, '通知编号', 'HEAT')
  const created: EntryRow = {
    id,
    status: '待拟稿',
    pending: true,
    abnormal: false,
    通知编号: code,
    影响片区: input.影响片区.trim(),
    停暖原因: input.停暖原因.trim(),
    计划开始: input.计划开始.trim(),
    计划恢复,
    通知方式: input.通知方式.trim(),
    发布人: '',
    通知状态: '待拟稿',
  }
  saveRows(NOTICE_KEY, [...rows, created])
  return { ok: true, message: `停暖通知单已登记，编号 ${code}，当前状态「待拟稿」` }
}

// 撤销已发布的通知后，入户服务要补发说明：生成一条待受理的补发工单，同一通知只补一条。
function appendReissueTicket(notice: EntryRow, ctx: OperatorContext): void {
  const services = listRows('householdservice')
  const code = String(notice['通知编号'] ?? '')
  const exists = services.some(
    (row) => String(row['服务内容'] ?? '').includes(code) && String(row['处理结果'] ?? '') === '待补发',
  )
  if (exists) {
    return
  }
  const { id, code: ticketCode } = nextIdAndCode(services, '服务单号', 'HOUS')
  const ticket: EntryRow = {
    id,
    status: '待受理',
    pending: true,
    abnormal: false,
    服务单号: ticketCode,
    报修用户: `${String(notice['影响片区'] ?? '')}住户`,
    服务内容: `停暖通知撤销补发：通知单 ${code}（${String(notice['影响片区'] ?? '')}）已撤销，需入户补发书面说明`,
    受理人: ctx.operator,
    上门时间: new Date().toISOString().slice(0, 10),
    处理结果: '待补发',
    回访日期: '',
    服务状态: '待受理',
  }
  saveRows('householdservice', [...services, ticket])
}

// 状态流转：越权一律拒绝，回退一律打回，撤销后整单只读，重复提交只记一遍。
export function runNoticeAction(id: number, action: string, ctx: OperatorContext): ActionResult {
  const step = NOTICE_FLOW[action]
  if (!step) {
    return { ok: false, message: `停暖通知单没有登记「${action}」这个动作` }
  }
  const rows = listRows(NOTICE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的停暖通知单` }
  }
  const current = rows[index]
  const status = String(current.status)
  if (status === NOTICE_FINAL_STATUS) {
    return { ok: false, message: '停暖通知单已撤销，整单只读；如需调整请重新拟稿另起一条' }
  }
  if (ctx.role !== step.role) {
    return { ok: false, message: `「${action}」收在${step.role}手里，当前身份「${ctx.role}」越权，已拒绝` }
  }
  if (action === '提交拟稿' && String(current['影响片区'] ?? '') !== ctx.area) {
    return { ok: false, message: `只能提交本片区（${ctx.area}）的停暖通知单，越权改动已拒绝` }
  }
  if (status === step.to) {
    return { ok: false, message: `停暖通知单已是「${step.to}」，重复提交只记一遍，不再变更` }
  }
  if (status !== step.from) {
    return {
      ok: false,
      message: `停暖通知单按待拟稿→待发布→已发布→已撤销单向推进，当前状态「${status}」不允许「${action}」，已打回`,
    }
  }

  const updated: EntryRow = {
    ...current,
    status: step.to,
    通知状态: step.to,
    pending: step.to === '待发布',
    abnormal: action === '撤销通知',
  }
  if (action === '发布通知') {
    updated['发布人'] = ctx.operator
  }
  const next = [...rows]
  next[index] = updated
  saveRows(NOTICE_KEY, next)
  if (action === '撤销通知') {
    appendReissueTicket(updated, ctx)
    return { ok: true, message: '停暖通知单已撤销并转只读，补发任务已入入户服务待补发清单' }
  }
  if (action === '发布通知') {
    return { ok: true, message: `停暖通知单已发布，发布人「${ctx.operator}」` }
  }
  return { ok: true, message: '停暖通知单已提交拟稿，当前状态「待发布」，待值班长发布' }
}
